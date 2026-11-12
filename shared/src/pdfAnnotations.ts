// Highlights in uploaded PDFs. Pure: no DOM, so the server and the tests can use it.
import type { AnnotationColor, AnnotationReview, TextQuote } from './annotations';

/** A rectangle on a page, in fractions of the page's width and height (0..1), so it holds at any zoom. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A highlight in a PDF. Anchored by page and rectangles; the quote with its context is only kept so that a new version
 * of the file can find the passage again. `version` is the sha256 of the file it was made on.
 */
export interface PdfAnnotation extends TextQuote {
  id: string;
  resource: string;
  version: string;
  /** 0-based. */
  pageIndex: number;
  rects: PageRect[];
  color: AnnotationColor;
  label: string | null;
  comment: string;
  review: AnnotationReview | null;
  createdAt: number;
  updatedAt: number;
}

export type NewPdfAnnotation = Pick<PdfAnnotation, 'version' | 'pageIndex' | 'rects' | 'quote' | 'prefix' | 'suffix' | 'color'> &
  Partial<Pick<PdfAnnotation, 'label' | 'comment' | 'review'>> & { id?: string };

export const MAX_RECTS = 400;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Rectangles in screen pixels to fractions of the page box they are on; empty ones and ones outside are dropped. */
export function toPageRects(rects: readonly { left: number; top: number; width: number; height: number }[], box: { left: number; top: number; width: number; height: number }): PageRect[] {
  if (box.width <= 0 || box.height <= 0) return [];
  const out: PageRect[] = [];
  for (const r of rects) {
    const x0 = clamp01((r.left - box.left) / box.width);
    const y0 = clamp01((r.top - box.top) / box.height);
    const x1 = clamp01((r.left + r.width - box.left) / box.width);
    const y1 = clamp01((r.top + r.height - box.top) / box.height);
    if (x1 - x0 > 0.0005 && y1 - y0 > 0.0005) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

/**
 * One rectangle per line: those that sit on the same line (they overlap vertically by more than half the smaller
 * height) and touch or nearly touch horizontally are joined, and a rectangle inside another one disappears. A browser
 * gives one rectangle per text-layer span, and one for the line's box besides.
 */
export function mergeLineRects(rects: readonly PageRect[], gap = 0.01): PageRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PageRect[][] = [];
  for (const r of sorted) {
    const line = lines.find((l) => {
      const b = bounds(l);
      const overlap = Math.min(b.y + b.h, r.y + r.h) - Math.max(b.y, r.y);
      return overlap > Math.min(b.h, r.h) / 2;
    });
    if (line) line.push(r);
    else lines.push([r]);
  }
  const out: PageRect[] = [];
  for (const line of lines) {
    const byX = [...line].sort((a, b) => a.x - b.x);
    let cur: PageRect | null = null;
    for (const r of byX) {
      if (cur && r.x <= cur.x + cur.w + gap) {
        const x: number = cur.x;
        const y = Math.min(cur.y, r.y);
        const right = Math.max(cur.x + cur.w, r.x + r.w);
        const bottom = Math.max(cur.y + cur.h, r.y + r.h);
        cur = { x, y, w: right - x, h: bottom - y };
      } else {
        if (cur) out.push(cur);
        cur = { ...r };
      }
    }
    if (cur) out.push(cur);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

function bounds(l: readonly PageRect[]): PageRect {
  const x = Math.min(...l.map((r) => r.x));
  const y = Math.min(...l.map((r) => r.y));
  return { x, y, w: Math.max(...l.map((r) => r.x + r.w)) - x, h: Math.max(...l.map((r) => r.y + r.h)) - y };
}

/** Whether a point (fractions of the page) is on one of the rectangles. */
export const hitsRects = (rects: readonly PageRect[], x: number, y: number): boolean => rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

/** The top of the first rectangle: where the highlight is on its page, for ordering and for margin notes. */
export const rectsTop = (rects: readonly PageRect[]): number => (rects.length ? Math.min(...rects.map((r) => r.y)) : 0);
