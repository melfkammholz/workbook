import { focusOf, inFocus, type ExerciseMeta, type Outline, type StudentState } from '@wb/shared';

export type SuggestionReason = 'review-due' | 'continue' | 'next-up' | 'similar' | 'start-here' | 'ready';

export interface Suggestion {
  id: string;
  reason: SuggestionReason;
}

/**
 * What should the student do next? Pure guidance — nothing is ever locked.
 *
 * Order of preference:
 *  1. exercises marked "review later" that are due again,
 *  2. exercises they started but did not finish,
 *  3. unfinished exercises in the student's focus, scored by: on the recommended path,
 *     prerequisites done, directly follows / is similar to the last finished exercise.
 * The first two are the student's own work, so they are suggested whatever the focus.
 */
export function suggestNext(outline: Outline, state: StudentState, now: number, limit = 5): Suggestion[] {
  const exercises = outline.chapters.flatMap((c) => c.items).filter((i): i is ExerciseMeta => i.type === 'exercise');
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const status = (id: string) => state.progress[id]?.status ?? 'todo';
  const out: Suggestion[] = [];
  const taken = new Set<string>();
  const push = (id: string, reason: SuggestionReason) => {
    if (taken.has(id) || out.length >= limit) return;
    taken.add(id);
    out.push({ id, reason });
  };

  exercises
    .filter((e) => status(e.id) === 'review' && (state.progress[e.id]!.reviewDueAt ?? 0) <= now)
    .sort((a, b) => state.progress[a.id]!.reviewDueAt! - state.progress[b.id]!.reviewDueAt!)
    .forEach((e) => push(e.id, 'review-due'));

  exercises
    .filter((e) => status(e.id) === 'in_progress')
    .sort((a, b) => state.progress[b.id]!.updatedAt - state.progress[a.id]!.updatedAt)
    .slice(0, 2)
    .forEach((e) => push(e.id, 'continue'));

  const lastDone = exercises
    .filter((e) => status(e.id) === 'done')
    .sort((a, b) => state.progress[b.id]!.updatedAt - state.progress[a.id]!.updatedAt)[0];

  const focus = focusOf(state);
  const scored = exercises
    .filter((e) => (status(e.id) === 'todo' || status(e.id) === 'review') && !taken.has(e.id) && inFocus(e, focus))
    .map((e) => {
      const unmet = e.after.filter((a) => byId.has(a) && status(a) !== 'done').length;
      const follows = lastDone?.next.includes(e.id) ?? false;
      const similar = !!lastDone && (lastDone.similar.includes(e.id) || e.similar.includes(lastDone.id));
      const score =
        (e.startHere ? 50 : 0) +
        (unmet === 0 ? 20 : -10 * unmet) +
        (follows ? 25 : 0) +
        (similar ? 15 : 0) +
        (lastDone && lastDone.chapterId === e.chapterId ? 5 : 0) -
        e.index * 0.01;
      const reason: SuggestionReason = follows ? 'next-up' : similar ? 'similar' : e.startHere ? 'start-here' : 'ready';
      return { e, score, reason };
    })
    .sort((a, b) => b.score - a.score);
  for (const s of scored) push(s.e.id, s.reason);
  return out;
}
