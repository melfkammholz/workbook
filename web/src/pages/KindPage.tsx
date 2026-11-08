import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ThreadKind } from '@wb/shared';
import { ItemRow, ProgressLine } from '@/components/ItemRows';
import { Empty, clsx } from '@/components/ui';
import { indexItems, isExercise, statusOf, useOutline, useState_ } from '@/lib/api';
import { focusOf, itemInFocus, staysInSight } from '@/lib/focus';
import { useT } from '@/lib/i18n';

/**
 * The course's sessions, homework sheets or old exams: each group a section with what belongs to it, like the
 * chapters' pages. The exercises and lessons live in their chapters; a group only lists them, in its order.
 */
export function KindPage({ kind }: { kind: ThreadKind }) {
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  useEffect(() => {
    if (outline) document.title = `${t.threadKind[kind]} · ${outline.title}`;
  }, [outline, kind, t]);
  if (!outline) return null;
  const { map } = indexItems(outline);
  const groups = outline.threads.filter((x) => x.kind === kind);
  const focus = focusOf(state);
  // Like a chapter: what is outside the focus and not worked on folds into one line, per group.
  const [opened, setOpened] = useState<Set<string>>(new Set());

  return (
    <div className="h-full overflow-y-auto">
      <article className="settle mx-auto max-w-[46rem] px-6 pb-24 pt-10 sm:px-8">
        <h1 className="text-balance text-[2rem] font-semibold leading-tight tracking-[-0.025em]">{t.threadKind[kind]}</h1>
        <p className="mt-2 text-ink-2">{t.threadKindSummary[kind]}</p>
        {groups.length === 0 ? (
          <div className="mt-10">
            <Empty title={t.threadKindEmpty} />
          </div>
        ) : null}
        {groups.map((g) => {
          const items = g.steps.flat().flatMap((id) => (map.get(id) ? [map.get(id)!] : []));
          const counted = items.filter((i) => isExercise(i) || i.type === 'lesson');
          const done = counted.filter((i) => statusOf(state, i.id) === 'done').length;
          const hidden = items.filter((i) => !staysInSight(i, state));
          return (
            <section key={g.id} id={`group-${g.id}`} className="mt-10 scroll-mt-6">
              <h2 className="text-[1.25rem] font-semibold tracking-[-0.015em]">{g.title}</h2>
              {g.description ? <p className="mt-1 text-[14.5px] text-ink-2">{g.description}</p> : null}
              <div className="mt-3">
                <p className="mb-1.5 text-[13px] tabular-nums text-ink-2">{t.nDoneOfM(done, counted.length)}</p>
                <ProgressLine done={done} total={counted.length} />
              </div>
              <ol className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-sheet">
                {items
                  .filter((item) => opened.has(g.id) || staysInSight(item, state))
                  .map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} state={state} outside={!itemInFocus(item, focus)} group={g.id} />
                    </li>
                  ))}
                {hidden.length ? (
                  <li>
                    <button
                      type="button"
                      aria-expanded={opened.has(g.id)}
                      onClick={() => setOpened((o) => (o.has(g.id) ? new Set([...o].filter((x) => x !== g.id)) : new Set([...o, g.id])))}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] text-ink-3 hover:bg-paper/60 hover:text-ink"
                    >
                      <span className="min-w-0 flex-1 truncate">{opened.has(g.id) ? t.foldAway : t.moreOutsideFocus(hidden.length)}</span>
                      <ChevronDown size={14} className={clsx('shrink-0 transition-transform', opened.has(g.id) && 'rotate-180')} />
                    </button>
                  </li>
                ) : null}
              </ol>
            </section>
          );
        })}
      </article>
    </div>
  );
}
