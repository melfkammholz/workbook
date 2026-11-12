import { useQueryClient } from '@tanstack/react-query';
import { rectsTop, type PdfAnnotation, type Resource } from '@wb/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Maximize, PanelRight, PanelRightClose, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PdfHighlightLayer, type Editing } from '@/components/PdfHighlights';
import { NotesView, SlidesView, type Marks, type PdfLayout, type Size } from '@/components/PdfViewer';
import { IconButton, Segmented, Spinner, Empty } from '@/components/ui';
import { api } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { usePageKeys } from '@/lib/keys';
import { openPdf } from '@/lib/pdf';
import { swatchProps } from '@/lib/annotations';
import { usePdfAnnotations, usePdfAnnotationsOn } from '@/lib/pdfAnnotations';
import { fileUrl, formatSize, resourceKeys, useResources } from '@/lib/resources';

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 5;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* it just is not remembered */
  }
}

/** Where the student was in one PDF: kept in this browser, so coming back shows the same page, zoom and layout. */
interface ViewState {
  page: number;
  /** How far down the page the reading position is (0..1), for the scrolling notes. */
  offset: number;
  zoom: Record<PdfLayout, number>;
}
const viewKey = (id: string) => `wb-pdf-view-${id}`;
function readView(id: string): Partial<ViewState> {
  try {
    const v = JSON.parse(stored(viewKey(id)) ?? '{}') as Partial<ViewState>;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** A PDF in a viewer of its own: scrolling notes or one slide at a time, with a column on the right. */
export function PdfPage({ id }: { id: string }) {
  const t = useT();
  const list = useResources(null);
  const resource = list.data?.resources.find((r) => r.id === id);
  if (!list.data) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!resource) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.pdfMissing} />
      </div>
    );
  }
  return <Viewer key={`${resource.id}-${resource.file.sha256}`} resource={resource} />;
}

