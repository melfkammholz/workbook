import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Clock, Compass, FileText, Flame, ListChecks, ListFilter, Search, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useRoute } from 'wouter';
import type { ChapterMeta, ExerciseKind, ItemMeta, Outline as OutlineT, PartMeta, Status, StudentState, ThreadInfo } from '@wb/shared';
import { isExercise, statusOf } from '@/lib/api';
import { adventureOfSection } from '@/lib/sections';
import { useT } from '@/lib/i18n';
import { activeCount, matches, type Filters } from '@/lib/filters';
import { Plant } from './Plant';
import { Level, StatusMark, clsx } from './ui';

const STATUSES: Status[] = ['todo', 'in_progress', 'done', 'review'];

interface Props {
  outline: OutlineT;
  state: StudentState | undefined;
  currentId: string | null;
  filters: Filters;
  patch: (p: Partial<Filters>) => void;
  reset: () => void;
  onNavigate?: () => void;
}

export function OutlinePanel({ outline, state, currentId, filters, patch, reset, onNavigate }: Props) {
  const t = useT();
  const n = activeCount(filters);
  const filtering = n > 0 || filters.q.trim() !== '';

  const visible = useMemo(
    () =>
      outline.chapters.map((c) => ({
        chapter: c,
        items: c.items.filter((i) => matches(i, statusOf(state, i.id), filters, outline.tags, outline.threads)),
      })),
    [outline, state, filters],
  );
  const shown = visible.reduce((s, v) => s + v.items.length, 0);

  return (
    <nav aria-label={t.outline} className="flex h-full min-h-0 flex-col bg-sheet">
      <div className="flex items-center gap-2 border-b border-line p-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t.filterLabel}</span>
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={filters.q}
            onChange={(e) => patch({ q: e.target.value })}
            placeholder={t.filterPlaceholder}
            className="h-8 w-full rounded-md border border-line bg-paper pl-8 pr-7 text-[13.5px] placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          {filters.q ? (
            <button type="button" aria-label={t.clearFilterText} onClick={() => patch({ q: '' })} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:text-ink">
              <X size={14} />
            </button>
          ) : null}
        </label>
        <FilterPopover outline={outline} filters={filters} patch={patch} reset={reset} count={n} />
      </div>

      {filtering ? (
        <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-ink-2">
          <span>{shown === 0 ? t.nothingMatches : t.itemsShown(shown)}</span>
          <button type="button" onClick={reset} className="font-medium text-accent hover:underline">
            {t.clearFilters}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {outline.parts.map((part) => (
          <PartBlock key={part.id} outline={outline} part={part} chapters={visible.filter((v) => v.chapter.partId === part.id)} state={state} currentId={currentId} filtering={filtering} onNavigate={onNavigate} />
        ))}
        {visible
          .filter((v) => v.chapter.partId === null)
          .map(({ chapter, items }) => (
            <ChapterBlock key={chapter.id} outline={outline} chapter={chapter} items={items} state={state} currentId={currentId} forceOpen={filtering} onNavigate={onNavigate} />
          ))}
        {shown === 0 && filtering ? (
          <p className="px-4 py-8 text-center text-sm text-ink-2">{t.noExerciseFits}</p>
        ) : null}
      </div>
    </nav>
  );
}

type VisibleChapter = { chapter: ChapterMeta; items: ItemMeta[] };

