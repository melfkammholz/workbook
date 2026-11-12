import type { ProgressEntry, Question, Reflection, ReviewData, Stats } from '@wb/shared';

export type Flag = 'low-confidence' | 'question' | 'review' | 'solution' | 'many-attempts' | 'stuck';

/** Most telling first. */
export const FLAGS: Flag[] = ['low-confidence', 'question', 'review', 'solution', 'many-attempts', 'stuck'];

export interface Cell {
  progress: ProgressEntry | undefined;
  reflection: Reflection | undefined;
  stats: Stats | undefined;
  /** Questions on this exercise that are still open. */
  questions: Question[];
  flags: Flag[];
}

/** The questions asked on an item, in the order they were asked. */
export const questionsOn = (questions: Question[], itemId: string): Question[] =>
  questions.filter((q) => (q.anchor.kind === 'exercise' || q.anchor.kind === 'item') && q.anchor.id === itemId);

export const openQuestionsOn = (questions: Question[], itemId: string): Question[] => questionsOn(questions, itemId).filter((q) => q.status === 'open');

/** Why the student might want to look at this exercise again. */
export function cellFor(data: ReviewData, exerciseId: string): Cell {
  const progress = data.progress[exerciseId];
  const stats = data.stats[exerciseId];
  const reflection = [...data.reflections].reverse().find((r) => r.exerciseId === exerciseId);
  const questions = openQuestionsOn(data.questions, exerciseId);
  const flags: Flag[] = [];
  if (questions.length) flags.push('question');
  if (reflection && reflection.confidence <= 2) flags.push('low-confidence');
  if (stats?.solutionViewedAt && (!reflection || reflection.confidence <= 3)) flags.push('solution');
  if (stats && stats.checkRuns >= 8 && stats.checkPasses === 0) flags.push('many-attempts');
  if (progress?.status === 'review') flags.push('review');
  if (progress?.status === 'in_progress' && stats && stats.activeSeconds > 20 * 60) flags.push('stuck');
  return { progress, reflection, stats, questions, flags };
}

/** Lower is more urgent: low confidence and open questions first, then by how many reasons there are. */
export function urgency(c: Cell): number {
  const confidence = c.reflection?.confidence ?? 6;
  return confidence * 10 - c.flags.length - (c.questions.length ? 5 : 0);
}

/** A running clock: 12:05, or 1:02:05 past an hour. */
export function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds === 0 ? '0 min' : '< 1 min';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
