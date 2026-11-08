import { ArrowRight, BookOpen, Compass, NotebookText, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'wouter';
import type { ChapterMeta, ExerciseMeta, Status, StudentState } from '@wb/shared';
import { ProgressLine } from '@/components/ItemRows';
import { Plant } from '@/components/Plant';
import { Level, StatusMark, clsx } from '@/components/ui';
import { indexItems, isExercise, statusOf, threadProgress, useOutline, useSettings, useState_ } from '@/lib/api';
import { focusExercises } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { Title } from '@/components/Title';
import { KIND_ICONS, kindProgress, kindsOf } from '@/lib/kinds';

export function Dashboard() {
  const t = useT();
  const outline = useOutline().data;
  const stateRes = useState_().data;
  const settings = useSettings().data;
  const { map } = useMemo(() => indexItems(outline), [outline]);
  if (!outline) return null;
  const state = stateRes?.state;
  // Progress counts what is in the focus; what is worth another look is the student's own, whatever the focus.
  const all = outline.chapters.flatMap((c) => c.items).filter(isExercise);
  const exercises = focusExercises(all, state);
  const count = (s: Status) => exercises.filter((e) => statusOf(state, e.id) === s).length;
  const done = count('done');
  const first = outline.chapters.flatMap((c) => c.items)[0];
  const last = state?.lastOpenedId ? map.get(state.lastOpenedId) : undefined;
  const suggestions = stateRes?.suggestions ?? [];
  const fresh = !all.some((e) => statusOf(state, e.id) !== 'todo') && !last;
  const errors = outline.problems.filter((p) => p.severity === 'error');
  const weakChecklistAnswers = Object.values(state?.checklists ?? {}).flatMap((c) => Object.values(c)).filter((a) => a.confidence !== null && a.confidence <= 2).length;
  const attention = all.filter((e) => state?.openQuestions[e.id] || statusOf(state, e.id) === 'review' || (state?.reflections[e.id]?.confidence ?? 5) <= 2).length + weakChecklistAnswers;
  const adventures = outline.threads.filter((x) => x.adventure);
  // Sessions, homework and exams have pages of their own; here only the paths through topics.
  const paths = outline.threads.filter((x) => !x.adventure && !x.kind);

  return (
    <div className="h-full overflow-y-auto">
      <div className="settle mx-auto max-w-3xl px-6 pb-24 pt-10 sm:px-8">
        <h1 className="text-balance text-[2rem] font-semibold leading-tight tracking-[-0.025em]">
          {settings?.displayName ? t.welcomeBackName(settings.displayName.split(' ')[0]!) : fresh ? t.welcome : t.welcomeBack}
        </h1>
        <p className="mt-2 max-w-prose text-ink-2">
          {fresh ? t.welcomeFresh : t.doneSummary(done, exercises.length) + (count('review') ? t.reviewSummary(count('review')) : '')}
        </p>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          {outline.landing ? (
            <Link href="/welcome" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              <BookOpen size={14} /> {t.aboutCourse}
            </Link>
          ) : null}
          <Link href="/notes" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            <NotebookText size={14} /> {t.allNotes}
          </Link>
          {settings?.showAchievements ? (
            <Link href="/achievements" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              <Trophy size={14} /> {t.achievements}
            </Link>
          ) : null}
        </div>

        {errors.length ? (
          <div className="mt-6 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            <p className="font-medium">{t.courseProblems(errors.length)}</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.slice(0, 4).map((p, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{p.file}</span>: {p.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-8">
          <ProgressBar done={done} total={exercises.length} inProgress={count('in_progress')} review={count('review')} />
        </div>

        {fresh && first ? (
          <Link href={`/item/${first.id}`} className="mt-8 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-ink hover:brightness-110">
            <Title text={t.startWith(first.title)} /> <ArrowRight size={16} />
          </Link>
        ) : null}

        {attention > 0 ? (
          <Link href="/review" className="mt-6 flex items-center gap-3 rounded-lg border border-review/40 bg-review-soft px-4 py-3 text-sm font-medium hover:border-review">
            <span className="min-w-0 flex-1">{t.worthAnotherLook(attention)}</span>
            <ArrowRight size={16} className="text-review" />
          </Link>
        ) : null}

        {last && !fresh ? (
          <section className="mt-10">
            <h2 className="mb-2 text-sm font-semibold text-ink-2">{t.pickUp}</h2>
            <Link href={`/item/${last.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-sheet px-4 py-3.5 hover:border-line-strong">
              <StatusMark status={statusOf(state, last.id)} size={18} />
              <span className="min-w-0 flex-1 truncate font-medium"><Title text={last.title} /></span>
              <ArrowRight size={16} className="text-ink-3" />
            </Link>
          </section>
        ) : null}

        {suggestions.length ? (
          <section className="mt-10">
            <h2 className="mb-2 text-sm font-semibold text-ink-2">{t.suggestedNext}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-sheet">
              {suggestions.map((s) => {
                const e = map.get(s.id) as ExerciseMeta | undefined;
                if (!e) return null;
                return (
                  <li key={s.id}>
                    <Link href={`/item/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper/60">
                      <StatusMark status={statusOf(state, s.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">
                          {e.startHere && e.emoji ? <span className="mr-1.5">{e.emoji}</span> : null}
                          <Title text={e.title} />
                        </span>
                        <span className={clsx('block text-[13px]', s.reason === 'review-due' ? 'text-review' : 'text-ink-3')}>{t.reason[s.reason]}</span>
                      </span>
                      <Level level={e.level} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {adventures.length ? (
          <section className="mt-10">
            <h2 className="mb-1 text-[15px] font-semibold">{t.adventures}</h2>
            <p className="mb-3 text-[13.5px] text-ink-2">{t.adventuresBody}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {adventures.map((a) => {
                const { done: stepsDone, total } = threadProgress(a, state);
                return (
                  <li key={a.id}>
                    <Link href={`/adventure/${a.id}`} className="flex h-full flex-col rounded-lg border border-accent/40 bg-accent-soft/40 px-4 py-3.5 hover:border-accent">
                      <span className="flex items-center gap-2 font-semibold">
                        <Compass size={16} className="shrink-0 text-accent" /> {a.title}
                      </span>
                      {a.description ? <span className="mt-1 text-[13.5px] text-ink-2">{a.description}</span> : null}
                      <span className="mt-auto pt-3">
                        <span className="mb-1 block text-xs tabular-nums text-ink-2">{t.stepsDone(stepsDone, total)}</span>
                        <ProgressLine done={stepsDone} total={total} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {kindsOf(outline).length ? (
          <section className="mt-10">
            <h2 className="mb-1 text-[15px] font-semibold">{t.courseWork}</h2>
            <p className="mb-3 text-[13.5px] text-ink-2">{t.courseWorkBody}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {kindsOf(outline).map((k) => {
                const { done, total } = kindProgress(outline, k, state);
                const groups = outline.threads.filter((x) => x.kind === k);
                const Icon = KIND_ICONS[k];
                return (
                  <li key={k}>
                    <Link href={`/kind/${k}`} className="flex h-full flex-col rounded-lg border border-line bg-sheet px-4 py-3.5 hover:border-line-strong">
                      <span className="flex items-center gap-2 font-semibold">
                        <Icon size={16} className="shrink-0 text-ink-2" /> {t.threadKind[k]}
                      </span>
                      <span className="mt-1 text-[13.5px] text-ink-2">{groups.map((g) => g.title).join(' · ')}</span>
                      <span className="mt-auto pt-3">
                        <span className="mb-1 block text-xs tabular-nums text-ink-2">{t.nDoneOfM(done, total)}</span>
                        <ProgressLine done={done} total={total} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {outline.parts.length ? (
          <>
            {outline.parts.map((part) => (
              <section key={part.id} className="mt-10">
                <h2 className="text-[15px] font-semibold">{part.title}</h2>
                {part.summary ? <p className="mt-0.5 text-[13.5px] text-ink-2">{part.summary}</p> : null}
                <ChapterList chapters={outline.chapters.filter((c) => c.partId === part.id)} state={state} />
              </section>
            ))}
            {outline.chapters.some((c) => c.partId === null) ? (
              <section className="mt-10">
                <h2 className="text-[15px] font-semibold">{t.otherChapters}</h2>
                <ChapterList chapters={outline.chapters.filter((c) => c.partId === null)} state={state} />
              </section>
            ) : null}
          </>
        ) : (
          <section className="mt-10">
            <h2 className="text-sm font-semibold text-ink-2">{t.chapters}</h2>
            <ChapterList chapters={outline.chapters} state={state} />
          </section>
        )}

        {paths.length ? (
          <section className="mt-10">
            <h2 className="mb-1 text-sm font-semibold text-ink-2">{t.threads}</h2>
            <p className="mb-3 text-[13.5px] text-ink-3">{t.threadsBody}</p>
            <ul className="space-y-3">
              {paths.map((t) => (
                <li key={t.id} className="rounded-lg border border-line bg-sheet px-4 py-3">
                  <p className="font-medium">{t.title}</p>
                  {t.description ? <p className="mt-0.5 text-[13.5px] text-ink-2">{t.description}</p> : null}
                  <ol className="mt-3 flex flex-wrap items-center gap-y-2">
                    {t.steps.map((step, i) => (
                      <li key={i} className="flex items-center">
                        {i > 0 ? <span aria-hidden className="mx-1.5 h-px w-4 bg-line-strong" /> : null}
                        <span className="flex flex-col gap-1">
                          {step.map((id) => {
                            const it = map.get(id);
                            if (!it) return null;
                            return (
                              <Link key={id} href={`/item/${id}`} className="inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border border-line bg-paper py-1 pl-1.5 pr-3 text-[13px] hover:border-line-strong">
                                <StatusMark status={statusOf(state, id)} size={13} />
                                <span className="truncate"><Title text={it.title} /></span>
                              </Link>
                            );
                          })}
                        </span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ChapterList({ chapters, state }: { chapters: ChapterMeta[]; state: StudentState | undefined }) {
  return (
    <ul className="mt-3 space-y-3">
      {chapters.map((c) => {
        const ex = focusExercises(c.items, state);
        const d = ex.filter((e) => statusOf(state, e.id) === 'done').length;
        return (
          <li key={c.id}>
            <Link href={`/chapter/${c.id}`} className="group block rounded-lg border border-line bg-sheet px-4 py-3 hover:border-line-strong">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {c.number !== null ? <span className="mr-2 font-mono text-xs text-ink-3">{c.number}</span> : null}
                  {c.title}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-ink-3">
                  <Plant chapterId={c.id} className="text-[15px] leading-none" />
                  {d}/{ex.length}
                </span>
              </div>
              {c.summary ? <p className="mt-0.5 text-[13.5px] text-ink-2">{c.summary}</p> : null}
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-sunk">
                <div className="h-full rounded-full bg-done transition-[width]" style={{ width: `${ex.length ? (d / ex.length) * 100 : 0}%` }} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ProgressBar({ done, total, inProgress, review }: { done: number; total: number; inProgress: number; review: number }) {
  const t = useT();
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-sunk" role="img" aria-label={t.nDoneOfM(done, total)}>
        <div className="bg-done" style={{ width: `${pct(done)}%` }} />
        <div className="bg-review" style={{ width: `${pct(review)}%` }} />
        <div className="bg-accent" style={{ width: `${pct(inProgress)}%` }} />
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
        {(
          [
            ['done', done],
            ['review', review],
            ['in_progress', inProgress],
            ['todo', total - done - review - inProgress],
          ] as [Status, number][]
        ).map(([s, n]) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <StatusMark status={s} size={12} />
            <span className="tabular-nums">{n}</span> {t.status[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}
