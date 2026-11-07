import { useMutation, useQueryClient } from '@tanstack/react-query';
import { focusOf, inFocus, type ExerciseMeta, type Focus, type ItemMeta, type Outline, type StudentState } from '@wb/shared';
import { api, isExercise, keys, statusOf, type StateResponse } from './api';

export { focusOf, inFocus };

/**
 * The focuses a course can tell apart. Without start-here exercises "essentials" would show nothing,
 * and without extra material "thorough" shows the same as "everything".
 */
export function focusesOf(outline: Outline): Focus[] {
  const items = outline.chapters.flatMap((c) => c.items);
  const exercises = items.filter(isExercise);
  const extra = items.some((i) => (i.type === 'exercise' || i.type === 'lesson') && i.extra);
  const out: Focus[] = [];
  if (exercises.some((e) => e.startHere)) out.push('essentials');
  out.push(extra ? 'thorough' : 'everything');
  if (extra) out.push('everything');
  return out;
}

/** The focus as the course can show it: "thorough" and "everything" are one choice in a course without extra material. */
export function shownFocus(outline: Outline, focus: Focus): Focus {
  const offered = focusesOf(outline);
  if (offered.includes(focus)) return focus;
  return focus === 'essentials' ? offered[0]! : offered.at(-1)!;
}

/** Pages, checklists and lessons are always in the focus, except a lesson that is extra material. */
export function itemInFocus(item: ItemMeta, focus: Focus): boolean {
  if (item.type === 'lesson') return !item.extra || focus === 'everything';
  return !isExercise(item) || inFocus(item, focus);
}

/** Exercises the student already worked on stay in sight whatever the focus, so narrowing it never hides their work. */
export function staysInSight(item: ItemMeta, state: StudentState | undefined): boolean {
  return itemInFocus(item, focusOf(state)) || statusOf(state, item.id) !== 'todo';
}

/** What the progress counts: the exercises in the focus. */
export function focusExercises(items: ItemMeta[], state: StudentState | undefined): ExerciseMeta[] {
  const focus = focusOf(state);
  return items.filter(isExercise).filter((e) => inFocus(e, focus));
}

export function useSetFocus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (focus: Focus) => api.put('/api/focus', { focus }),
    onMutate: (focus) => {
      qc.setQueryData<StateResponse>(keys.state, (old) => (old ? { ...old, state: { ...old.state, focus } } : old));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.state });
      void qc.invalidateQueries({ queryKey: keys.achievements });
    },
  });
}

export type FoldEntry =
  | { kind: 'item'; item: ItemMeta; outside: boolean }
  /** Exercises of one section outside the focus. Open, they stand in their places and this line folds them away again. */
  | { kind: 'fold'; key: string; sectionId: string | null; hidden: ItemMeta[]; open: boolean };

/**
 * A chapter's items as a list shows them: what is outside the focus folds into one line at the end of its section.
 * Nothing disappears silently, and work already done stays in its place. `unfold` shows everything (while filtering).
 */
export function foldItems(chapterId: string, items: ItemMeta[], state: StudentState | undefined, opened: ReadonlySet<string>, unfold = false): FoldEntry[] {
  const focus = focusOf(state);
  const out: FoldEntry[] = [];
  let start = 0;
  while (start < items.length) {
    let end = start;
    while (end < items.length && items[end]!.sectionId === items[start]!.sectionId) end++;
    const group = items.slice(start, end);
    const key = `${chapterId}/${group[0]!.sectionId ?? `-${start}`}`;
    const hidden = group.filter((i) => !staysInSight(i, state));
    const open = unfold || opened.has(key);
    for (const item of group) if (open || !hidden.includes(item)) out.push({ kind: 'item', item, outside: !itemInFocus(item, focus) });
    if (hidden.length && !unfold) out.push({ kind: 'fold', key, sectionId: group[0]!.sectionId, hidden, open });
    start = end;
  }
  return out;
}
