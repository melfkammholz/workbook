import { useQueryClient } from '@tanstack/react-query';
import { pageFingerprint, pageQuote, rectsTop, slideGroups, slideOfPage, type PdfAnnotation, type PdfPageItem, type Resource } from '@wb/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Maximize, PanelRight, PanelRightClose, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MakeCardDialog } from '@/components/MakeCardDialog';
import { CopyRefButton, PdfHighlightLayer, type Editing } from '@/components/PdfHighlights';
import { PagesWithNotes, PdfPageNotes } from '@/components/PdfPageNotes';
import { NotesView, SlidesView, type Marks, type PdfLayout, type Size } from '@/components/PdfViewer';
import { IconButton, Segmented, Spinner, Empty } from '@/components/ui';
import { api, useSettings } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { usePageKeys } from '@/lib/keys';
import { openPdf } from '@/lib/pdf';
import { swatchProps } from '@/lib/annotations';
import { usePdfAnnotations, usePdfAnnotationsOn } from '@/lib/pdfAnnotations';
import { pdfPageRefText, savePdfPage, usePdfPages, type PagePatch } from '@/lib/pdfPages';
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
export function PdfPage({ id, highlight }: { id: string; highlight?: string | undefined }) {
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
  return <Viewer key={`${resource.id}-${resource.file.sha256}`} resource={resource} highlight={highlight} />;
}