/** The top level. Collapses as a whole, so a course in two big parts can show one at a time. */
function PartBlock({
  outline,
  part,
  chapters,
  state,
  currentId,
  filtering,
  onNavigate,
}: {
  outline: OutlineT;
  part: PartMeta;
  chapters: VisibleChapter[];
  state: StudentState | undefined;
  currentId: string | null;
  filtering: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const containsCurrent = chapters.some((v) => v.chapter.items.some((i) => i.id === currentId));
  const [open, setOpen] = useState(() => readOpen(`part-${part.id}`));
  useEffect(() => {
    if (containsCurrent) setOpen(true);
  }, [containsCurrent]);
  useEffect(() => writeOpen(`part-${part.id}`, open), [part.id, open]);

  const exercises = chapters.flatMap((v) => v.chapter.items).filter(isExercise);
  const done = exercises.filter((i) => statusOf(state, i.id) === 'done').length;
  const expanded = open || filtering;
  if (filtering && chapters.every((v) => v.items.length === 0)) return null;

  return (
    <section className="border-b border-line">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={expanded} className="flex w-full items-center gap-2 bg-paper/60 px-3 py-2 text-left hover:bg-paper">
        <ChevronDown size={15} className={clsx('shrink-0 text-ink-3 transition-transform', !expanded && '-rotate-90')} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-2">{part.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-3">
          {done}/{exercises.length}
        </span>
      </button>
      {expanded
        ? chapters.map(({ chapter, items }) => <ChapterBlock key={chapter.id} outline={outline} chapter={chapter} items={items} state={state} currentId={currentId} forceOpen={filtering} onNavigate={onNavigate} />)
        : null}
    </section>
  );
}

function ChapterBlock({
  outline,
  chapter,
  items,
  state,
  currentId,
  forceOpen,
  onNavigate,
}: {
  outline: OutlineT;
  chapter: ChapterMeta;
  items: ItemMeta[];
  state: StudentState | undefined;
  currentId: string | null;
  forceOpen: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const t = useT();
  const containsCurrent = chapter.items.some((i) => i.id === currentId);
  const [open, setOpen] = useState(() => readOpen(chapter.id));
  useEffect(() => {
    if (containsCurrent) setOpen(true);
  }, [containsCurrent]);
  useEffect(() => writeOpen(chapter.id, open), [chapter.id, open]);

  const exercises = chapter.items.filter((i) => i.type === 'exercise');
  const done = exercises.filter((i) => statusOf(state, i.id) === 'done').length;
  const reviewing = exercises.filter((i) => statusOf(state, i.id) === 'review').length;
  const expanded = open || forceOpen;
  if (items.length === 0 && forceOpen) return null;

  return (
    <section className="pt-1">
      {/* Stays in sight while the chapter's rows scroll by, and leaves with the last of them. */}
      <div className="group sticky top-0 z-10 flex w-full items-center gap-1 bg-sheet pl-1.5 pr-3 hover:bg-paper">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={expanded} aria-label={expanded ? t.collapseChapter(chapter.title) : t.expandChapter(chapter.title)} className="shrink-0 rounded p-1 text-ink-3 hover:text-ink">
          <ChevronDown size={15} className={clsx('transition-transform', !expanded && '-rotate-90')} />
        </button>
        <Link
          href={`/chapter/${chapter.id}`}
          onClick={() => {
            setOpen(true);
            onNavigate?.();
          }}
          className="flex min-w-0 flex-1 items-center gap-2 py-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold tracking-tight">
              {chapter.number !== null ? <span className="mr-1.5 font-mono text-xs font-normal text-ink-3">{chapter.number}</span> : null}
              {chapter.title}
            </span>
          </span>
          {reviewing > 0 ? <span className="text-xs font-medium text-review">{t.toReview(reviewing)}</span> : null}
          <Plant chapterId={chapter.id} className="shrink-0 text-[13px] leading-none" />
          <span className="shrink-0 text-xs tabular-nums text-ink-3">
            {done}/{exercises.length}
          </span>
        </Link>
      </div>
      {expanded ? (
        <ol className="pb-1">
          {items.map((item, i) => {
            // A section's title goes above its first visible item, so a filtered list has no empty sections.
            const section = item.sectionId !== (items[i - 1]?.sectionId ?? null) ? chapter.sections.find((s) => s.id === item.sectionId) : undefined;
            return (
              <Fragment key={item.id}>
                {section ? <SectionLabel title={section.title} adventure={adventureOfSection(outline, chapter, section.id)} {...(onNavigate ? { onNavigate } : {})} /> : null}
                <Row item={item} status={statusOf(state, item.id)} answered={Object.keys(state?.checklists[item.id] ?? {}).length > 0} current={item.id === currentId} first={i === 0 && !section} last={i === items.length - 1} onNavigate={onNavigate} />
              </Fragment>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function SectionLabel({ title, adventure, onNavigate }: { title: string; adventure: ThreadInfo | undefined; onNavigate?: () => void }) {
  const t = useT();
  const here = useRoute(`/adventure/${adventure?.id ?? ''}`)[0] && !!adventure;
  const text = 'relative ml-[36px] pb-1 pr-3 pt-3.5 text-[13px] font-semibold';
  return (
    <li className="relative">
      <span aria-hidden className="absolute inset-y-0 left-[21px] w-px bg-line-strong" />
      {adventure ? (
        <Link href={`/adventure/${adventure.id}`} onClick={onNavigate} aria-current={here ? 'page' : undefined} title={t.openAdventure} className={clsx(text, 'flex items-center gap-1.5 hover:underline', here ? 'text-accent' : 'text-ink')}>
          <span className="min-w-0 truncate">{title}</span>
          <Compass size={13} className="shrink-0 text-accent" aria-hidden />
        </Link>
      ) : (
        <p className={clsx(text, 'truncate text-ink')}>{title}</p>
      )}
    </li>
  );
}

function Row({ item, status, answered, current, first, last, onNavigate }: { item: ItemMeta; status: Status; answered: boolean; current: boolean; first: boolean; last: boolean; onNavigate?: (() => void) | undefined }) {
  const t = useT();
  const ex = item.type === 'exercise' ? item : null;
  const done = status === 'done';
  // In a long outline, what is open should not be somewhere out of sight.
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (current) row.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <li ref={row} className="relative scroll-mt-10">
      {/* The thread: one segment per row so finished stretches can be coloured. */}
      <span
        aria-hidden
        className={clsx('absolute left-[21px] w-px', first ? 'top-1/2' : 'top-0', last ? 'bottom-1/2' : 'bottom-0', done ? 'bg-done' : 'bg-line-strong')}
      />
      <Link
        href={`/item/${item.id}`}
        onClick={onNavigate}
        aria-current={current ? 'page' : undefined}
        className={clsx(
          'relative flex items-center gap-2.5 py-[7px] pl-[14px] pr-3 text-[13.5px] leading-snug transition-colors',
          current ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-paper/70 hover:text-ink',
        )}
      >
        {current ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" /> : null}
        <span className="flex w-4 shrink-0 justify-center bg-transparent">
          {ex ? (
            <StatusMark status={status} />
          ) : (
            <span className="grid size-4 place-items-center rounded-[4px] bg-sheet text-ink-3 ring-1 ring-line-strong">
              {item.type === 'checklist' ? <ListChecks size={10} className={answered ? 'text-done' : undefined} /> : <FileText size={10} />}
            </span>
          )}
        </span>
        <span className={clsx('min-w-0 flex-1', status === 'done' && !current && 'text-ink-3')}>
          <span className="line-clamp-2">{item.title}</span>
        </span>
        {ex ? (
          <span className="flex shrink-0 items-center gap-1.5">
            {ex.long ? <Clock size={12} className="text-ink-3" aria-label={t.takesAWhile} /> : null}
            {ex.kind === 'challenge' ? <Flame size={12} className="text-review" aria-label={t.challenge} /> : null}
            {ex.startHere && ex.emoji ? (
              <span className="text-[13px] leading-none" role="img" aria-label={t.recommendedFirst}>
                {ex.emoji}
              </span>
            ) : null}
            <span className="flex w-[17px] justify-end"><Level level={ex.level} compact /></span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

// ───────────────────────── filters ─────────────────────────

function FilterPopover({ outline, filters, patch, reset, count }: { outline: OutlineT; filters: Filters; patch: (p: Partial<Filters>) => void; reset: () => void; count: number }) {
  const t = useT();
  const topics = outline.tags.filter((tag) => tag.type === 'topic');
  const signals = outline.tags.filter((tag) => tag.type === 'signal');
  const adventures = outline.threads.filter((x) => x.adventure);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const KINDS: [ExerciseKind, string][] = [
    ['test', t.kindQuestions],
    ['challenge', t.kindChallenges],
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={count ? t.filtersActive(count) : t.filters}
          className={clsx('relative inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors', count ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-paper text-ink-2 hover:text-ink')}
        >
          <ListFilter size={16} />
          {count ? <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-ink">{count}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-line-strong bg-sheet p-4 shadow-[var(--shadow)]">
          <Group title={t.filterStatus}>
            {STATUSES.map((s) => (
              <Toggle key={s} on={filters.statuses.includes(s)} onClick={() => patch({ statuses: toggle(filters.statuses, s) })}>
                <StatusMark status={s} size={12} /> {t.status[s]}
              </Toggle>
            ))}
          </Group>
          <Group title={t.difficulty}>
            {([1, 2, 3] as const).map((l) => (
              <Toggle key={l} on={filters.levels.includes(l)} onClick={() => patch({ levels: toggle(filters.levels, l) })}>
                <Level level={l} /> {[t.easy, t.medium, t.hard][l - 1]}
              </Toggle>
            ))}
          </Group>
          <Group title={t.filterType}>
            {KINDS.map(([k, label]) => (
              <Toggle key={k} on={filters.kinds.includes(k)} onClick={() => patch({ kinds: toggle(filters.kinds, k) })}>
                {label}
              </Toggle>
            ))}
          </Group>
          <Group title={t.filterPace}>
            <Toggle on={filters.startHereOnly} onClick={() => patch({ startHereOnly: !filters.startHereOnly })}>
              {t.recommendedFirst}
            </Toggle>
            <Toggle on={filters.hideLong} onClick={() => patch({ hideLong: !filters.hideLong })}>
              {t.hideLong}
            </Toggle>
          </Group>
          {adventures.length ? (
            <Group title={t.adventures}>
              {adventures.map((a) => (
                <Toggle key={a.id} on={filters.threads.includes(a.id)} onClick={() => patch({ threads: toggle(filters.threads, a.id) })}>
                  {a.title}
                </Toggle>
              ))}
            </Group>
          ) : null}
          {topics.length ? (
            <Group title={t.filterTopics}>
              {topics.map((tag) => (
                <Toggle key={tag.id} on={filters.tags.includes(tag.id)} onClick={() => patch({ tags: toggle(filters.tags, tag.id) })}>
                  {tag.label}
                </Toggle>
              ))}
            </Group>
          ) : null}
          {signals.length ? (
            <Group title={t.filterSignals}>
              {signals.map((tag) => (
                <Toggle key={tag.id} on={filters.tags.includes(tag.id)} onClick={() => patch({ tags: toggle(filters.tags, tag.id) })}>
                  {tag.label}
                </Toggle>
              ))}
            </Group>
          ) : null}
          <div className="mt-3 flex justify-between border-t border-line pt-3">
            <button type="button" onClick={reset} disabled={!count} className="text-sm font-medium text-accent disabled:opacity-40">
              {t.clearAll}
            </button>
            <Popover.Close className="text-sm font-medium text-ink-2 hover:text-ink">{t.close}</Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-3 min-w-0">
      <legend className="mb-1.5 text-xs font-semibold text-ink-2">{title}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] transition-colors', on ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-paper text-ink-2 hover:border-line-strong hover:text-ink')}
    >
      {children}
    </button>
  );
}

// ───────────────────────── persistence of open chapters ─────────────────────────

function readOpen(id: string): boolean {
  try {
    const v = localStorage.getItem(`wb-open-${id}`);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}
function writeOpen(id: string, open: boolean) {
  try {
    localStorage.setItem(`wb-open-${id}`, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

