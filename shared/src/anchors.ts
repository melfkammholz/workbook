// Where a thing the student made is found again, in text that may change: a quote with its context, on a page of a
// PDF or in a text of the workbook. Pure: no DOM, so the server, the browser and the tests share it.
import type { PageRect } from './pdfAnnotations';

/**
 * Where a highlight is found again: the quoted text with a little context on both sides. The author may change the
 * text, so positions in the HTML would not last; a quote that is gone leaves the highlight without a place, not lost.
 */
export interface TextQuote {
  quote: string;
  prefix: string;
  suffix: string;
}

/** Characters of context kept on each side. */
export const QUOTE_CONTEXT = 32;
/** Longer selections are refused: a highlight is a passage, not a page. */
export const MAX_QUOTE = 2000;

/** Whitespace in the HTML is layout, not text: every run of it counts as one space. */
const WS = /\s+/g;
export const normalizeQuote = (s: string): string => s.replace(WS, ' ');

/** A text with its whitespace collapsed, and for each of its characters the offset in the original. */
function collapse(text: string): { text: string; at: number[] } {
  let out = '';
  const at: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      if (space) continue;
      space = true;
      out += ' ';
    } else {
      space = false;
      out += c;
    }
    at.push(i);
  }
  at.push(text.length);
  return { text: out, at };
}

/** The quote for `[start, end)` of `text`, with context. Null for a selection of nothing but whitespace. */
export function quoteAt(text: string, start: number, end: number): TextQuote | null {
  const quote = normalizeQuote(text.slice(start, end));
  if (!quote.trim()) return null;
  return {
    quote,
    prefix: normalizeQuote(text.slice(Math.max(0, start - QUOTE_CONTEXT * 2), start)).slice(-QUOTE_CONTEXT),
    suffix: normalizeQuote(text.slice(end, end + QUOTE_CONTEXT * 2)).slice(0, QUOTE_CONTEXT),
  };
}

/** Characters two strings share at their ends (`fromEnd`) or starts. */
function shared(a: string, b: string, fromEnd: boolean): number {
  let n = 0;
  while (n < a.length && n < b.length && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++;
  return n;
}

/**
 * Finds a quote in `text` again: `[start, end)` in the original text, or null when it is not there. Of several
 * occurrences, the one whose surroundings agree best with the stored context wins; the first on a tie.
 */
export function locateQuote(text: string, q: TextQuote): { start: number; end: number } | null {
  const found = locateQuoteScored(text, q);
  return found && { start: found.start, end: found.end };
}

/** `locateQuote` with how well the surroundings agree (characters of context shared), to compare pages. */
export function locateQuoteScored(text: string, q: TextQuote): { start: number; end: number; score: number } | null {
  if (!q.quote) return null;
  const c = collapse(text);
  let best: { at: number; score: number } | null = null;
  for (let i = c.text.indexOf(q.quote); i !== -1; i = c.text.indexOf(q.quote, i + 1)) {
    const before = c.text.slice(Math.max(0, i - q.prefix.length), i);
    const after = c.text.slice(i + q.quote.length, i + q.quote.length + q.suffix.length);
    const score = shared(before, q.prefix, true) + shared(after, q.suffix, false);
    if (!best || score > best.score) best = { at: i, score };
  }
  if (!best) return null;
  return { start: c.at[best.at]!, end: c.at[best.at + q.quote.length - 1]! + 1, score: best.score };
}

/**
 * What a student's note, highlight or question points at. `text`: a quoted passage of a workbook's text (`target` and
 * `part` as in `AnnotationPlace`). `page`: a page of a file the student uploaded, found again in a new version by its
 * fingerprint, or by the quote when there is one. `exercise` and `item`: a whole exercise, or any other item of a
 * workbook (lesson, checklist, …) or a chapter (`chapter/<id>`), by its id; there is no text to find again. `material`: a whole file the student uploaded, no page. `none`: asked
 * where nothing was open. `snippet` on a page: about 200 characters of the page around the question.
 */
export type Anchor =
  | { kind: 'exercise'; course: string; id: string }
  | { kind: 'item'; course: string; id: string }
  | ({ kind: 'text'; course: string; target: string; part: string } & TextQuote)
  | ({ kind: 'page'; resource: string; version: string; pageIndex: number; fingerprint: string; rects?: PageRect[]; snippet?: string } & Partial<TextQuote>)
  | { kind: 'material'; resource: string }
  | { kind: 'none' };

/** A reference to something stored; `version` is its `updatedAt`, so a reader can tell the reference is stale. */
export interface EntityRef {
  kind: string;
  id: string;
  version: number;
}

