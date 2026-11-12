import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { PdfAnnotation } from '@wb/shared';
import { loadPdfjs } from '@/lib/pdf';
import { markStyle } from '@/lib/pdfAnnotations';

export type PdfLayout = 'notes' | 'slides';
/** The highlights of a PDF by page (0-based), and the open one. */
export interface Marks {
  byPage: Map<number, PdfAnnotation[]>;
  active: string | null;
  /** One that was just jumped to: it pulses. */
  flash?: string | null;
}

export interface Size {
  w: number;
  h: number;
}

/** How many rendered pages are kept around (besides the ones in sight) so going back is instant. */
const KEEP = 8;
/** A canvas never gets more pixels than this, however far the student zooms in. */
const MAX_PIXELS = 16_000_000;
const GAP = 12;
const PAD = 24;

/** Which pages are rendered, in the order they were drawn; the oldest one out of sight lets go of its canvas first. */
class PageCache {
  private order: number[] = [];
  readonly near = new Set<number>();
  private readonly release = new Map<number, () => void>();
  register(n: number, fn: () => void): () => void {
    this.release.set(n, fn);
    return () => {
      if (this.release.get(n) === fn) this.release.delete(n);
      this.order = this.order.filter((x) => x !== n);
    };
  }
  drawn(n: number): void {
    this.order = this.order.filter((x) => x !== n);
    this.order.push(n);
    while (this.order.length > KEEP) {
      const victim = this.order.find((x) => !this.near.has(x));
      if (victim === undefined) break;
      this.order = this.order.filter((x) => x !== victim);
      this.release.get(victim)?.();
    }
  }
}

type Fit = { kind: 'width'; width: number; zoom: number } | { kind: 'box'; width: number; height: number; zoom: number };

function scaleFor(fit: Fit, b: Size): number {
  if (fit.kind === 'width') return (fit.width / b.w) * fit.zoom;
  return Math.min(fit.width / b.w, fit.height / b.h) * fit.zoom;
}

interface PageProps {
  doc: PDFDocumentProxy;
  n: number;
  fit: Fit;
  /** Page 1's size: what a page not yet loaded is assumed to be. */
  guess: Size;
  near: boolean;
  hidden?: boolean;
  cache: PageCache;
  marks?: Marks;
}

