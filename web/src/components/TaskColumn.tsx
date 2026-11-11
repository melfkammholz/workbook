import { ArrowLeft, ArrowRight, BookOpen, Clock, Compass, ExternalLink, Flag, Flame, Lightbulb, MessageCircle, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { ExerciseMeta, ItemDetail, ItemMeta, Outline, StudentState, ThreadInfo } from '@wb/shared';
import { focusOf, inFocus, isReading } from '@wb/shared';
import { itemHref, neighbours, statusOf, useCourses } from '@/lib/api';
import { itemInFocus } from '@/lib/focus';
import { issueLink } from '@/lib/issues';
import { useT } from '@/lib/i18n';
import { watchLesson } from '@/lib/lessonToc';
import { Checklist } from './Checklist';
import { ChapterMarks, OpenMarks } from './Marks';
import { Prose } from './Prose';
import { MarginNotes } from './MarginNotes';
import { Button, Chip, Level, StatusMark, clsx } from './ui';
import { Title, plainTitle } from '@/components/Title';
import { KIND_ICONS } from '@/lib/kinds';

/**
 * The one column every text is read in: exercises, pages, lessons, chapter intros, adventure pages. Text and
 * widgets share its width, so everything lines up on one axis; `#wide` breaks out of it on both sides.
 */
export const READING_COLUMN = 'wb-page max-w-[56rem] px-6 sm:px-8 w-full mx-auto';

interface Props {
  detail: ItemDetail;
  outline: Outline;
  byId: Map<string, ItemMeta>;
  state: StudentState | undefined;
  revealedHints: number;
  /** The group (session, sheet, exam) the student came from: previous and next follow it. */
  group?: string | null;
  onRevealHint: (count: number) => void;
}

/** The left pane: heading, the task as typeset text, the author's remarks, hints and threads to other exercises. */
export function TaskColumn({ detail, outline, byId, state, revealedHints, onRevealHint, group }: Props) {
  const t = useT();
  const { meta, rendered } = detail;
  const ex = meta.type === 'exercise' ? meta : null;
  const ownTags = 'tags' in meta ? meta.tags : [];
  const tagsOf = (type: 'topic' | 'signal') => outline.tags.filter((tag) => tag.type === type && ownTags.includes(tag.id));
  const errors = rendered.diagnostics.filter((d) => d.severity === 'error');
  const adventures = outline.threads.filter((x) => x.adventure && x.steps.some((step) => step.includes(meta.id)));
  // Sessions and homework sheets it belongs to, in their own order.
  const groups = outline.threads.filter((x) => x.kind && x.steps.some((step) => step.includes(meta.id)));
  const { previous, next } = neighbours(outline, meta.id, state, group);
  const chapter = outline.chapters.find((c) => c.items.some((i) => i.id === meta.id));
  const courses = useCourses().data;
  const repository = courses?.courses.find((c) => c.id === courses.activeId)?.url ?? null;
  const report = issueLink(outline.issues, repository, t.issueTitle(plainTitle(meta.title)), t.issueBody(meta.id, plainTitle(meta.title)));

  const lesson = meta.type === 'lesson';
  // Pages and lessons are set alike: a page is a lesson without widgets or a done state.
  const reading = isReading(meta);
  const extra = reading && meta.extra;
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!reading || !article.current) return;
    return watchLesson(meta.id, article.current);
  }, [reading, meta.id, rendered.task]);
  const outside = ex ? !inFocus(ex, focusOf(state)) : !itemInFocus(meta, focusOf(state));

  return (
    <article ref={article} className={clsx('settle relative mx-auto flex flex-col pb-24 pt-7', READING_COLUMN)}>
      <header className="mb-6">
        {chapter ? (
          // The way up, to the chapter this belongs to.
          <Link href={`/chapter/${chapter.id}`} className="mb-2 inline-flex max-w-full items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft size={13} className="shrink-0" /> <span className="truncate">{chapter.title}</span>
          </Link>
        ) : null}
        {lesson || extra ? (
          <p className="mb-1.5 mt-3 flex items-center gap-1.5 text-[13px] font-medium text-accent">
            {lesson ? <BookOpen size={15} aria-hidden /> : null}
            {[lesson ? t.lesson : null, extra ? t.extraMaterial : null].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <h1 className={clsx('text-balance font-semibold leading-tight', reading ? 'text-[2rem] tracking-[-0.025em]' : 'text-[1.75rem] tracking-[-0.02em]')}>
          {ex?.startHere && ex.emoji ? (
            <span className="mr-2" role="img" aria-label={t.recommendedFirst}>
              {ex.emoji}
            </span>
          ) : null}
          <Title text={meta.title} />
        </h1>
        {ex || (reading && (ownTags.length || outside || groups.length || adventures.length)) ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-2">
            {ex ? (
              <span className="inline-flex items-center gap-2">
                <Level level={ex.level} /> {[t.easy, t.medium, t.hard][ex.level - 1]}
              </span>
            ) : null}
            {ex?.kind === 'challenge' ? (
              <Chip tone="amber">
                <Flame size={12} /> {t.challenge}
              </Chip>
            ) : null}
            {ex?.long ? (
              <Chip tone="signal">
                <Clock size={12} /> {t.takesAWhile}
              </Chip>
            ) : null}
            {ex?.startHere ? (
              <Chip tone="accent">
                <Sparkles size={12} /> {t.recommendedFirst}
              </Chip>
            ) : null}
            {outside ? <Chip>{t.outsideFocus}</Chip> : null}
            {groups.map((g) => {
              const Icon = KIND_ICONS[g.kind!];
              return (
                <Link key={g.id} href={`/kind/${g.kind}`}>
                  <Chip>
                    <Icon size={12} /> {g.title}
                  </Chip>
                </Link>
              );
            })}
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

      <OpenMarks target={meta.id} />
      {meta.type === 'checklist' ? <ChapterMarks chapterId={meta.chapterId} /> : null}

      <Prose html={rendered.task} css={rendered.css} className={clsx('wb-reading', reading && 'wb-lesson')} annotate={{ target: meta.id, part: 'task' }} />

      {meta.type === 'checklist' ? <Checklist id={meta.id} questions={rendered.questions} /> : null}
      <MarginNotes target={meta.id} page={article} />

      {rendered.remarks.length ? (
        <div className="mt-8 space-y-3">
          {rendered.remarks.map((r, i) => (
            <aside key={i} className="flex gap-3 rounded-lg border border-line bg-sheet p-4">
              <MessageCircle size={17} className="mt-1 shrink-0 text-accent" aria-label={t.remark} />
              <Prose html={r} className="prose-note min-w-0 flex-1 text-[15.5px]" annotate={{ target: meta.id, part: `remark-${i}` }} />
            </aside>
          ))}
        </div>
      ) : null}

      {rendered.hints.length ? <Hints id={meta.id} hints={rendered.hints} revealed={revealedHints} onReveal={onRevealHint} /> : null}

      {ex ? <Threads ex={ex} byId={byId} state={state} /> : null}

      <nav aria-label={t.exerciseNavigation} className="mt-10 flex flex-wrap justify-between gap-3 border-t border-line pt-5 text-sm">
        {previous ? (
          <Link href={itemHref(previous.id, group)} className="group flex min-w-0 max-w-[48%] items-center gap-2 text-ink-2 hover:text-ink">
            <ArrowLeft size={15} className="shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs text-ink-3">{t.previousItem}</span>
              <span className="block truncate group-hover:underline"><Title text={previous.title} /></span>
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={itemHref(next.id, group)} className="group ml-auto flex min-w-0 max-w-[48%] items-center gap-2 text-right text-ink-2 hover:text-ink">
            <span className="min-w-0">
              <span className="block text-xs text-ink-3">{t.nextItem}</span>
              <span className="block truncate group-hover:underline"><Title text={next.title} /></span>
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

function Hints({ id, hints, revealed, onReveal }: { id: string; hints: string[]; revealed: number; onReveal: (n: number) => void }) {
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
            <Prose html={h} className="prose-note" annotate={{ target: id, part: `hint-${i}` }} />
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
        <span className="min-w-0 flex-1 truncate"><Title text={item.title} /></span>
        {item.type === 'exercise' ? <Level level={item.level} /> : null}
        {arrow ? <ArrowRight size={14} className="text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" /> : null}
      </Link>
    </li>
  );
}

/** What comes next in a session or homework sheet, for those who follow it in its order. */
