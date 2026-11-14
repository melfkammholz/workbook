/** What the student can ask the assistant to do from the app; each kind is one app-served skill. */
export const REQUEST_KINDS = ['answer', 'cards', 'assess', 'exercise-help'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export type RequestStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export const MAX_REQUEST_QUESTIONS = 50;
export const MAX_REQUEST_NOTE = 600;

/** The skill that handles each kind of request. */
export const REQUEST_SKILL: Record<RequestKind, string> = {
  answer: 'workbook-answer-recent',
  cards: 'workbook-cards-from-confusion',
  assess: 'workbook-assess',
  'exercise-help': 'workbook-exercise-help',
};

/** Only ids and the student's free note: the text of questions is read through the MCP, so the fetch log stays truthful. */
export interface RequestParams {
  /** Question ids; empty with `answer` means the unread open ones of the workbook. */
  questions: string[];
  /** The exercise of an `exercise-help` request. */
  item?: string;
  /** The student's own words to the assistant: data, never instruction text of the helper. */
  note?: string;
}

export interface AssistantRequest {
  id: string;
  kind: RequestKind;
  skill: string;
  params: RequestParams;
  workbook: string;
  status: RequestStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  /** The last lines of what the assistant program printed (shown for failures). */
  logTail: string;
  /** What the run did, from the app's own records: questions read and proposals made. */
  summary: { read: number; proposed: number } | null;
  /** The student dismissed a finished or failed request, so it is no longer shown. */
  dismissed: boolean;
}

export interface AssistantStatus {
  /** Requests may be queued (setting on). */
  allowed: boolean;
  /** A helper asked for work in the last minute. */
  connected: boolean;
  hasKey: boolean;
  /** Queued and running requests, then lately finished ones that were not dismissed. */
  requests: AssistantRequest[];
}

/** The helper counts as connected when it was seen this recently. */
export const HELPER_SEEN_MS = 60_000;
