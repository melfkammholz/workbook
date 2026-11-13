import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/** A link on a page, positioned as fractions of the page (0-1, from the top left). */
export interface PageLink {
  x: number;
  y: number;
  w: number;
  h: number;
  /** An address outside the PDF (http, https or mailto only). */
  url?: string;
  /** A place in the PDF: a name, or an explicit destination array. */
  dest?: unknown;
  /** A place found by matching the text (a citation without a link), already resolved. */
  target?: Target;
}

/** Where a link leads in the PDF: a page (1-based) and how far down it (0-1), `null` when the page as a whole. */
export interface Target {
  page: number;
  y: number | null;
}

const links = new WeakMap<PDFPageProxy, Promise<PageLink[]>>();

/** The links of a page, read once. */
export function linksOf(page: PDFPageProxy): Promise<PageLink[]> {
  let p = links.get(page);
  if (!p) {
    p = page.getAnnotations({ intent: 'display' }).then(
      (list) => {
        const v = page.getViewport({ scale: 1 });
        const out: PageLink[] = [];
        for (const a of list as Array<{ subtype?: string; rect?: number[]; dest?: unknown; url?: string; unsafeUrl?: string }>) {
          if (a.subtype !== 'Link' || !a.rect) continue;
          const url = a.url ?? a.unsafeUrl;
          const safe = url && /^(https?:|mailto:)/i.test(url) ? url : undefined;
          if (!safe && !a.dest) continue;
          const [x1, y1] = v.convertToViewportPoint(a.rect[0]!, a.rect[1]!);
          const [x2, y2] = v.convertToViewportPoint(a.rect[2]!, a.rect[3]!);
          out.push({ x: Math.min(x1, x2) / v.width, y: Math.min(y1, y2) / v.height, w: Math.abs(x2 - x1) / v.width, h: Math.abs(y2 - y1) / v.height, url: safe, dest: safe ? undefined : a.dest });
        }
        return out;
      },
      () => [],
    );
    links.set(page, p);
  }
  return p;
}

const targets = new WeakMap<PDFDocumentProxy, Map<string, Promise<Target | null>>>();

/** The page and height a destination points at. */
export function resolveDest(doc: PDFDocumentProxy, dest: unknown): Promise<Target | null> {
  let m = targets.get(doc);
  if (!m) targets.set(doc, (m = new Map()));
  const key = typeof dest === 'string' ? dest : JSON.stringify(dest);
  let p = m.get(key);
  if (!p) {
    p = (async (): Promise<Target | null> => {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[] | null);
      if (!Array.isArray(d) || d.length < 2) return null;
      const ref = d[0];
      const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
      const page = await doc.getPage(index + 1);
      const v = page.getViewport({ scale: 1 });
      const kind = (d[1] as { name?: string } | null)?.name;
      // The y of the destination is where the target begins: XYZ left top zoom, FitH top, FitR l b r t.
      let pdfY: number | null = null;
      let pdfX = 0;
      if (kind === 'XYZ') {
        pdfX = typeof d[2] === 'number' ? d[2] : 0;
        pdfY = typeof d[3] === 'number' ? d[3] : null;
      } else if (kind === 'FitH' || kind === 'FitBH') pdfY = typeof d[2] === 'number' ? d[2] : null;
      else if (kind === 'FitR') pdfY = typeof d[5] === 'number' ? d[5] : null;
      const y = pdfY === null ? null : Math.min(1, Math.max(0, v.convertToViewportPoint(pdfX, pdfY)[1] / v.height));
      return { page: index + 1, y };
    })().catch(() => null);
    m.set(key, p);
  }
  return p;
}

/** The look of a crop: as wide as the popover, this many CSS pixels high. */
export const CROP_W = 560;
export const CROP_H = 130;

const crops = new WeakMap<PDFDocumentProxy, Map<string, Promise<HTMLCanvasElement | null>>>();

/** A picture of the target and a few lines around it, drawn once per target. */
export function cropOf(doc: PDFDocumentProxy, t: Target): Promise<HTMLCanvasElement | null> {
  let m = crops.get(doc);
  if (!m) crops.set(doc, (m = new Map()));
  const key = `${t.page}:${t.y === null ? 'top' : t.y.toFixed(4)}`;
  let p = m.get(key);
  if (!p) {
    p = (async () => {
      const page = await doc.getPage(t.page);
      const base = page.getViewport({ scale: 1 });
      const scale = CROP_W / base.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      // A few pixels above the target, so its first line is whole.
      const top = Math.max(0, Math.min((t.y ?? 0) * viewport.height - 14 * dpr, viewport.height - CROP_H * dpr));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(CROP_W * dpr);
      canvas.height = Math.floor(CROP_H * dpr);
      canvas.style.width = `${CROP_W}px`;
      canvas.style.height = `${CROP_H}px`;
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, transform: [1, 0, 0, 1, 0, -top], background: '#ffffff' }).promise;
      return canvas;
    })().catch(() => null);
    m.set(key, p);
  }
  return p;
}
