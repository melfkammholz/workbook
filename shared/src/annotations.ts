// Highlights and comments on the course's text. Pure: no DOM, so the server and the tests can use it.
import type { TextQuote } from './anchors';

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

/** The item a target is about, or null for a chapter introduction, an adventure page or the landing page. */
export const itemOfTarget = (target: string): string | null => (target.includes('/') || target === 'landing' ? null : target);

/** Where a target is read. */
export function targetHref(target: string): string {
  if (target === 'landing') return '/welcome';
  if (target.startsWith('chapter/')) return `/chapter/${target.slice(8)}`;
  if (target.startsWith('thread/')) return `/adventure/${target.slice(7)}`;
  return `/item/${target}`;
}

