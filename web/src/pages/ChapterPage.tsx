import { ArrowRight, Compass } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'wouter';
import { CourseText } from '@/components/CourseText';
import { ItemRow, ProgressLine } from '@/components/ItemRows';
import { Plant } from '@/components/Plant';
import { Empty } from '@/components/ui';
import { isExercise, statusOf, useOutline, useState_ } from '@/lib/api';
import type { ThreadInfo } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { adventureOfSection, isChapterWide } from '@/lib/sections';

/** Where a chapter starts: what it is about, how far along it is, and what is in it. */
export function ChapterPage({ id }: { id: string }) {
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  if (!outline) return null;
  const chapter = outline.chapters.find((c) => c.id === id);
  if (!chapter) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.pageNotFound}>{t.pageNotFoundBody}</Empty>
      </div>
    );
  }
  const exercises = chapter.items.filter(isExercise);
  const done = exercises.filter((e) => statusOf(state, e.id) === 'done').length;
  const upNext = exercises.find((e) => statusOf(state, e.id) === 'in_progress') ?? exercises.find((e) => statusOf(state, e.id) !== 'done');
  const started = exercises.some((e) => statusOf(state, e.id) !== 'todo');
  // The checklist that ends a chapter is about all of it, so it gets a box of its own below the sections.
  const last = chapter.items.at(-1);
  const closing = last && isChapterWide(chapter, last) ? last : null;
  const listed = closing ? chapter.items.slice(0, -1) : chapter.items;
  return (
    <div className="h-full overflow-y-auto">
      <article className="settle mx-auto max-w-[46rem] px-6 pb-24 pt-10 sm:px-8">
        <h1 className="text-balance text-[2rem] font-semibold leading-tight tracking-[-0.025em]">
          {chapter.title} <Plant chapterId={chapter.id} className="ml-1 text-[1.5rem] leading-none" />
        </h1>
        {chapter.summary ? <p className="mt-2 text-ink-2">{chapter.summary}</p> : null}
        <div className="mt-6">
          <p className="mb-1.5 text-[13px] tabular-nums text-ink-2">{t.nDoneOfM(done, exercises.length)}</p>
          <ProgressLine done={done} total={exercises.length} />
        </div>
        {upNext ? (
          <Link href={`/item/${upNext.id}`} className="mt-6 inline-flex h-10 max-w-full items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-ink hover:brightness-110">
            <span className="truncate">{done || started ? t.continueWith(upNext.title) : t.startWith(upNext.title)}</span> <ArrowRight size={16} className="shrink-0" />
          </Link>
        ) : null}
        {chapter.hasIntro ? (
          <div className="mt-8">
            <CourseText url={`/api/chapters/${encodeURIComponent(id)}/intro`} />
          </div>
        ) : null}
        <ol className="mt-8 divide-y divide-line overflow-hidden rounded-lg border border-line bg-sheet">
          {listed.map((item, i) => {
            const section = item.sectionId !== (listed[i - 1]?.sectionId ?? null) ? chapter.sections.find((s) => s.id === item.sectionId) : undefined;
            return (
              <Fragment key={item.id}>
                {section ? <SectionRow title={section.title} adventure={adventureOfSection(outline, chapter, section.id)} /> : null}
                <li>
                  <ItemRow item={item} state={state} />
                </li>
              </Fragment>
            );
          })}
        </ol>
        {closing ? (
          <section aria-label={t.wholeChapterHeading} className="mt-4 overflow-hidden rounded-lg border border-line bg-sheet">
            <h2 className="border-b border-line bg-paper/60 px-4 py-2 text-[13px] font-semibold">{t.wholeChapterHeading}</h2>
            <ItemRow item={closing} state={state} />
          </section>
        ) : null}
      </article>
    </div>
  );
}

function SectionRow({ title, adventure }: { title: string; adventure: ThreadInfo | undefined }) {
  const t = useT();
  return (
    <li className="bg-paper/60 px-4 py-2 text-[13px] font-semibold">
      {adventure ? (
        <Link href={`/adventure/${adventure.id}`} title={t.openAdventure} className="inline-flex items-center gap-1.5 hover:underline">
          {title} <Compass size={13} className="text-accent" aria-hidden />
        </Link>
      ) : (
        title
      )}
    </li>
  );
}
