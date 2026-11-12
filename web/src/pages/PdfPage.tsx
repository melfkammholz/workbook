import { useQueryClient } from '@tanstack/react-query';
import type { Resource } from '@wb/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Maximize, PanelRight, PanelRightClose, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NotesView, SlidesView, type PdfLayout, type Size } from '@/components/PdfViewer';
import { IconButton, Segmented, Spinner, Empty } from '@/components/ui';
import { api } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { usePageKeys } from '@/lib/keys';
import { openPdf } from '@/lib/pdf';
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
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(Math.max(1, resource.lastPage ?? 1));
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
    setZoom(1);
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
      <NotesView doc={doc} count={count} guess={guess} zoom={zoom} current={current} onCurrent={setCurrent} scroller={scroller} />
    ) : (
      <SlidesView doc={doc} count={count} guess={guess} zoom={zoom} current={current} area={scroller} />
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
        {column ? (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-sheet p-4 text-sm">
            <h2 className="font-semibold">{resource.title}</h2>
            {resource.author ? <p className="text-ink-2">{resource.author}</p> : null}
            {doc ? <p className="mt-3 font-medium">{t.pdfPageInfo(current, count, labelOf(current))}</p> : null}
            <p className="mt-3 text-[13px] text-ink-2">
              {resource.file.filename} · {formatSize(resource.file.size)}
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
