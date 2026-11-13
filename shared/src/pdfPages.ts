// Notes on whole pages and slides of uploaded PDFs. Pure: no DOM, so the server and the tests can use it.
import { normalizeQuote } from './anchors';
import type { AnnotationReview } from './annotations';

/** What the student keeps on one page: a note (Typst), marks (ids of their own page marks) and come-back state. */
export interface PdfPageItem {
  id: string;
  resource: string;
  /** The sha256 of the file the page was made on. */
  version: string;
  /** 0-based. */
  pageIndex: number;
  fingerprint: string;
  note: string;
  marks: string[];
  review: AnnotationReview | null;
  createdAt: number;
  updatedAt: number;
}

export interface PdfPageFields {
  version: string;
  fingerprint: string;
  note?: string;
  marks?: string[];
  review?: AnnotationReview | null;
  /** Made by the client, so that a reference to the page can be copied before the server has answered. */
  id?: string;
}

export const MAX_PAGE_NOTE = 20_000;
export const MAX_PAGE_MARKS = 30;
const FINGERPRINT_HEAD = 300;

/** 53-bit string hash (cyrb53): small, quick and the same on every machine. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * What identifies a page when a new version of the file comes: the start of its text, normalized, plus a hash of all of
 * it. A page without text (a scan) can only be told by where it is, so its fingerprint is its index.
 */
export function pageFingerprint(text: string, index: number): string {
  const t = normalizeQuote(text).trim();
  return t ? `${t.slice(0, FINGERPRINT_HEAD)}#${hash(t)}` : `index:${index}`;
}

/** The first words of a page, for the quote a reference carries (it stays when the file is gone). */
export function pageQuote(text: string, max = 60): string {
  const t = normalizeQuote(text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** One slide: the pages from `first` to `last` (1-based, inclusive); the last one shows everything built up so far. */
export interface Slide {
  first: number;
  last: number;
}

/**
 * Slides from page labels: consecutive pages with the same (non-empty) label are the overlays of one slide. Without
 * labels every page is a slide.
 */
export function slideGroups(labels: readonly (string | null | undefined)[] | null, count: number): Slide[] {
  const out: Slide[] = [];
  for (let n = 1; n <= count; n++) {
    const label = labels?.[n - 1]?.trim();
    const prev = out[out.length - 1];
    if (prev && label && labels?.[prev.last - 1]?.trim() === label) prev.last = n;
    else out.push({ first: n, last: n });
  }
  return out;
}

/** The slide (index into `slideGroups`) a page belongs to. */
export function slideOfPage(slides: readonly Slide[], page: number): number {
  let lo = 0;
  let hi = slides.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slides[mid]!.last < page) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
