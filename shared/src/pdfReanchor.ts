// Finding the student's highlights and page items again in a new version of a PDF. Pure: the browser reads the pages
// with pdf.js and hands over plain text items, so the server and the tests can run the same code.
import { locateQuoteScored, type TextQuote } from './anchors';
import { mergeLineRects, type PageRect } from './pdfAnnotations';
import { pageFingerprint } from './pdfPages';

/** One piece of text on a page, with its box in fractions of the page (top left is 0,0). */
export interface PageTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A page's text: the items joined with spaces (what the fingerprint is made of) and where each item starts. */
export interface PageText {
  text: string;
  items: PageTextItem[];
  starts: number[];
}

export function pageText(items: readonly PageTextItem[]): PageText {
  const starts: number[] = [];
  let at = 0;
  for (const i of items) {
    starts.push(at);
    at += i.str.length + 1;
  }
  return { text: items.map((i) => i.str).join(' '), items: [...items], starts };
}

/** The line rectangles of `[start, end)` of a page's text; an item is cut in proportion to the characters taken. */
export function rectsForRange(p: PageText, start: number, end: number): PageRect[] {
  const out: PageRect[] = [];
  p.items.forEach((it, i) => {
    const len = it.str.length;
    const off = p.starts[i]!;
    const c0 = Math.max(start, off) - off;
    const c1 = Math.min(end, off + len) - off;
    if (len === 0 || c1 <= c0 || !it.str.slice(c0, c1).trim()) return;
    out.push({ x: it.x + (it.w * c0) / len, y: it.y, w: (it.w * (c1 - c0)) / len, h: it.h });
  });
  return mergeLineRects(out);
}

/** Without whitespace, and for each character the offset in the original: pieces of a word split by the file still match. */
function stripped(text: string): { text: string; at: number[] } {
  let out = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]!)) continue;
    out += text[i];
    at.push(i);
  }
  return { text: out, at };
}

export interface Placed {
  pageIndex: number;
  rects: PageRect[];
}

/**
 * Where a highlight is in the new pages: the page whose text has the quote with the best agreeing surroundings, the
 * one closest to the old page on a tie. Null when no page has it.
 */
export function placeHighlight(pages: readonly PageText[], q: TextQuote, oldIndex: number): Placed | null {
  let best: { page: number; start: number; end: number; score: number } | null = null;
  pages.forEach((p, i) => {
    const f = locateQuoteScored(p.text, q);
    if (!f) return;
    const better = !best || f.score > best.score || (f.score === best.score && Math.abs(i - oldIndex) < Math.abs(best.page - oldIndex));
    if (better) best = { page: i, start: f.start, end: f.end, score: f.score };
  });
  if (!best) {
    const want = stripped(q.quote).text;
    if (want.length < 8) return null;
    pages.forEach((p, i) => {
      const s = stripped(p.text);
      const at = s.text.indexOf(want);
      if (at < 0) return;
      if (!best || Math.abs(i - oldIndex) < Math.abs(best.page - oldIndex)) best = { page: i, start: s.at[at]!, end: s.at[at + want.length - 1]! + 1, score: 0 };
    });
  }
  if (!best) return null;
  const b: { page: number; start: number; end: number } = best;
  const rects = rectsForRange(pages[b.page]!, b.start, b.end);
  return rects.length ? { pageIndex: b.page, rects } : null;
}

export interface PageItemRef {
  id: string;
  fingerprint: string;
  pageIndex: number;
}

/** Share of the character pairs two texts have in common (0..1). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) pairs.set(a.slice(i, i + 2), (pairs.get(a.slice(i, i + 2)) ?? 0) + 1);
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const k = b.slice(i, i + 2);
    const n = pairs.get(k);
    if (n) {
      hit++;
      pairs.set(k, n - 1);
    }
  }
  return (2 * hit) / (a.length + b.length - 2);
}

export const MATCH_MIN = 0.8;
const head = (fp: string) => fp.slice(0, fp.lastIndexOf('#') < 0 ? undefined : fp.lastIndexOf('#'));
const isIndexFp = (fp: string) => fp.startsWith('index:');

/**
 * Which new page each old item is on, by fingerprint: an exact one first, else the most similar start of the text at
 * `MATCH_MIN` or more. `unique`: a page takes one item only (the closest to it wins). Null: not found.
 */
