// Highlights and comments on the course's text. Pure: no DOM, so the server and the tests can use it.

export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type PaletteColor = (typeof ANNOTATION_COLORS)[number];
/** One of the palette, or a color the student added: `#rrggbb`, lower case. */
export type AnnotationColor = PaletteColor | `#${string}`;

const HEX = /^#[0-9a-f]{6}$/;
export const isCustomColor = (c: string): c is `#${string}` => HEX.test(c);
export const isAnnotationColor = (c: string): c is AnnotationColor => (ANNOTATION_COLORS as readonly string[]).includes(c) || HEX.test(c);
/** The same color written the same way, so two labels cannot have one color in two spellings. */
export const normalizeColor = (c: string): string => c.toLowerCase();

/** A name the student gives to highlights, with the color they get. Kept in the settings. */
export interface HighlightLabel {
  id: string;
  name: string;
  color: AnnotationColor;
}

/** `open`: the student marked it to come back to; `resolved`: they did. */
export type AnnotationReview = 'open' | 'resolved';

/**
 * Where a highlight is found again: the quoted text with a little context on both sides. The author may change the
 * text, so positions in the HTML would not last; a quote that is gone leaves the highlight without a place, not lost.
 */
export interface TextQuote {
  quote: string;
  prefix: string;
  suffix: string;
}

/**
 * What a highlight belongs to. `target`: an item id, or `chapter/<id>`, `thread/<id>`, `landing` for the author's other
 * texts. `part`: `task`, `remark-<n>` or `hint-<n>`, so that the AI prompt can leave out anything but the task.
 */
export interface AnnotationPlace {
  target: string;
  part: string;
}

export interface Annotation extends AnnotationPlace, TextQuote {
  id: string;
  color: AnnotationColor;
  /** The id of one of the student's labels, or null. The color stays when the label is removed. */
  label: string | null;
  /** Plain text. */
  comment: string;
  review: AnnotationReview | null;
  createdAt: number;
  updatedAt: number;
}

/** In the list of all of them: whether the quote is still in the text. */
export interface AnnotationEntry extends Annotation {
  found: boolean;
}

/** Characters of context kept on each side. */
export const QUOTE_CONTEXT = 32;
/** Longer selections are refused: a highlight is a passage, not a page. */
export const MAX_QUOTE = 2000;

/** The item a target is about, or null for a chapter introduction, an adventure page or the landing page. */
export const itemOfTarget = (target: string): string | null => (target.includes('/') || target === 'landing' ? null : target);

/** Where a target is read. */
export function targetHref(target: string): string {
  if (target === 'landing') return '/welcome';
  if (target.startsWith('chapter/')) return `/chapter/${target.slice(8)}`;
  if (target.startsWith('thread/')) return `/adventure/${target.slice(7)}`;
  return `/item/${target}`;
}

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
