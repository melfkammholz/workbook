import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, NotebookText, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { ExerciseMeta, ReviewData } from '@wb/shared';
import { CodeBlock } from '@/components/Dialogs';
import { ConfidenceOverview } from '@/components/ConfidenceOverview';
import { Prose } from '@/components/Prose';
import { RenderedText } from '@/components/RenderedText';
import { Button, Chip, Empty, Spinner, StatusMark, clsx } from '@/components/ui';
import { FLAGS, cellFor, formatDuration, urgency, type Cell, type Flag } from '@/lib/attention';
import { isExercise, keys, saveOpenQuestion, useOutline, useReviewData, useSettings } from '@/lib/api';
import { useCourseCards } from '@/lib/flashcards';
import { BackLink } from '@/lib/history';
import { useLang, useT } from '@/lib/i18n';

type Exercise = ExerciseMeta & { chapter: string };

function useExercises(): Exercise[] {
  const outline = useOutline().data;
  return useMemo(() => (outline?.chapters ?? []).flatMap((c) => c.items.filter(isExercise).map((e) => ({ ...e, chapter: c.title }))), [outline]);
}

/** Where the student struggled, what they still wanted to know, and what they wrote at the time. */
export function ReviewPage() {
  const t = useT();
  const mine = useReviewData();
  const outline = useOutline().data;
  const flashcardsOn = !!useSettings().data?.showFlashcards;
  const cards = useCourseCards(flashcardsOn).data;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 pb-24 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.reviewTitle}</h1>
        <p className="mt-4 max-w-prose text-ink-2">{t.mineIntro}</p>
        <Link href="/notes" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <NotebookText size={14} /> {t.allNotes}
        </Link>
        {mine.data ? (
          <>
            {outline ? <ConfidenceOverview outline={outline} data={mine.data} cards={flashcardsOn ? (cards ?? null) : null} /> : null}

            <WeakChecklistAnswers data={mine.data} />
            <Attention data={mine.data} />
          </>
        ) : (
          <div className="mt-8">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
}

/** Over-arching questions the student rated low, or wrote something about. */
function WeakChecklistAnswers({ data }: { data: ReviewData }) {
  const t = useT();
  const entries = worthALook(data).sort((a, b) => (a.answer.confidence ?? 6) - (b.answer.confidence ?? 6));
  if (entries.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-ink-2">{t.checklistsHeading}</h2>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={`${e.checklistId}/${e.question.id}`}>
            <Link href={`/item/${e.checklistId}`} className="flex items-start gap-3 rounded-lg border border-line bg-sheet px-4 py-3 hover:bg-paper/60">
              <span className="min-w-0 flex-1">
                <span className="mb-1 block text-xs text-ink-3">{e.title}</span>
                <Prose html={e.question.html} className="prose-note text-[15px]" />
                {e.answer.note ? <span className="mt-1.5 block whitespace-pre-wrap border-l-2 border-accent pl-3 text-[14px] text-ink-2">{e.answer.note}</span> : null}
              </span>
              {e.answer.confidence ? <ConfidenceBadge value={e.answer.confidence} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const worthALook = (data: ReviewData) => data.checklists.filter((e) => (e.answer.confidence !== null && e.answer.confidence <= 2) || e.answer.note.trim() !== '');

/** Everything that deserves a look, most urgent first. */
function Attention({ data }: { data: ReviewData }) {
  const t = useT();
  const exercises = useExercises();
  const [filter, setFilter] = useState<Flag | 'all'>('all');

  const entries = useMemo(
    () =>
      exercises
        .map((ex) => ({ ex, cell: cellFor(data, ex.id) }))
        .filter((e) => e.cell.flags.length > 0)
        .sort((a, b) => urgency(a.cell) - urgency(b.cell) || a.ex.index - b.ex.index),
    [data, exercises],
  );
  if (entries.length === 0) {
    return worthALook(data).length ? null : <Empty title={t.nothingToReview}>{t.nothingToReviewBody}</Empty>;
  }
  const count = (f: Flag) => entries.filter((e) => e.cell.flags.includes(f)).length;
  const shown = filter === 'all' ? entries : entries.filter((e) => e.cell.flags.includes(filter));

  return (
    <>
      <div className="mt-5 flex flex-wrap gap-1.5" role="group">
        <FilterChip on={filter === 'all'} onClick={() => setFilter('all')} n={entries.length}>
          {t.flagFilterAll}
        </FilterChip>
        {FLAGS.filter((f) => count(f) > 0).map((f) => (
          <FilterChip key={f} on={filter === f} onClick={() => setFilter(f)} n={count(f)}>
            {t.flag[f]}
          </FilterChip>
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {shown.map(({ ex, cell }) => (
          <Entry key={ex.id} ex={ex} cell={cell} data={data} />
        ))}
      </ul>
      {shown.length === 0 ? <p className="mt-6 text-sm text-ink-2">{t.nothingInFilter}</p> : null}
    </>
  );
}

function FilterChip({ on, onClick, n, children }: { on: boolean; onClick: () => void; n: number; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]', on ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-sheet text-ink-2 hover:border-line-strong')}>
      {children} <span className="tabular-nums opacity-70">{n}</span>
    </button>
  );
}

/** Large on purpose: scanning this column should show where it was hardest. */
function ConfidenceBadge({ value }: { value: 1 | 2 | 3 | 4 | 5 }) {
  const t = useT();
  // The same scale as the overview, not red and green: it has to work for colour blind readers too.
  const tone = value <= 2 ? 'bg-confidence-low/15 text-confidence-low' : value === 3 ? 'bg-sunk text-ink-2' : 'bg-confidence-high/15 text-confidence-high';
  return (
    <span className={clsx('flex w-[5.5rem] shrink-0 flex-col items-center rounded-lg px-2 py-1.5 text-center', tone)}>
      <span className="text-[1.75rem] font-semibold leading-none tabular-nums">
        {value}
        <span className="text-sm font-normal opacity-70">/5</span>
      </span>
      <span className="mt-1 text-xs font-medium leading-tight">{t.confidence[value]}</span>
    </span>
  );
}

function Entry({ ex, cell, data }: { ex: Exercise; cell: Cell; data: ReviewData }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const due = cell.progress?.reviewDueAt && cell.progress.reviewDueAt <= Date.now();
  return (
    <li className="rounded-lg border border-line bg-sheet">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper/60">
        <StatusMark status={cell.progress?.status ?? 'todo'} size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{ex.title}</span>
          {cell.question ? <span className="mt-0.5 line-clamp-2 block text-[13.5px] text-ink-2">{cell.question.content}</span> : null}
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {due ? <Chip tone="danger">{t.dueNow}</Chip> : null}
            {cell.flags.map((f) => (
              <Chip key={f} tone="amber">
                {t.flag[f]}
              </Chip>
            ))}
          </span>
        </span>
        {cell.reflection ? <ConfidenceBadge value={cell.reflection.confidence} /> : null}
        <ChevronDown size={16} className={clsx('mt-0.5 shrink-0 text-ink-3 transition-transform', !open && '-rotate-90')} />
      </button>
      {open ? (
        <div className="border-t border-line px-4 py-4">
          <EntryBody ex={ex} cell={cell} data={data} />
        </div>
      ) : null}
    </li>
  );
}

function EntryBody({ ex, cell, data }: { ex: Exercise; cell: Cell; data: ReviewData }) {
  const t = useT();
  const lang = useLang();
  const { reflection, stats } = cell;
  const answers = data.answers[ex.id];
  const note = data.notes[ex.id];
  return (
    <>
      <QuestionBlock id={ex.id} question={cell.question?.content ?? ''} />
      {reflection?.comment && reflection.comment !== cell.question?.content ? (
        <section className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">{t.comment}</h3>
          <blockquote className="border-l-2 border-accent pl-3 text-[14.5px] text-ink-2">{reflection.comment}</blockquote>
        </section>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <Stat label={t.statConfidence} value={reflection ? `${reflection.confidence} (${t.confidence[reflection.confidence]})` : t.notRated} />
        <Stat label={t.statHow} value={reflection?.how.length ? reflection.how.map((h) => t.how[h] ?? h).join(', ') : t.unknown} />
        <Stat label={t.statTime} value={stats ? formatDuration(stats.activeSeconds) : '–'} />
        <Stat label={t.statTests} value={stats?.checkRuns ? t.testsPassedOf(stats.checkPasses, stats.checkRuns) : '–'} />
        <Stat label={t.statHints} value={stats ? String(stats.hintsRevealed) : '–'} />
        <Stat label={t.statSolution} value={stats?.solutionViewedAt ? new Date(stats.solutionViewedAt).toLocaleDateString(lang) : t.no} />
      </dl>

      <section className="mt-4">
        <h3 className="mb-1.5 text-sm font-semibold">{t.answerHeading}</h3>
        {answers && Object.keys(answers).length ? (
          Object.entries(answers).map(([slot, content]) => (ex.code ? <CodeBlock key={slot} code={content} language={ex.code.language} className="mb-2 max-h-80 whitespace-pre-wrap" /> : <RenderedText key={slot} source={content} />))
        ) : (
          <p className="text-sm text-ink-3">{t.noAnswer}</p>
        )}
      </section>

      {note ? (
        <section className="mt-4">
          <h3 className="mb-1.5 text-sm font-semibold">{t.notesHeading}</h3>
          <RenderedText source={note.content} />
        </section>
      ) : null}

      <Link href={`/item/${ex.id}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
        {t.openExercise} <ArrowRight size={14} />
      </Link>
    </>
  );
}

function QuestionBlock({ id, question }: { id: string; question: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);

  const store = async (content: string) => {
    await saveOpenQuestion(id, content);
    setDraft(null);
    void qc.invalidateQueries({ queryKey: keys.mine });
    void qc.invalidateQueries({ queryKey: keys.state });
  };

  if (draft !== null) {
    return (
      <div>
        <textarea autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t.questionPlaceholder} className="w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none" />
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="primary" onClick={() => void store(draft)}>
            {t.saveQuestion}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            {t.cancel}
          </Button>
        </div>
      </div>
    );
  }
  if (!question) {
    return (
      <Button size="sm" onClick={() => setDraft('')}>
        {t.addQuestion}
      </Button>
    );
  }
  return (
    <section className="rounded-md border border-review/40 bg-review-soft p-3">
      <h3 className="text-xs font-semibold text-review">{t.yourQuestion}</h3>
      <p className="mt-1 whitespace-pre-wrap text-[14.5px]">{question}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => void store('')}>
          {t.questionResolved}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(question)}>
          <Pencil size={13} /> {t.editQuestion}
        </Button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
