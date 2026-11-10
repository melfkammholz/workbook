import { focusOf, inFocus, type AchievementEvent, type ChapterMeta, type ChecklistMeta, type ExerciseMeta, type Outline, type Reflection, type StudentState } from '@wb/shared';

export interface ChecklistRating {
  checklistId: string;
  questionId: string;
  confidence: number;
}

export interface AchievementInput {
  outline: Outline;
  state: StudentState;
  /** Every rating ever given, oldest first. */
  reflections: Reflection[];
  /** Every rating of a checklist question ever given, oldest first. */
  checklistRatings: ChecklistRating[];
  noteCount: number;
  /** Passages marked to come back to, and later cleared up. Optional: older callers have none. */
  resolvedMarks?: number;
}

const LOW = 2;
const HIGH = 4;
/** Failed test runs before one that passed, to count as having stuck with it. */
const PERSISTENT_RUNS = 5;
const CHECKLIST_ANSWERS = 3;
const NOTES = 5;
const RESOLVED_MARKS = 5;

const exercisesOf = (c: ChapterMeta) => c.items.filter((i): i is ExerciseMeta => i.type === 'exercise');
const checklistsOf = (c: ChapterMeta) => c.items.filter((i): i is ChecklistMeta => i.type === 'checklist');

/**
 * Which exercises a chapter's plant grows with, and how many of them have to be done.
 * It follows the focus, so every focus can feel finished. A course without extra material keeps the
 * older rule outside "essentials": the recommended ones, or else half of all of them.
 */
function plantGoal(chapter: ChapterMeta, state: StudentState, courseHasExtra: boolean): { counted: ExerciseMeta[]; target: number } {
  const exercises = exercisesOf(chapter);
  const focus = focusOf(state);
  if (focus === 'essentials' || courseHasExtra) {
    const counted = exercises.filter((e) => inFocus(e, focus));
    return { counted, target: counted.length };
  }
  const recommended = exercises.filter((e) => e.startHere);
  return recommended.length ? { counted: recommended, target: recommended.length } : { counted: exercises, target: Math.ceil(exercises.length / 2) };
}

/** A chapter has a plant when it has exercises, and something to grow it with in the student's focus. */
function hasPlant(chapter: ChapterMeta, state: StudentState, courseHasExtra: boolean): boolean {
  return exercisesOf(chapter).length > 0 && (plantGoal(chapter, state, courseHasExtra).target > 0 || checklistsOf(chapter).length > 0);
}

/**
 * How far a chapter's plant has grown: 0 nothing yet, 1 started, 2 halfway, 3 grown.
 * Depends on work done and questions answered, never on how high the ratings are:
 * nobody should have a reason to rate themselves higher than they feel.
 * With nothing of the chapter in the focus, answering its checklists is what grows it.
 */
export function chapterStage(chapter: ChapterMeta, state: StudentState, courseHasExtra = false): 0 | 1 | 2 | 3 {
  const exercises = exercisesOf(chapter);
  const checklists = checklistsOf(chapter);
  const status = (id: string) => state.progress[id]?.status ?? 'todo';
  const answers = (id: string) => Object.keys(state.checklists[id] ?? {}).length;

  const { counted, target } = plantGoal(chapter, state, courseHasExtra);
  const done = counted.filter((e) => status(e.id) === 'done').length;

  const checklistsAnswered = checklists.every((c) => answers(c.id) >= c.questionCount);
  if (target > 0 && done >= target && checklistsAnswered) return 3;
  if (target === 0 && exercises.length > 0 && checklists.length > 0 && checklistsAnswered) return 3;
  if (target > 0 && done >= Math.ceil(target / 2)) return 2;
  if (exercises.some((e) => status(e.id) !== 'todo') || checklists.some((c) => answers(c.id) > 0)) return 1;
  return 0;
}

