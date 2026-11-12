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
  /** A question on a page of a PDF that the new version of the file could not place: it waits to be fixed or dropped. */
  unplaced: boolean;
  status: 'open' | 'done';
  answer: string | null;
  /** What kind of question it is; the student's or the assistant's (accepted proposal) choice. Untyped until then. */
  kind: QuestionKind | null;
  /** Ids of the student's labels on it (topics, clusters). */
  labels: string[];
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
}

export const MAX_QUESTION = 2000;
/** Without a capture for this long, the next one starts a new pass. */
export const PASS_GAP_MS = 30 * 60_000;
/** Characters of a page kept with a question about it. */
export const SNIPPET_LENGTH = 200;

/** The small fixed set of question types. */
export const QUESTION_KINDS = ['concept', 'why', 'how', 'check', 'example', 'where'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** At most this many proposals wait in the inbox; beyond that the assistant is told it is full. */
export const MAX_PENDING_CHANGES = 100;

/** What a proposal changes about a question: its type, its labels (all names it should carry) or an answer. */
export type ChangeField = 'kind' | 'labels' | 'answer';
export type ChangeStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'undone';

/**
 * One line of the `changes` log: the inbox (pending), the audit log (applied) and the undo. `before` and `after` are
 * what the field held and would hold: the type or null, label names, the answer text or null.
 */
export interface Change {
  id: string;
  /** Who made it, e.g. 'assistant'. */
  who: string;
  /** What it is about; only questions so far. */
  ref: { kind: 'question'; id: string };
  field: ChangeField;
  before: string | string[] | null;
  after: string | string[] | null;
  /** Changes proposed together (for one question) share a group. */
  group: string;
  status: ChangeStatus;
  /** Why the assistant proposes it. */
  reason: string;
  /** What the student told the assistant when deciding. Visible to it. */
  feedback: string;
  createdAt: number;
  decidedAt: number | null;
}
