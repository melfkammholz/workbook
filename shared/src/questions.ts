// Open questions: what the student wants to find out, with where it came up. Global, like highlights.
import type { Anchor } from './anchors';

/** A question may have no text (a "come back to" mark), so its anchor is what says what it is about. */
export interface Question {
  id: string;
  text: string;
  anchor: Anchor;
  /** The workbook it was asked in; '' for a question about a file the student uploaded. */
  course: string;
  /** The highlight it was made from, if any. The question keeps its own anchor when the highlight goes. */
  highlightId: string | null;
  /** Captures made in one sitting share a pass. */
  passId: number | null;
  status: 'open' | 'done';
  answer: string | null;
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
}

export const MAX_QUESTION = 2000;
/** Without a capture for this long, the next one starts a new pass. */
export const PASS_GAP_MS = 30 * 60_000;