/** Everything the student qualifies for right now, keyed by a stable id. */
export function qualifiesFor(input: AchievementInput): Map<string, AchievementEvent> {
  const { outline, state, reflections, checklistRatings, noteCount, resolvedMarks = 0 } = input;
  const out = new Map<string, AchievementEvent>();
  const exercises = outline.chapters.flatMap(exercisesOf);
  const checklists = outline.chapters.flatMap(checklistsOf);
  const status = (id: string) => state.progress[id]?.status ?? 'todo';
  const stats = (id: string) => state.stats[id];
  const add = (id: string) => out.set(`a/${id}`, { kind: 'achievement', id });

  if (exercises.some((e) => status(e.id) === 'done')) add('first-steps');
  if (exercises.some((e) => {
    const s = stats(e.id);
    return status(e.id) === 'done' && s && s.checkPasses > 0 && s.hintsRevealed === 0 && !s.solutionViewedAt;
  })) add('on-your-own');
  if (exercises.some((e) => {
    const s = stats(e.id);
    return s && s.checkPasses > 0 && s.checkRuns - s.checkPasses >= PERSISTENT_RUNS;
  })) add('persistent');
  if (Object.keys(state.openQuestions).length > 0) add('curious');
  if (reflections.some((r) => r.confidence <= LOW) || checklistRatings.some((r) => r.confidence <= LOW)) add('honest');
  if (exercises.some((e) => status(e.id) === 'done' && (state.progress[e.id]?.reviewCount ?? 0) > 0)) add('back-again');
  if (Object.values(state.checklists).reduce((n, c) => n + Object.keys(c).length, 0) >= CHECKLIST_ANSWERS) add('self-aware');
  if (noteCount >= NOTES) add('note-taker');
  // The second pass over one's own highlights, not the highlighting: that would reward marking everything.
  if (resolvedMarks >= RESOLVED_MARKS) add('cleared-up');
  if (exercises.some((e) => {
    const s = stats(e.id);
    return s && s.checkRuns === 1 && s.checkPasses === 1;
  })) add('first-try');

  const recommended = exercises.filter((e) => e.startHere);
  if (recommended.length > 0 && recommended.every((e) => status(e.id) === 'done')) add('all-animals');

  const courseHasExtra = exercises.some((e) => e.extra);
  const planted = outline.chapters.filter((c) => hasPlant(c, state, courseHasExtra));
  if (planted.length > 0 && planted.every((c) => chapterStage(c, state, courseHasExtra) === 3)) add('forest');

  for (const e of recommended)
    if (e.emoji && status(e.id) === 'done') out.set(`animal/${e.id}`, { kind: 'animal', exerciseId: e.id, title: e.title, emoji: e.emoji });

  for (const chapter of outline.chapters) {
    const stage = chapterStage(chapter, state, courseHasExtra);
    for (let n = 1; n <= stage; n++) out.set(`plant/${chapter.id}/${n}`, { kind: 'plant', chapterId: chapter.id, chapter: chapter.title, stage: n as 1 | 2 | 3 });
  }

  for (const thread of outline.threads) {
    if (!thread.adventure || thread.steps.length === 0) continue;
    if (thread.steps.every((step) => step.some((id) => status(id) === 'done'))) {
      out.set(`adventure/${thread.id}`, { kind: 'adventure', title: thread.title });
      add('adventurer');
    }
  }

  // Comebacks: rated low once, rated high later.
  const comeback = (key: string, title: string, ratings: number[]) => {
    const firstLow = ratings.findIndex((c) => c <= LOW);
    if (firstLow < 0) return;
    const later = ratings.slice(firstLow + 1).find((c) => c >= HIGH);
    if (later === undefined) return;
    out.set(`comeback/${key}`, { kind: 'comeback', title, from: ratings[firstLow]!, to: later });
    add('first-comeback');
  };
  for (const e of exercises) comeback(`e/${e.id}`, e.title, reflections.filter((r) => r.exerciseId === e.id).map((r) => r.confidence));
  for (const c of checklists) {
    const questions = new Set(checklistRatings.filter((r) => r.checklistId === c.id).map((r) => r.questionId));
    for (const q of questions) comeback(`c/${c.id}/${q}`, c.title, checklistRatings.filter((r) => r.checklistId === c.id && r.questionId === q).map((r) => r.confidence));
  }
  return out;
}
