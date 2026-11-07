import { ArrowLeft, ArrowRight, Clock, Compass, ExternalLink, Flag, Flame, Lightbulb, MessageCircle, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import type { ExerciseMeta, ItemDetail, ItemMeta, Outline, StudentState } from '@wb/shared';
import { focusOf, inFocus } from '@wb/shared';
import { neighbours, statusOf, useCourses } from '@/lib/api';
import { issueLink } from '@/lib/issues';
import { useT } from '@/lib/i18n';
import { Checklist } from './Checklist';
import { Prose } from './Prose';
import { Button, Chip, Level, StatusMark, clsx } from './ui';

interface Props {
  detail: ItemDetail;
  outline: Outline;
  byId: Map<string, ItemMeta>;
  state: StudentState | undefined;
  revealedHints: number;
  onRevealHint: (count: number) => void;
}

/** The left pane: heading, the task as typeset text, the author's remarks, hints and threads to other exercises. */
export function TaskColumn({ detail, outline, byId, state, revealedHints, onRevealHint }: Props) {
  const t = useT();
  const { meta, rendered } = detail;
  const ex = meta.type === 'exercise' ? meta : null;
  const tagsOf = (type: 'topic' | 'signal') => outline.tags.filter((tag) => tag.type === type && ex?.tags.includes(tag.id));
  const errors = rendered.diagnostics.filter((d) => d.severity === 'error');
  const adventures = outline.threads.filter((x) => x.adventure && x.steps.some((step) => step.includes(meta.id)));
  const { previous, next } = neighbours(outline, meta.id, state);
  const courses = useCourses().data;
  const repository = courses?.courses.find((c) => c.id === courses.activeId)?.url ?? null;
  const report = issueLink(outline.issues, repository, t.issueTitle(meta.title), t.issueBody(meta.id, meta.title));

  return (
    <article className="settle mx-auto flex max-w-[46rem] flex-col px-6 pb-24 pt-7 sm:px-8">
      <header className="mb-6">
        <h1 className="text-balance text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
          {ex?.startHere && ex.emoji ? (
            <span className="mr-2" role="img" aria-label={t.recommendedFirst}>
              {ex.emoji}
            </span>
          ) : null}
          {meta.title}
        </h1>
        {ex ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-2">
              <Level level={ex.level} /> {[t.easy, t.medium, t.hard][ex.level - 1]}
            </span>
            {ex.kind === 'challenge' ? (
              <Chip tone="amber">
                <Flame size={12} /> {t.challenge}
              </Chip>
            ) : null}
            {ex.long ? (
              <Chip tone="signal">
                <Clock size={12} /> {t.takesAWhile}
              </Chip>
            ) : null}
            {ex.startHere ? (
              <Chip tone="accent">
                <Sparkles size={12} /> {t.recommendedFirst}
              </Chip>
            ) : null}
            {!inFocus(ex, focusOf(state)) ? <Chip>{t.outsideFocus}</Chip> : null}
            {adventures.map((a) => (
              <Link key={a.id} href={`/adventure/${a.id}`}>
                <Chip tone="accent">
                  <Compass size={12} /> {a.title}
                </Chip>
              </Link>
            ))}
            {tagsOf('signal').map((tag) => (
              <span key={tag.id} title={tag.description ?? undefined}>
                <Chip tone="signal">
                  <Flag size={12} /> {tag.label}
                </Chip>
              </span>
            ))}
            {tagsOf('topic').map((tag) => (
              <span key={tag.id} title={tag.description ?? undefined}>
                <Chip>{tag.label}</Chip>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {errors.length ? (
        <div className="mb-6 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          <p className="font-medium">{t.typstErrors}</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>
                {e.line ? t.lineN(e.line) : ''}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ex ? <Prerequisites ex={ex} byId={byId} state={state} /> : null}
      {ex ? <SharedOutsideFocus ex={ex} byId={byId} state={state} /> : null}

      <Prose html={rendered.task} css={rendered.css} />

      {meta.type === 'checklist' ? <Checklist id={meta.id} questions={rendered.questions} /> : null}

      {rendered.remarks.length ? (
        <div className="mt-8 space-y-3">
          {rendered.remarks.map((r, i) => (
            <aside key={i} className="flex gap-3 rounded-lg border border-line bg-sheet p-4">
              <MessageCircle size={17} className="mt-1 shrink-0 text-accent" aria-label={t.remark} />
              <Prose html={r} className="prose-note min-w-0 flex-1 text-[15.5px]" />
            </aside>
          ))}
        </div>
      ) : null}

      {rendered.hints.length ? <Hints hints={rendered.hints} revealed={revealedHints} onReveal={onRevealHint} /> : null}

      {ex ? <Threads ex={ex} byId={byId} state={state} /> : null}

      <nav aria-label={t.exerciseNavigation} className="mt-10 flex flex-wrap justify-between gap-3 border-t border-line pt-5 text-sm">
        {previous ? (
          <Link href={`/item/${previous.id}`} className="group flex min-w-0 max-w-[48%] items-center gap-2 text-ink-2 hover:text-ink">
            <ArrowLeft size={15} className="shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs text-ink-3">{t.previousItem}</span>
              <span className="block truncate group-hover:underline">{previous.title}</span>
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/item/${next.id}`} className="group ml-auto flex min-w-0 max-w-[48%] items-center gap-2 text-right text-ink-2 hover:text-ink">
            <span className="min-w-0">
              <span className="block text-xs text-ink-3">{t.nextItem}</span>
              <span className="block truncate group-hover:underline">{next.title}</span>
            </span>
            <ArrowRight size={15} className="shrink-0" />
          </Link>
        ) : null}
      </nav>

      {report ? (
        <a href={report} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 self-start text-[13px] text-ink-3 hover:text-ink hover:underline">
          {t.reportProblem} <ExternalLink size={12} />
        </a>
      ) : null}
    </article>
  );
}

function Hints({ hints, revealed, onReveal }: { hints: string[]; revealed: number; onReveal: (n: number) => void }) {
  const t = useT();
  const shown = Math.min(revealed, hints.length);
  return (
    <section id="wb-hints" className="mt-10 scroll-mt-4" aria-label={t.hints}>
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
        <Lightbulb size={16} className="text-review" /> {t.hints}
      </h2>
      <ol className="space-y-3">
        {hints.slice(0, shown).map((h, i) => (
          <li key={i} className="settle rounded-lg border border-review/30 bg-review-soft p-4">
            <p className="mb-1.5 text-xs font-semibold text-review">
              {t.hintNofM(i + 1, hints.length)}
            </p>
            <Prose html={h} className="prose-note" />
          </li>
        ))}
      </ol>
      {shown < hints.length ? (
        <Button className="mt-3" onClick={() => onReveal(shown + 1)}>
          {shown === 0 ? t.showHint : t.showNextHint}
          <span className="text-ink-3">{t.nOfM(shown + 1, hints.length)}</span>
        </Button>
      ) : null}
    </section>
  );
}

function Prerequisites({ ex, byId, state }: { ex: ExerciseMeta; byId: Map<string, ItemMeta>; state: StudentState | undefined }) {
  const t = useT();
  const ids = [...new Set([...ex.after, ...ex.mentions])].filter((id) => byId.has(id) && statusOf(state, id) !== 'done');
  const [open, setOpen] = useState(true);
  if (!ids.length) return null;
  return (
    <aside className="mb-6 rounded-lg border border-line bg-sheet px-4 py-3 text-sm">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left font-medium" aria-expanded={open}>
        <span>{t.helpfulFirst}</span>
        <span className="text-xs font-normal text-ink-3">{open ? t.hide : t.nExercises(ids.length)}</span>
      </button>
      {open ? (
        <ul className="mt-2 space-y-1">
          {ids.map((id) => (
            <ItemLink key={id} item={byId.get(id)!} state={state} />
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

/**
 * Shared files are one piece of work across exercises. If an earlier part belongs to an exercise outside the focus,
 * this one would quietly build on something that is not there yet, so it says so.
 */
function SharedOutsideFocus({ ex, byId, state }: { ex: ExerciseMeta; byId: Map<string, ItemMeta>; state: StudentState | undefined }) {
  const t = useT();
  const shared = ex.code?.shared;
  const focus = focusOf(state);
  if (!shared || !inFocus(ex, focus)) return null;
  const before = [...byId.values()].filter(
    (i): i is ExerciseMeta => i.type === 'exercise' && i.index < ex.index && i.code?.shared === shared && i.code.edits.length > 0 && !inFocus(i, focus) && statusOf(state, i.id) !== 'done',
  );
  if (!before.length) return null;
  return (
    <aside className="mb-6 rounded-lg border border-line bg-sheet px-4 py-3 text-sm">
      <p>{t.buildsOnOutsideFocus(before.map((e) => e.number).join(', '))}</p>
      <ul className="mt-2 space-y-1">
        {before.map((e) => (
          <ItemLink key={e.id} item={e} state={state} />
        ))}
      </ul>
    </aside>
  );
}

function Threads({ ex, byId, state }: { ex: ExerciseMeta; byId: Map<string, ItemMeta>; state: StudentState | undefined }) {
  const t = useT();
  const next = ex.next.filter((id) => byId.has(id));
  const similar = ex.similar.filter((id) => byId.has(id));
  if (!next.length && !similar.length) return null;
  return (
    <section className="mt-12 grid gap-6 border-t border-line pt-6 sm:grid-cols-2" aria-label={t.whereNext}>
      {next.length ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">{t.nextUp}</h2>
          <ul className="space-y-1">
            {next.map((id) => (
              <ItemLink key={id} item={byId.get(id)!} state={state} arrow />
            ))}
          </ul>
        </div>
      ) : null}
      {similar.length ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">{t.similarExercises}</h2>
          <ul className="space-y-1">
            {similar.map((id) => (
              <ItemLink key={id} item={byId.get(id)!} state={state} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ItemLink({ item, state, arrow }: { item: ItemMeta; state: StudentState | undefined; arrow?: boolean }) {
  return (
    <li>
      <Link href={`/item/${item.id}`} className={clsx('group -mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-sunk')}>
        <StatusMark status={statusOf(state, item.id)} size={14} />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        {item.type === 'exercise' ? <Level level={item.level} /> : null}
        {arrow ? <ArrowRight size={14} className="text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" /> : null}
      </Link>
    </li>
  );
}
