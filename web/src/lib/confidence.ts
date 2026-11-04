import type { Outline, ReviewData } from '@wb/shared';

export interface Row {
  key: string;
  label: string;
  href: string | null;
  low: number;
  okay: number;
  high: number;
  average: number;
  /** Exercises and self-evaluation questions in this group, rated or not. */
  total: number;
}

type Rating = { exercise: string; confidence: number };

/** The latest rating of each exercise, and of each checklist question, by chapter and by topic. */
export function confidenceRows(outline: Outline, data: ReviewData): { chapters: Row[]; topics: Row[] } {
  const latest = new Map(data.reflections.map((r) => [r.exerciseId, r.confidence as number]));
  const exercises = outline.chapters.flatMap((c) => c.items.flatMap((i) => (i.type === 'exercise' ? [{ ...i, chapter: c.id }] : [])));
  const row = (key: string, label: string, href: string | null, ratings: Rating[], total: number): Row | null => {
    if (ratings.length === 0) return null;
    const c = ratings.map((r) => r.confidence);
    return {
      key,
      label,
      href,
      total,
      low: c.filter((x) => x <= 2).length,
      okay: c.filter((x) => x === 3).length,
      high: c.filter((x) => x >= 4).length,
      average: c.reduce((a, b) => a + b, 0) / c.length,
    };
  };
  const ratingsOf = (list: typeof exercises): Rating[] => list.flatMap((e) => (latest.has(e.id) ? [{ exercise: e.id, confidence: latest.get(e.id)! }] : []));
  const checklistChapter = new Map(outline.chapters.flatMap((c) => c.items.filter((i) => i.type === 'checklist').map((i) => [i.id, c.id] as const)));
  // Self-evaluation questions count as rated, so they have to count towards the total as well.
  const questionsIn = (chapterId: string) => outline.chapters.find((c) => c.id === chapterId)!.items.reduce((n, i) => n + (i.type === 'checklist' ? i.questionCount : 0), 0);
  const lowestFirst = (a: Row, b: Row) => a.average - b.average;

  const chapters = outline.chapters
    .flatMap((c) => {
      const own = exercises.filter((e) => e.chapter === c.id);
      const answers = data.checklists.flatMap((e) => (checklistChapter.get(e.checklistId) === c.id && e.answer.confidence !== null ? [{ exercise: e.question.id, confidence: e.answer.confidence }] : []));
      const r = row(`chapter/${c.id}`, c.title, `/chapter/${c.id}`, [...ratingsOf(own), ...answers], own.length + questionsIn(c.id));
      return r ? [r] : [];
    })
    .sort(lowestFirst);
  const topics = outline.tags
    .filter((tag) => tag.type === 'topic' && tag.review)
    .flatMap((tag) => {
      const own = exercises.filter((e) => e.tags.includes(tag.id));
      const r = row(`topic/${tag.id}`, tag.label, null, ratingsOf(own), own.length);
      return r ? [r] : [];
    })
    .sort(lowestFirst);
  return { chapters, topics };
}
