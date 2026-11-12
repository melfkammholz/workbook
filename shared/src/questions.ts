// Open questions: what the student wants to find out, with where it came up. Global, like highlights.
import type { Anchor } from './anchors';
import type { CardKind } from './index';

/** A question may have no text (a "come back to" mark), so its anchor is what says what it is about. */
export interface Question {
  id: string;
  text: string;
  anchor: Anchor;
  /** The workbook it was asked in; '' for a question about a file the student uploaded. */
  course: string;
  /** The highlight it was made from, if any. The question keeps its own anchor when the highlight goes. */
  highlightId: string | null;
  /** A question on a page of a PDF that the new version of the file could not place: it waits to be fixed or dropped. */
  unplaced: boolean;
  status: 'open' | 'done';
  answer: string | null;
  /** What kind of question it is; the student's or the assistant's (accepted proposal) choice. Untyped until then. */
  kind: QuestionKind | null;
  /** Who asked it when it was not the student, e.g. 'assistant' (an accepted proposal). */
  who: string | null;
  /** Set when it was a duplicate: the question that took its place. It stays in the list, closed, with this link. */
  mergedInto: string | null;
  /** Ids of the student's labels on it (topics, clusters). */
  labels: string[];
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
}

export const MAX_QUESTION = 2000;
/** Characters of a page kept with a question about it. */
export const SNIPPET_LENGTH = 200;

/** The small fixed set of question types. */
export const QUESTION_KINDS = ['concept', 'why', 'how', 'check', 'example', 'where'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** At most this many proposals wait in the inbox; beyond that the assistant is told it is full. */
export const MAX_PENDING_CHANGES = 100;

/**
 * What a proposal changes about a question: its type, its labels (all names it should carry), an answer or a rewrite of
 * its text. `create` makes something new (see `CreatePayload`); then `after` is the payload and `before` stays empty
 * until accepted, when it holds `{ id }` of what was made, so that undo can remove it.
 */
export type ChangeField = 'kind' | 'labels' | 'answer' | 'text' | 'create' | 'merge';
export type ChangeStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'undone';
/** What a proposal can make: a flashcard (in an existing or a new deck), a note on a PDF page, a question. */
export type ChangeRefKind = 'question' | 'card' | 'highlight';

export interface CardPayload {
  deck: { id: string } | { title: string };
  cardKind: CardKind;
  front: string;
  back: string;
  anchor: Anchor | null;
}
/** A passage of a material with the assistant's note, made as a note on that page (highlights need page positions only the viewer knows). */
export interface HighlightPayload {
  resource: string;
  /** 0-based. */
  pageIndex: number;
  quote: string;
  note: string;
}
export interface QuestionPayload {
  text: string;
  anchor: Anchor;
}
export type CreatePayload = CardPayload | HighlightPayload | QuestionPayload;
/** What was made when a creation was accepted. */
export interface Created {
  id: string;
  /** A deck that the card's acceptance made as well. */
  deck?: string;
  /** A page note: what the page's note said before (the assistant's text was added below it). */
  note?: string;
}
/**
 * A `merge` proposal is about the question that survives (`ref`). Its answer and labels are joined with those of the
 * duplicates, which close as "merged into" it; `text` is an optional rewording of the survivor.
 */
export interface MergePayload {
  duplicates: string[];
  text?: string;
}
/** What accepting a merge replaced, so that undo puts it back. */
export interface MergeUndo {
  survivor: { text: string; answer: string | null; status: 'open' | 'done'; doneAt: number | null; updatedAt: number; labels: string[] };
  duplicates: { id: string; status: 'open' | 'done'; doneAt: number | null; answer: string | null; labels: string[] }[];
}
export type ChangeValue = string | string[] | null | CreatePayload | Created | MergePayload | MergeUndo;

/**
 * One line of the `changes` log: the inbox (pending), the audit log (applied) and the undo. `before` and `after` are
 * what the field held and would hold: the type or null, label names, the answer text or null.
 */
export interface Change {
  id: string;
  /** Who made it, e.g. 'assistant'. */
  who: string;
  /** What it is about; for a creation of a thing that does not exist yet, `id` is '' until accepted. */
  ref: { kind: ChangeRefKind; id: string };
  field: ChangeField;
  before: ChangeValue;
  after: ChangeValue;
  /** Changes proposed together (for one question) share a group. */
  group: string;
  status: ChangeStatus;
  /** Why the assistant proposes it. */
  reason: string;
  /** What the student told the assistant when deciding. Visible to it. */
  feedback: string;
  /** Proposals accepted together share a batch; undoing it undoes them all. */
  batch: string | null;
  createdAt: number;
  decidedAt: number | null;
}