function Viewer({ resource, highlight }: { resource: Resource; highlight?: string | undefined }) {
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
  /** The highlight just jumped to: it pulses once so the eye finds it. */
  const [flash, setFlash] = useState<string | null>(null);
  const marksOn = usePdfAnnotationsOn();
  const highlights = usePdfAnnotations(resource.id).data;
  const marks: Marks | undefined = useMemo(() => {
    if (!marksOn || !highlights) return undefined;
    const byPage = new Map<number, PdfAnnotation[]>();
    for (const a of highlights) (byPage.get(a.pageIndex) ?? byPage.set(a.pageIndex, []).get(a.pageIndex)!).push(a);
    return { byPage, active: editing?.id ?? null, flash };
  }, [marksOn, highlights, editing?.id, flash]);
  const [typed, setTyped] = useState<string | null>(null);
  const pages = usePdfPages(resource.id).data;
  const settings = useSettings().data;
  const cards = !!settings?.showFlashcards;
  const [pageCard, setPageCard] = useState<string | null>(null);
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
  // Slides: pages with the same label are the overlays of one slide. A step shows the last of them, where everything is built up.
  const slides = useMemo(() => slideGroups(labels, count), [labels, count]);
  const slideIndex = slideOfPage(slides, current);
  // Opening in the slides on a page in the middle of a slide: the slide shows its last page.
  useEffect(() => {
    if (layout === 'slides') setCurrent((c) => (slides[slideOfPage(slides, c)]?.last ?? c) === c ? c : slides[slideOfPage(slides, c)]!.last);
  }, [layout, slides]);
  /** The page a slide's note lives on, and the page notes live on in the notes layout. */
  const notePage = layout === 'slides' ? (slides[slideIndex]?.last ?? current) : current;
  const goto = useCallback(
    (n: number) => {
      let page = Math.min(Math.max(1, n), count || 1);
      if (layout === 'slides') page = slides[slideOfPage(slides, page)]?.last ?? page;
      setCurrent(page);
      offset.current = 0;
      if (layout === 'notes') {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
        if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 12;
      }
    },
    [count, layout, slides],
  );
  /** One step: a page in the notes, a slide in the slides. */
  const step = useCallback(
    (dir: 1 | -1) => {
      if (layout !== 'slides') return goto(current + dir);
      const to = slides[slideIndex + dir];
      if (to) goto(to.last);
    },
    [layout, goto, current, slides, slideIndex],
  );
  /**
   * Scrolls so that the highlight is in the middle of the view. Pages that are not drawn yet are laid out at the size of
   * the first one, so when they come in and the page changes height this looks again, until the student scrolls.
   */
  const centerTimers = useRef<number[]>([]);
  const flashTimer = useRef(0);
  const center = useCallback((id: string, smooth: boolean): boolean => {
    const sc = scroller.current;
    const boxes = [...(sc?.querySelectorAll<HTMLElement>(`[data-mark="${CSS.escape(id)}"]`) ?? [])].map((m) => m.getBoundingClientRect()).filter((b) => b.width > 0);
    if (!sc || !boxes.length) return false;
    const view = sc.getBoundingClientRect();
    const mid = (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2 - view.top;
    const midX = (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2 - view.left;
    sc.scrollTo({ top: sc.scrollTop + mid - sc.clientHeight / 2, left: sc.scrollLeft + midX - sc.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }, []);
  const jumpTo = useCallback(
    (a: Pick<PdfAnnotation, 'id' | 'pageIndex'>, open: boolean) => {
      const sc = scroller.current;
      const stop = () => {
        centerTimers.current.forEach((x) => clearTimeout(x));
        centerTimers.current = [];
      };
      stop();
      setCurrent(a.pageIndex + 1);
      offset.current = 0;
      if (open) setEditing({ id: a.id, focus: false });
      setFlash(a.id);
      clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash((f) => (f === a.id ? null : f)), 2200);
      // The slide shown must change first; the notes already have the highlight laid out.
      const go = (n: number) => centerTimers.current.push(window.setTimeout(() => center(a.id, false), n));
      if (!center(a.id, false)) go(0);
      go(60);
      go(350);
      go(900);
      const cancel = () => {
        stop();
        sc?.removeEventListener('wheel', cancel);
        sc?.removeEventListener('pointerdown', cancel);
      };
      sc?.addEventListener('wheel', cancel, { passive: true, once: true });
      sc?.addEventListener('pointerdown', cancel, { once: true });
    },
    [center],
  );
  useEffect(
    () => () => {
      centerTimers.current.forEach((x) => clearTimeout(x));
      clearTimeout(flashTimer.current);
    },
    [],
  );
  // Arriving from a reference: the highlight is opened and shown once the pages are there.
  const arrived = useRef<string | null>(null);
  useEffect(() => {
    if (!highlight || !doc || !guess || !pages || (marksOn && !highlights) || arrived.current === highlight) return;
    const a = highlights?.find((x) => x.id === highlight);
    const p = a ? undefined : pages.find((x) => x.id === highlight);
    if (!a && !p) return;
    arrived.current = highlight;
    // After the view has placed itself at the page it remembered.
    requestAnimationFrame(() => (a ? jumpTo(a, true) : goto(p!.pageIndex + 1)));
  }, [highlight, doc, highlights, pages, marksOn, guess, jumpTo, goto]);
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
    if (l === 'slides') setCurrent((c) => slides[slideOfPage(slides, c)]?.last ?? c);
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
          ArrowRight: () => step(1),
          ArrowLeft: () => step(-1),
          PageDown: () => (layout === 'slides' ? step(1) : screen(1)),
          PageUp: () => (layout === 'slides' ? step(-1) : screen(-1)),
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

  /** What the page's item needs when it is made: the fingerprint of its text and the first words, for the reference. Read once per page. */
  const infos = useRef(new Map<number, Promise<{ fingerprint: string; quote: string }>>());
  const pageInfo = useCallback(
    (n: number) => {
      let p = infos.current.get(n);
      if (!p) {
        p = (async () => {
          let text = '';
          try {
            const content = await (await doc!.getPage(n)).getTextContent();
            text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
          } catch {
            /* a page that cannot be read is told by its place */
          }
          return { fingerprint: pageFingerprint(text, n - 1), quote: pageQuote(text) || t.pdfPageN(n) };
        })();
        infos.current.set(n, p);
      }
      return p;
    },
    [doc, t],
  );
  // The page in view is read ahead, so that its first note or reference is there at once.
  useEffect(() => {
    if (doc && marksOn) void pageInfo(notePage);
  }, [doc, marksOn, notePage, pageInfo]);
  const itemOf = (n: number): PdfPageItem | undefined => pages?.find((p) => p.pageIndex === n - 1);
  const savePage = async (n: number, patch: PagePatch): Promise<PdfPageItem> => {
    const info = await pageInfo(n);
    return savePdfPage(qc, resource.id, n - 1, { version: resource.file.sha256, fingerprint: info.fingerprint }, patch);
  };
  /** The page's item exists once a reference to it does: it is made empty if need be. */
  const refTo = async (n: number): Promise<string> => {
    const item = itemOf(n) ?? (await savePage(n, {}));
    return pdfPageRefText(resource.id, item, (await pageInfo(n)).quote);
  };

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
            <IconButton label={t.pdfPrev} disabled={!doc || (layout === 'slides' ? slideIndex <= 0 : current <= 1)} onClick={() => step(-1)}>
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
            <span className="text-sm tabular-nums text-ink-2">{doc ? t.pdfPageOf(layout === 'slides' ? slides.length : count) : ''}</span>
            <IconButton label={t.pdfNext} disabled={!doc || (layout === 'slides' ? slideIndex >= slides.length - 1 : current >= count)} onClick={() => step(1)}>
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
          <aside data-pdf-column className="w-80 shrink-0 overflow-y-auto border-l border-line bg-sheet p-4 text-sm">
            <h2 className="font-semibold">{resource.title}</h2>
            {resource.author ? <p className="text-ink-2">{resource.author}</p> : null}
            {doc ? <p className="mt-3 font-medium">{t.pdfPageInfo(current, count, labelOf(current))}</p> : null}
            <p className="mt-3 text-[13px] text-ink-2">
              {resource.file.filename} · {formatSize(resource.file.size)}
            </p>
            {marksOn && doc && pages ? (
              <>
                <PdfPageNotes
                  key={`${layout}-${notePage}`}
                  heading={`${layout === 'slides' ? t.pdfSlideNotesTitle : t.pdfPageNotesTitle}: ${labelOf(notePage)}`}
                  item={itemOf(notePage)}
                  save={(patch) => void savePage(notePage, patch)}
                  copyRef={() => refTo(notePage)}
                  onCard={cards ? () => void refTo(notePage).then(setPageCard) : undefined}
                />
                <PagesWithNotes items={pages} marks={settings?.pdfPageMarks ?? []} current={notePage} labelOf={labelOf} onGo={goto} />
              </>
            ) : null}
            {marks && doc ? <AllHighlights resource={resource.id} list={highlights ?? []} current={current} labelOf={labelOf} editing={editing?.id ?? null} onJump={(a) => jumpTo(a, true)} /> : null}
          </aside>
        ) : null}
      </div>
      {pageCard ? <MakeCardDialog open onClose={() => setPageCard(null)} exerciseId={null} initial={{ back: pageCard }} /> : null}
    </div>
  );
}

