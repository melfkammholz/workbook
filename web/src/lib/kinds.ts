import { NotebookPen, ScrollText, UsersRound } from 'lucide-react';
import type { Outline, StudentState, ThreadKind } from '@wb/shared';
import { THREAD_KINDS } from '@wb/shared';
import { statusOf } from './api';

/** One icon per kind, the same in the outline and on the home page. */
export const KIND_ICONS = { session: UsersRound, homework: NotebookPen, exam: ScrollText } as const;

/** The kinds this course has, in their fixed order. */
export const kindsOf = (outline: Outline): ThreadKind[] => THREAD_KINDS.filter((k) => outline.threads.some((x) => x.kind === k));

/** All that a kind's groups list, each item once, and how much of it is done. */
export function kindProgress(outline: Outline, kind: ThreadKind, state: StudentState | undefined) {
  const ids = [...new Set(outline.threads.filter((x) => x.kind === kind).flatMap((x) => x.steps.flat()))];
  return { done: ids.filter((id) => statusOf(state, id) === 'done').length, total: ids.length };
}
