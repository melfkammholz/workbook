import type { ChapterMeta, ItemMeta, Outline, ThreadInfo } from '@wb/shared';

/** The adventure a section is, when all of its exercises belong to that one. Exercises of an adventure can also be spread over several sections. */
export function adventureOfSection(outline: Outline, chapter: ChapterMeta, sectionId: string): ThreadInfo | undefined {
  const exercises = chapter.items.filter((i) => i.sectionId === sectionId && i.type === 'exercise');
  if (exercises.length === 0) return undefined;
  return outline.threads.find((t) => t.adventure && exercises.every((e) => t.steps.some((step) => step.includes(e.id))));
}

/** A checklist that ends a chapter looks back on all of it, so it is drawn apart from the rest (and from the last section). */
export function isChapterWide(chapter: ChapterMeta, item: ItemMeta): boolean {
  return item.type === 'checklist' && chapter.items.length > 1 && chapter.items.at(-1)?.id === item.id;
}