export function matchPages(old: readonly PageItemRef[], fingerprints: readonly string[], unique: boolean): Map<string, number | null> {
  const result = new Map<string, number | null>();
  const taken = new Set<number>();
  const byFp = new Map<string, number[]>();
  fingerprints.forEach((f, i) => byFp.set(f, [...(byFp.get(f) ?? []), i]));
  for (const o of [...old].sort((a, b) => a.pageIndex - b.pageIndex)) {
    const c = (byFp.get(o.fingerprint) ?? []).filter((i) => !unique || !taken.has(i)).sort((a, b) => Math.abs(a - o.pageIndex) - Math.abs(b - o.pageIndex))[0];
    if (c === undefined) continue;
    result.set(o.id, c);
    taken.add(c);
  }
  const heads = fingerprints.map((f) => (isIndexFp(f) ? '' : head(f)));
  const pairs: { id: string; page: number; score: number; dist: number }[] = [];
  for (const o of old) {
    if (result.has(o.id) || isIndexFp(o.fingerprint)) continue;
    const h = head(o.fingerprint);
    heads.forEach((ph, i) => {
      if (!ph || (unique && taken.has(i))) return;
      const score = similarity(h, ph);
      if (score >= MATCH_MIN) pairs.push({ id: o.id, page: i, score, dist: Math.abs(i - o.pageIndex) });
    });
  }
  pairs.sort((a, b) => b.score - a.score || a.dist - b.dist);
  for (const p of pairs) {
    if (result.has(p.id) || (unique && taken.has(p.page))) continue;
    result.set(p.id, p.page);
    taken.add(p.page);
  }
  for (const o of old) if (!result.has(o.id)) result.set(o.id, null);
  return result;
}

/** What the browser needs to place the items made on an older file. */
export interface StaleItems {
  /** The sha256 of the current file. */
  version: string;
  highlights: { id: string; pageIndex: number; quote: string; prefix: string; suffix: string }[];
  pages: PageItemRef[];
  toc: PageItemRef[];
}

/** What the browser found: for each item its new place, or none. */
export interface Reanchored {
  version: string;
  highlights: { id: string; place: Placed | null }[];
  pages: { id: string; pageIndex: number | null; fingerprint?: string }[];
  toc: { id: string; pageIndex: number | null; fingerprint?: string }[];
}

/** What the student sees in the "fix or drop" list. */
export interface UnplacedItems {
  highlights: import('./pdfAnnotations').PdfAnnotation[];
  pages: import('./pdfPages').PdfPageItem[];
  toc: import('./pdfToc').TocEdit[];
}

/** The viewport of a page as pdf.js has it (only what is used here). */
export interface PageViewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/** The text items pdf.js reads from a page (`getTextContent().items`), as boxes in fractions of the page. */
export function textItems(items: readonly unknown[], viewport: PageViewport): PageTextItem[] {
  const out: PageTextItem[] = [];
  for (const raw of items) {
    const i = raw as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    if (typeof i.str !== 'string' || !Array.isArray(i.transform)) continue;
    const e = Number(i.transform[4]);
    const f = Number(i.transform[5]);
    const w = Number(i.width) || 0;
    const h = Number(i.height) || 0;
    const [x1, y1] = viewport.convertToViewportPoint(e, f) as [number, number];
    const [x2, y2] = viewport.convertToViewportPoint(e + w, f + h) as [number, number];
    out.push({ str: i.str, x: Math.min(x1, x2) / viewport.width, y: Math.min(y1, y2) / viewport.height, w: Math.abs(x2 - x1) / viewport.width, h: Math.abs(y2 - y1) / viewport.height });
  }
  return out;
}

/** Places every stale item on the new pages. */
export function reanchor(stale: StaleItems, pages: readonly PageText[]): Reanchored {
  const fps = pages.map((p, i) => pageFingerprint(p.text, i));
  const pageMatch = matchPages(stale.pages, fps, true);
  const tocMatch = matchPages(stale.toc, fps, false);
  return {
    version: stale.version,
    highlights: stale.highlights.map((h) => ({ id: h.id, place: placeHighlight(pages, h, h.pageIndex) })),
    pages: stale.pages.map((p) => {
      const at = pageMatch.get(p.id) ?? null;
      return at === null ? { id: p.id, pageIndex: null } : { id: p.id, pageIndex: at, fingerprint: fps[at]! };
    }),
    toc: stale.toc.map((p) => {
      const at = tocMatch.get(p.id) ?? null;
      return at === null ? { id: p.id, pageIndex: null } : { id: p.id, pageIndex: at, fingerprint: fps[at]! };
    }),
  };
}