/**
 * Every highlight of the PDF in reading order, grouped by page, with what the student wrote. A click jumps to the
 * highlight (it lands in the middle of the view) and opens it. The page in view is marked.
 */
function AllHighlights({ resource, list, current, labelOf, editing, onJump }: { resource: string; list: PdfAnnotation[]; current: number; labelOf: (n: number) => string; editing: string | null; onJump: (a: PdfAnnotation) => void }) {
  const t = useT();
  const groups = useMemo(() => {
    const sorted = [...list].sort((a, b) => a.pageIndex - b.pageIndex || rectsTop(a.rects) - rectsTop(b.rects) || a.createdAt - b.createdAt);
    const out: { page: number; items: PdfAnnotation[] }[] = [];
    for (const a of sorted) {
      const last = out[out.length - 1];
      if (last && last.page === a.pageIndex + 1) last.items.push(a);
      else out.push({ page: a.pageIndex + 1, items: [a] });
    }
    return out;
  }, [list]);
  // The page in view comes into view in the column, too, when it has highlights.
  const column = useRef<HTMLElement>(null);
  const here = groups.find((g) => g.page === current)?.page;
  useEffect(() => {
    const el = column.current?.querySelector<HTMLElement>(`[data-group="${here}"]`);
    const box = el?.closest('aside');
    if (!el || !box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (top < 0 || top > box.clientHeight - 80) box.scrollTo({ top: box.scrollTop + top - 80 });
  }, [here]);
  return (
    <section ref={column} className="mt-5 border-t border-line pt-3" aria-label={t.pdfAllHighlights}>
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink-2">{t.pdfAllHighlights}</h3>
      {groups.length === 0 ? <p className="text-[13px] text-ink-3">{t.pdfAllHighlightsNone}</p> : null}
      {groups.map((g) => (
        <div key={g.page} data-group={g.page} className="mb-2">
          <h4 className={`mb-0.5 px-1.5 text-[12px] font-medium ${g.page === current ? 'text-accent' : 'text-ink-3'}`}>{labelOf(g.page) !== String(g.page) ? `${t.pdfPageN(g.page)} (${labelOf(g.page)})` : t.pdfPageN(g.page)}</h4>
          <ul className="space-y-0.5">
            {g.items.map((a) => (
              <li key={a.id} className="group/h relative">
                <button type="button" onClick={() => onJump(a)} title={t.pdfJumpTo} aria-current={editing === a.id} className="flex w-full min-w-0 gap-2 rounded-md px-1.5 py-1 pr-8 text-left hover:bg-sunk aria-[current=true]:bg-sunk">
                  <span {...swatchProps(a.color)} aria-hidden className="wb-ann-swatch mt-[0.2em] w-1 shrink-0 self-stretch rounded-full" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-3 break-words">{a.quote.trim()}</span>
                    {a.review === 'open' ? <span className="mt-0.5 block text-[12px] font-medium text-review">{t.annMarked}</span> : null}
                    {a.comment.trim() ? <span className="mt-0.5 block whitespace-pre-wrap text-[13px] text-ink-2">{a.comment.trim()}</span> : null}
                  </span>
                </button>
                <span className="absolute right-0.5 top-0.5 opacity-0 focus-within:opacity-100 group-hover/h:opacity-100">
                  <CopyRefButton resource={resource} a={a} size={14} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