/** One page: a box of the right size at once, the canvas and the text on top of it while the page is near. */
const PageView = memo(function PageView({ doc, n, fit, guess, near, hidden, cache, marks }: PageProps) {
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [base, setBase] = useState<Size | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const drawn = useRef<number | null>(null);
  const b = base ?? guess;
  const scale = scaleFor(fit, b);
  const cssW = Math.floor(b.w * scale);
  const cssH = Math.floor(b.h * scale);

  useEffect(() => {
    if (!near || page) return;
    let live = true;
    void doc.getPage(n).then((p) => {
      if (!live) return;
      const v = p.getViewport({ scale: 1 });
      setBase({ w: v.width, h: v.height });
      setPage(p);
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [near, page, doc, n]);

  useEffect(
    () =>
      cache.register(n, () => {
        canvasHost.current?.replaceChildren();
        textHost.current?.replaceChildren();
        drawn.current = null;
      }),
    [cache, n],
  );

  useEffect(() => {
    if (!near || !page || !base) return;
    if (drawn.current !== null && Math.abs(drawn.current - scale) < 1e-4) return;
    let live = true;
    let task: RenderTask | null = null;
    let text: { cancel(): void } | null = null;
    void (async () => {
      const pdfjs = await loadPdfjs();
      if (!live) return;
      // Draw into a canvas of its own and swap it in when done, so the page never shows blank while it redraws.
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      dpr = Math.min(dpr, Math.sqrt(MAX_PIXELS / Math.max(1, cssW * cssH)));
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = 'block size-full';
      try {
        task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport });
        await task.promise;
        if (!live) return;
        const layer = document.createElement('div');
        layer.className = 'textLayer';
        const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: page.getViewport({ scale }) });
        text = tl;
        await tl.render();
        if (!live) return;
        canvasHost.current?.replaceChildren(canvas);
        textHost.current?.replaceChildren(layer);
        drawn.current = scale;
        cache.drawn(n);
      } catch {
        /* cancelled because the page scrolled away or the size changed */
      }
    })();
    return () => {
      live = false;
      task?.cancel();
      text?.cancel();
    };
  }, [near, page, base, scale, cssW, cssH, cache, n]);

  return (
    <div
      data-page={n}
      hidden={hidden}
      className="wb-pdf-page relative shrink-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
      style={{ width: cssW, height: cssH, '--total-scale-factor': scale } as CSSProperties}
    >
      <div ref={canvasHost} className="absolute inset-0" />
      {/* Between the page and its text, so that the text stays selectable; clicks are hit-tested by the viewer. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {marks?.byPage.get(n - 1)?.map((a) =>
          a.rects.map((r, i) => (
            <span
              key={i}
              data-mark={a.id}
              {...markStyle(a.color)}
              className={`wb-pdf-mark absolute${a.review === 'open' ? ' wb-pdf-mark-review' : a.comment.trim() ? ' wb-pdf-mark-comment' : ''}${a.id === marks.active ? ' wb-pdf-mark-active' : ''}${a.id === marks.flash ? ' wb-pdf-mark-flash' : ''}`}
              style={{ ...markStyle(a.color).style, left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            />
          )),
        )}
      </div>
      <div ref={textHost} className="absolute inset-0" />
    </div>
  );
});

/** The size of an element, rounded, updated when it changes. */
export function useSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** The last index of `list` whose top is at or above `y` (binary search: pages differ in height, there can be hundreds). */
function lastAtOrAbove(list: HTMLCollection, y: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((list[mid] as HTMLElement).offsetTop <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface ViewProps {
  doc: PDFDocumentProxy;
  count: number;
  guess: Size;
  zoom: number;
  current: number;
  onCurrent: (n: number) => void;
  marks?: Marks;
}

/** Notes: every page one below the other, drawn as they come near. */
export function NotesView({ doc, count, guess, zoom, current, onCurrent, scroller, marks, offset }: ViewProps & { scroller: RefObject<HTMLDivElement | null>; offset: { current: number } }) {
  const list = useRef<HTMLDivElement>(null);
  const cache = useRef(new PageCache()).current;
  const size = useSize(scroller);
  const [range, setRange] = useState<[number, number]>([Math.max(1, current - 1), current + 1]);
  const started = useRef(false);
  const ready = size.w > 0;
  const fit: Fit = { kind: 'width', width: Math.max(100, size.w - PAD * 2), zoom };

  const measure = useCallback(() => {
    const sc = scroller.current;
    const pages = list.current?.children;
    if (!sc || !pages?.length) return;
    const top = sc.scrollTop;
    const first = lastAtOrAbove(pages, top);
    const last = lastAtOrAbove(pages, top + sc.clientHeight);
    const focus = lastAtOrAbove(pages, top + sc.clientHeight / 3);
    onCurrent(focus + 1);
    const fp = pages[focus] as HTMLElement;
    offset.current = fp.offsetHeight > 0 ? Math.min(1, Math.max(0, (top + sc.clientHeight / 3 - fp.offsetTop) / fp.offsetHeight)) : 0;
    const a = Math.max(1, first + 1 - 1);
    const z = Math.min(count, last + 1 + 1);
    setRange((r) => (r[0] === a && r[1] === z ? r : [a, z]));
  }, [scroller, onCurrent, count, offset]);

  // The first time there is a size: go to the page the student was at.
  useLayoutEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const el = list.current?.children[current - 1] as HTMLElement | undefined;
    // Back to the spot: the page, and how far down it the student was.
    if (el && scroller.current) scroller.current.scrollTop = offset.current > 0 ? el.offsetTop + offset.current * el.offsetHeight - scroller.current.clientHeight / 3 : el.offsetTop - GAP;
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      sc.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [scroller, measure]);

  // A new zoom or size moves the pages; find out which ones are in sight now.
  useEffect(() => {
    if (ready && started.current) requestAnimationFrame(measure);
  }, [zoom, size.w, ready, measure]);

  cache.near.clear();
  for (let i = range[0]; i <= range[1]; i++) cache.near.add(i);

  return (
    <div ref={list} className="relative mx-auto flex w-max min-w-full flex-col items-center" style={{ gap: GAP, padding: `${GAP}px ${PAD}px` }}>
      {ready
        ? Array.from({ length: count }, (_, i) => <PageView key={i} doc={doc} n={i + 1} fit={fit} guess={guess} near={i + 1 >= range[0] && i + 1 <= range[1]} cache={cache} marks={marks} />)
        : null}
    </div>
  );
}

/** Slides: one page, as large as the space allows; the next one is drawn already. */
export function SlidesView({ doc, count, guess, zoom, current, area, marks }: Omit<ViewProps, 'onCurrent'> & { area: RefObject<HTMLDivElement | null> }) {
  const cache = useRef(new PageCache()).current;
  const size = useSize(area);
  const fit: Fit = { kind: 'box', width: Math.max(100, size.w - PAD * 2), height: Math.max(100, size.h - PAD * 2), zoom };
  cache.near.clear();
  cache.near.add(current);
  cache.near.add(current + 1);
  const shown = [current - 1, current, current + 1].filter((n) => n >= 1 && n <= count);
  return (
    <div className="flex min-h-full min-w-full">
      <div className="m-auto" style={{ padding: PAD }}>
        {size.w > 0 ? shown.map((n) => <PageView key={n} doc={doc} n={n} fit={fit} guess={guess} near={n === current || n === current + 1} hidden={n !== current} cache={cache} marks={marks} />) : null}
      </div>
    </div>
  );
}
