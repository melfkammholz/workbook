import { ArrowRight, Compass } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'wouter';
import { CourseText } from '@/components/CourseText';
import { AdventureMap } from '@/components/AdventureMap';
import { ProgressLine } from '@/components/ItemRows';
import { Empty } from '@/components/ui';
import { indexItems, statusOf, threadProgress, useOutline, useState_ } from '@/lib/api';
import { READING_COLUMN } from '@/components/TaskColumn';
import { useT } from '@/lib/i18n';

/** An adventure: the author's introduction, the path through it, and where the student is on it. */
export function AdventurePage({ id }: { id: string }) {
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  const { map } = useMemo(() => indexItems(outline), [outline]);
  if (!outline) return null;
  const thread = outline.threads.find((x) => x.id === id && x.adventure);
  if (!thread) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.pageNotFound}>{t.pageNotFoundBody}</Empty>
      </div>
    );
  }
  const { done, total } = threadProgress(thread, state);
  const next = thread.steps.find((step) => !step.some((s) => statusOf(state, s) === 'done'))?.[0];
  return (
    <div className="h-full overflow-y-auto">
      <article className={`settle pb-24 pt-10 ${READING_COLUMN}`}>
        <p className="mb-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
          <Compass size={14} /> {t.adventure}
        </p>
        <h1 className="text-balance text-[2rem] font-semibold leading-tight tracking-[-0.025em]">{thread.title}</h1>
        {thread.description ? <p className="mt-2 text-ink-2">{thread.description}</p> : null}
        <div className="mt-6">
          <p className="mb-1.5 text-[13px] tabular-nums text-ink-2">{t.stepsDone(done, total)}</p>
          <ProgressLine done={done} total={total} />
        </div>
        <div className="mt-8">
          <CourseText url={`/api/threads/${encodeURIComponent(id)}/page`} target={`thread/${id}`} />
        </div>
        {next ? (
          <Link href={`/item/${next}`} className="mt-8 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-ink hover:brightness-110">
            {done ? t.adventureContinue : t.adventureStart} <ArrowRight size={16} />
          </Link>
        ) : null}
        <h2 className="mb-2 mt-10 text-sm font-semibold text-ink-2">{t.adventurePath}</h2>
        <div className="pb-2 pt-3">
          <AdventureMap thread={thread} byId={map} state={state} />
        </div>
      </article>
    </div>
  );
}
