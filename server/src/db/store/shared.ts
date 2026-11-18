import {
  type Annotation,
  type AnnotationColor,
  type AnnotationReview,
  type HowSolved,
  type Ticket,
  type Todo,
  type TodoStatus,
  type TodoLink,
  type TodoOrigin,
  TODO_STATUSES,
  type TicketLink,
  type AnswerBy,
  type Anchor,
  type Change,
  type ChangeField,
  type ChangeRefKind,
  type ChangeValue,
  type CreatePayload,
  type Created,
  type ChangeStatus,
  type ProgressEntry,
  type Reflection,
  type Stats,
  type Status,
} from '@wb/shared';


export const DAY = 86_400_000;
/** Review intervals in days: how long "review later" waits, growing each time it is chosen again. */
export const REVIEW_DAYS = [2, 4, 8, 16, 30];
/** An autosave only becomes a history entry if the last one is at least this old. */
export const VERSION_MIN_GAP = 5 * 60_000;
export const MAX_VERSIONS = 60;
/** One tick from the client is at most this many seconds, so a forgotten open tab cannot inflate time spent. */
export const MAX_TICK_SECONDS = 120;

export type Row = Record<string, unknown>;
export type SearchSource = 'note' | 'answer' | 'annotation' | 'question' | 'material' | 'todo';
/** What the index found; `anchor` says where it is (`kind` as in `Anchor`, plus `id` of the highlight, page item or question, and `slot`). */
export interface SearchHit {
  course: string | null;
  anchor: { kind: string; course?: string; id?: string; questionId?: string; target?: string; slot?: string; resource?: string; pageIndex?: number };
  source: SearchSource;
  snippet: string;
}
/** Course of the rows that belong to the student rather than to a course. */
export const GLOBAL = '';

/**
 * What accepting a proposal that makes something needs from outside the database: the decks and the uploaded files
 * have services of their own. Set once by whoever owns them (`Store.useCreators`).
 */
export interface ChangeCreators {
  /** Makes a card or a page note; throws `Error` with a message for the student if it cannot. */
  create(kind: 'card' | 'highlight', payload: CreatePayload): Created;
  /** Takes away what `create` made. */
  remove(kind: 'card' | 'highlight', made: Created): void;
  /** True if what the payload points at (deck, material) is gone. */
  gone(kind: 'card' | 'highlight', payload: CreatePayload): boolean;
  /** The deck of each of these cards that still exists (card id to deck id). */
  cardDecks(ids: string[]): Map<string, string>;
}


// ───────────────────────── row mapping ─────────────────────────

export class ChangeError extends Error {}

export function rowToChange(r: Row): Change {
  const parse = (v: unknown) => (typeof v === 'string' ? (JSON.parse(v) as ChangeValue) : null);
  return {
    id: r.id as string,
    who: r.who as string,
    ref: { kind: r.ref_kind as ChangeRefKind, id: r.ref_id as string },
    field: r.field as ChangeField,
    before: parse(r.before),
    after: parse(r.after),
    group: r.group_id as string,
    batch: (r.batch_id as string | null) ?? null,
    status: r.status as ChangeStatus,
    reason: r.reason as string,
    feedback: r.feedback as string,
    createdAt: Number(r.created_at),
    decidedAt: r.decided_at === null ? null : Number(r.decided_at),
  };
}

export function rowToTodo(r: Row): Todo {
  return {
    id: r.id as string,
    parentId: (r.parent_id as string | null) ?? null,
    sort: Number(r.sort),
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    status: TODO_STATUSES.includes(r.status as TodoStatus) ? (r.status as TodoStatus) : 'open',
    course: (r.course as string | null) ?? null,
    link: r.link_kind ? { kind: r.link_kind as TodoLink['kind'], ref: r.link_ref as string, title: (r.link_title as string | null) ?? null } : null,
    due: (r.due as string | null) ?? null,
    minutes: r.minutes === null ? null : Number(r.minutes),
    nextRank: r.next_rank === null ? null : Number(r.next_rank),
    origin: r.origin as TodoOrigin,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    doneAt: r.done_at === null ? null : Number(r.done_at),
    children: [],
  };
}

export function rowToTicket(r: Row, labels: string[] = [], links: TicketLink[] = [], fetched: Ticket['fetched'] = null): Ticket {
  return {
    id: r.id as string,
    text: r.text as string,
    anchor: JSON.parse(r.anchor as string) as Anchor,
    course: r.course as string,
    highlightId: (r.highlight_id as string | null) ?? null,
    unplaced: Number(r.unplaced) === 1,
    read: Number(r.read) === 1,
    archived: Number(r.archived) === 1,
    answer: (r.answer as string | null) ?? null,
    answerBy: r.answer ? ((r.answer_by as AnswerBy | null) ?? 'assistant') : null,
    links,
    who: (r.who as string | null) ?? null,
    mergedInto: (r.merged_into as string | null) ?? null,
    labels,
    fetched,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    archivedAt: r.archived_at === null ? null : Number(r.archived_at),
  };
}

/** Undo data stored before the mail model has `status` and `doneAt`. */
export const wasArchived = (u: { archived?: boolean; status?: string }) => u.archived ?? u.status === 'done';
export const wasArchivedAt = (u: { archivedAt?: number | null; doneAt?: number | null }) => u.archivedAt ?? u.doneAt ?? null;

export function rowToProgress(r: Row): ProgressEntry {
  return {
    status: r.status as Status,
    updatedAt: Number(r.updated_at),
    reviewDueAt: r.review_due_at === null ? null : Number(r.review_due_at),
    reviewCount: Number(r.review_count),
  };
}

export function rowToReflection(r: Row): Reflection {
  return {
    id: Number(r.id),
    exerciseId: r.exercise_id as string,
    confidence: Number(r.confidence) as Reflection['confidence'],
    how: JSON.parse(r.how as string) as HowSolved[],
    comment: r.comment as string,
    createdAt: Number(r.created_at),
  };
}

export function rowToAnnotation(r: Row, reviews: Map<string, AnnotationReview>, tags: string[]): Annotation {
  return {
    id: r.id as string,
    target: r.target as string,
    part: r.part as string,
    quote: r.quote as string,
    prefix: r.prefix as string,
    suffix: r.suffix as string,
    color: r.color as AnnotationColor,
    tags,
    comment: r.comment as string,
    review: reviews.get(r.id as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function emptyStats(): Stats {
  return { activeSeconds: 0, checkRuns: 0, checkPasses: 0, hintsRevealed: 0, solutionViewedAt: null, firstOpenedAt: null, lastOpenedAt: null };
}

export function rowToStats(r: Row): Stats {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    activeSeconds: Number(r.active_seconds),
    checkRuns: Number(r.check_runs),
    checkPasses: Number(r.check_passes),
    hintsRevealed: Number(r.hints_revealed),
    solutionViewedAt: n(r.solution_viewed_at),
    firstOpenedAt: n(r.first_opened_at),
    lastOpenedAt: n(r.last_opened_at),
  };
}