function Viewer({ resource }: { resource: Resource }) {
  const t = useT();
  const qc = useQueryClient();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [guess, setGuess] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);
  const [layout, setLayout] = useState<PdfLayout>(() => {
    const s = stored(`wb-pdf-layout-${resource.id}`);
    return s === 'notes' || s === 'slides' ? s : resource.type === 'slides' ? 'slides' : 'notes';
  });
  const [column, setColumn] = useState(() => stored('wb-pdf-column') !== '0');
  const [initial] = useState(() => readView(resource.id));
  const [zooms, setZooms] = useState<Record<PdfLayout, number>>(() => ({ notes: num(initial.zoom?.notes, 1, ZOOM_MIN, ZOOM_MAX), slides: num(initial.zoom?.slides, 1, ZOOM_MIN, ZOOM_MAX) }));
  const zoom = zooms[layout];
  const setZoom = useCallback((f: number | ((z: number) => number)) => setZooms((z) => ({ ...z, [layout]: typeof f === 'function' ? f(z[layout]) : f })), [layout]);
  const [current, setCurrent] = useState(Math.max(1, Math.round(num(initial.page, resource.lastPage ?? 1, 1, 1_000_000))));
  /** The reading position in the notes, written by the scrolling view, read when saving. */
  const offset = useRef(num(initial.offset, 0, 0, 1));
  const [editing, setEditing] = useState<Editing | null>(null);
  const marksOn = usePdfAnnotationsOn();
  const highlights = usePdfAnnotations(resource.id).data;
  const marks: Marks | undefined = useMemo(() => {
    if (!marksOn || !highlights) return undefined;
    const byPage = new Map<number, PdfAnnotation[]>();
    for (const a of highlights) (byPage.get(a.pageIndex) ?? byPage.set(a.pageIndex, []).get(a.pageIndex)!).push(a);
    return { byPage, active: editing?.id ?? null };
  }, [marksOn, highlights, editing?.id]);
  const [typed, setTyped] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const count = doc?.numPages ?? 0;

  useEffect(() => {
    let live = true;
    let opened: PDFDocumentProxy | null = null;
    openPdf(fileUrl(resource)).then(
      async (d) => {
        opened = d;
        if (!live) return void d.loadingTask.destroy();
        const [pageLabels, first] = await Promise.all([d.getPageLabels().catch(() => null), d.getPage(1)]);
        if (!live) return void d.loadingTask.destroy();
        const v = first.getViewport({ scale: 1 });
        setGuess({ w: v.width, h: v.height });
        setLabels(pageLabels && pageLabels.some(Boolean) ? pageLabels : null);
        setCurrent((c) => Math.min(Math.max(1, c), d.numPages));
        setDoc(d);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      void opened?.loadingTask.destroy();
    };
  }, [resource]);

  // Remember the page, a moment after the student stops moving; the materials list learns of it on leaving.
  const latest = useRef(current);
  latest.current = current;
  const zoomsRef = useRef(zooms);
  zoomsRef.current = zooms;
  const keepView = useCallback(() => {
    store(viewKey(resource.id), JSON.stringify({ page: latest.current, offset: Math.round(offset.current * 1000) / 1000, zoom: zoomsRef.current } satisfies ViewState));
  }, [resource.id]);
  const saved = useRef(resource.lastPage ?? 1);
  const save = useCallback(() => {
    if (!doc || latest.current === saved.current) return;
    saved.current = latest.current;
    void api.put(`/api/resources/${encodeURIComponent(resource.id)}/page`, { page: latest.current }).catch(() => undefined);
  }, [doc, resource.id]);
  useEffect(() => {
    const timer = setTimeout(save, 800);
    return () => clearTimeout(timer);
  }, [current, save]);
  // The view itself is kept in this browser: often, since it is cheap, and on leaving.
  useEffect(() => {
    if (!doc) return;
    const timer = setInterval(keepView, 1500);
    const onHide = () => keepView();
    addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      removeEventListener('pagehide', onHide);
      keepView();
    };
  }, [doc, keepView]);
  useEffect(() => {
    if (doc) keepView();
  }, [doc, zooms, layout, current, keepView]);
  useEffect(
    () => () => {
      save();
      void qc.invalidateQueries({ queryKey: resourceKeys.all });
    },
    [save, qc],
  );

  const labelOf = (n: number) => labels?.[n - 1] || String(n);
  const goto = useCallback(
    (n: number) => {
      const page = Math.min(Math.max(1, n), count || 1);
      setCurrent(page);
      offset.current = 0;
      if (layout === 'notes') {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
        if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 12;
      }
    },
    [count, layout],
  );
  /** The printed label if there is one, else the index. */
  const resolve = (text: string): number | null => {
    const s = text.trim();
    if (!s) return null;
    const i = labels?.findIndex((l) => l.toLowerCase() === s.toLowerCase()) ?? -1;
    if (i >= 0) return i + 1;
    return /^\d+$/.test(s) ? Math.min(count, Math.max(1, Number(s))) : null;
  };
  const zoomBy = (f: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * f)));
  const setLayoutKept = (l: PdfLayout) => {
    setLayout(l);
    store(`wb-pdf-layout-${resource.id}`, l);
  };
  const toggleColumn = () => {
    setColumn((c) => {
      store('wb-pdf-column', c ? '0' : '1');
      return !c;
    });
  };
  const screen = (dir: 1 | -1) => scroller.current?.scrollBy({ top: dir * scroller.current.clientHeight * 0.9 });

  usePageKeys(
    doc
      ? {
          ArrowRight: () => goto(current + 1),
          ArrowLeft: () => goto(current - 1),
          PageDown: () => (layout === 'slides' ? goto(current + 1) : screen(1)),
          PageUp: () => (layout === 'slides' ? goto(current - 1) : screen(-1)),
          Home: () => goto(1),
          End: () => goto(count),
          '+': () => zoomBy(ZOOM_STEP),
          '=': () => zoomBy(ZOOM_STEP),
          '-': () => zoomBy(1 / ZOOM_STEP),
          '0': () => setZoom(1),
          ']': toggleColumn,
        }
      : {},
  );

  const view =
    failed ? (
      <div className="grid h-full place-items-center">
        <Empty title={t.pdfFailed} />
      </div>
    ) : !doc || !guess ? (
      <div className="grid h-full place-items-center text-ink-2">
        <Spinner />
      </div>
    ) : layout === 'notes' ? (
      <NotesView doc={doc} count={count} guess={guess} zoom={zoom} current={current} onCurrent={setCurrent} scroller={scroller} marks={marks} offset={offset} />
    ) : (
      <SlidesView doc={doc} count={count} guess={guess} zoom={zoom} current={current} area={scroller} marks={marks} />
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 flex-wrap items-center gap-1 border-b border-line bg-sheet px-2">
        <BackLink fallback="/materials" label={t.back} className="mr-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-sunk hover:text-ink">
          {t.back}
        </BackLink>
        <h1 className="mr-2 min-w-0 max-w-[40%] truncate text-[15px] font-semibold">{resource.title}</h1>
        <div className="ml-auto flex items-center gap-1">
          <Segmented value={layout} options={[['notes', t.pdfLayoutNotes], ['slides', t.pdfLayoutSlides]]} onChange={setLayoutKept} />
          <div className="mx-1 flex items-center gap-1" aria-label={t.pdfGoTo}>
            <IconButton label={t.pdfPrev} disabled={!doc || current <= 1} onClick={() => goto(current - 1)}>
              <ChevronLeft size={16} />
            </IconButton>
            <input
              aria-label={t.pdfGoTo}
              disabled={!doc}
              value={typed ?? labelOf(current)}
              onFocus={(e) => {
                setTyped(labelOf(current));
                e.currentTarget.select();
              }}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => setTyped(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.blur();
                if (e.key !== 'Enter') return;
                const n = resolve(typed ?? '');
                if (n) goto(n);
                e.currentTarget.blur();
              }}
              className="h-8 w-14 wb-field px-1.5 text-center text-sm tabular-nums"
            />
            <span className="text-sm tabular-nums text-ink-2">{doc ? t.pdfPageOf(count) : ''}</span>
            <IconButton label={t.pdfNext} disabled={!doc || current >= count} onClick={() => goto(current + 1)}>
              <ChevronRight size={16} />
            </IconButton>
          </div>
          <IconButton label={t.pdfZoomOut} onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <ZoomOut size={16} />
          </IconButton>
          <span className="w-10 text-center text-[13px] tabular-nums text-ink-2">{Math.round(zoom * 100)}%</span>
          <IconButton label={t.pdfZoomIn} onClick={() => zoomBy(ZOOM_STEP)}>
            <ZoomIn size={16} />
          </IconButton>
          <IconButton label={t.pdfFit} onClick={() => setZoom(1)}>
            <Maximize size={16} />
          </IconButton>
          <IconButton label={column ? t.pdfHideColumn : t.pdfShowColumn} onClick={toggleColumn}>
            {column ? <PanelRightClose size={18} /> : <PanelRight size={18} />}
          </IconButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={scroller} className="min-w-0 flex-1 overflow-auto bg-sunk">
          {view}
        </div>
        {marks && doc ? <PdfHighlightLayer resource={resource} scroller={scroller} list={highlights ?? []} editing={editing} setEditing={setEditing} /> : null}
        {column ? (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-sheet p-4 text-sm">
            <h2 className="font-semibold">{resource.title}</h2>
            {resource.author ? <p className="text-ink-2">{resource.author}</p> : null}
            {doc ? <p className="mt-3 font-medium">{t.pdfPageInfo(current, count, labelOf(current))}</p> : null}
            <p className="mt-3 text-[13px] text-ink-2">
              {resource.file.filename} · {formatSize(resource.file.size)}
            </p>
            {marks && doc ? <PageHighlights list={marks.byPage.get(current - 1) ?? []} editing={editing?.id ?? null} onOpen={(id) => setEditing({ id, focus: false })} /> : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** The highlights on the page in view, top to bottom, with what the student wrote; a click opens one. */
function PageHighlights({ list, editing, onOpen }: { list: PdfAnnotation[]; editing: string | null; onOpen: (id: string) => void }) {
  const t = useT();
  const sorted = useMemo(() => [...list].sort((a, b) => rectsTop(a.rects) - rectsTop(b.rects) || a.createdAt - b.createdAt), [list]);
  return (
    <section className="mt-5 border-t border-line pt-3" aria-label={t.pdfPageHighlights}>
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink-2">{t.pdfPageHighlights}</h3>
      {sorted.length === 0 ? <p className="text-[13px] text-ink-3">{t.pdfPageHighlightsNone}</p> : null}
      <ul className="space-y-1">
        {sorted.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onOpen(a.id)} aria-current={editing === a.id} className="flex w-full min-w-0 gap-2 rounded-md px-1.5 py-1 text-left hover:bg-sunk aria-[current=true]:bg-sunk">
              <span {...swatchProps(a.color)} aria-hidden className="wb-ann-swatch mt-[0.2em] w-1 shrink-0 self-stretch rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-3 break-words">{a.quote.trim()}</span>
                {a.review === 'open' ? <span className="mt-0.5 block text-[12px] font-medium text-review">{t.annMarked}</span> : null}
                {a.comment.trim() ? <span className="mt-0.5 block whitespace-pre-wrap text-[13px] text-ink-2">{a.comment.trim()}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
