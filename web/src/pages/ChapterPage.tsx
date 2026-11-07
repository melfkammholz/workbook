import { ArrowRight, ChevronDown, Compass } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'wouter';
import { CourseText } from '@/components/CourseText';
import { ItemRow, ProgressLine } from '@/components/ItemRows';
import { Plant } from '@/components/Plant';
import { Empty, clsx } from '@/components/ui';
import { isExercise, statusOf, useOutline, useState_ } from '@/lib/api';
import type { ThreadInfo } from '@wb/shared';
import { focusExercises, foldItems, type FoldEntry } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { adventureOfSection, isChapterWide } from '@/lib/sections';

/** Where a chapter starts: what it is about, how far along it is, and what is in it. */
export function ChapterPage({ id }: { id: string }) {
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (key: string) => setOpened((o) => (o.has(key) ? new Set([...o].filter((k) => k !== key)) : new Set([...o, key])));
  if (!outline) return null;
  const chapter = outline.chapters.find((c) => c.id === id);
  if (!chapter) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.pageNotFound}>{t.pageNotFoundBody}</Empty>
      </div>
    );
  }
  // The progress counts what is in the focus; what to continue with is something started, or the next one in the focus.
  const last = chapter.items.at(-1);
  const closing = last && isChapterWide(chapter, last) ? last : null;
  const exercises = focusExercises(chapter.items, state);
  const done = exercises.filter((e) => statusOf(state, e.id) === 'done').length;
  const all = chapter.items.filter(isExercise);
  const upNext = all.find((e) => statusOf(state, e.id) === 'in_progress') ?? exercises.find((e) => statusOf(state, e.id) !== 'done');
  const started = all.some((e) => statusOf(state, e.id) !== 'todo');
  const entries = foldItems(chapter.id, closing ? chapter.items.slice(0, -1) : chapter.items, state, opened);
  // The checklist that ends a chapter is about all of it, so it gets a box of its own below the sections.
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
          {entries.map((entry, i) => {
            const sectionOf = (e: FoldEntry | undefined) => (e ? (e.kind === 'item' ? e.item.sectionId : e.sectionId) : null);
            const sectionId = sectionOf(entry);
            const section = sectionId !== sectionOf(entries[i - 1]) ? chapter.sections.find((s) => s.id === sectionId) : undefined;
            const label = section ? <SectionRow title={section.title} adventure={adventureOfSection(outline, chapter, section.id)} /> : null;
            if (entry.kind === 'fold')
              return (
                <Fragment key={entry.key}>
                  {label}
                  <li>
                    <button type="button" aria-expanded={entry.open} onClick={() => toggleFold(entry.key)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] text-ink-3 hover:bg-paper/60 hover:text-ink">
                      <span className="min-w-0 flex-1 truncate">{entry.open ? t.foldAway : t.moreOutsideFocus(entry.hidden.length)}</span>
                      <ChevronDown size={14} className={clsx('shrink-0 transition-transform', entry.open && 'rotate-180')} />
                    </button>
                  </li>
                </Fragment>
              );
            return (
              <Fragment key={entry.item.id}>
                {label}
                <li>
                  <ItemRow item={entry.item} state={state} outside={entry.outside} />
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
