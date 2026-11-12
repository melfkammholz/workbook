import * as Popover from '@radix-ui/react-popover';
import { BookOpen, ChevronDown, Clock, Compass, FileText, Flame, ListChecks, ListFilter, Search, X } from 'lucide-react';
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import type { ChapterMeta, ExerciseKind, ItemMeta, Outline as OutlineT, PartMeta, Status, StudentState, ThreadInfo } from '@wb/shared';
import { statusOf, useSettings } from '@/lib/api';
import { KIND_ICONS, kindProgress, kindsOf } from '@/lib/kinds';
import { useLessonToc } from '@/lib/lessonToc';
import { focusExercises, foldItems } from '@/lib/focus';
import { adventureOfSection, isChapterWide } from '@/lib/sections';
import { useT } from '@/lib/i18n';
import { ITEM_TYPES, activeCount, matches, type Filters } from '@/lib/filters';
import { Plant } from './Plant';
import { Level, StatusMark, clsx } from './ui';
import { Title } from '@/components/Title';
import { NavLink } from '@/lib/history';
import { afterPaint } from '@/lib/afterPaint';

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
  // Grouped once, so a part's list stays the same object and an unchanged part is not drawn again.
  const byPart = useMemo(() => new Map(outline.parts.map((p) => [p.id, visible.filter((v) => v.chapter.partId === p.id)])), [outline.parts, visible]);
  // Only the part and chapter that hold the open item learn which one it is; the others stay as they were on a page change.
  const holds = (items: ItemMeta[]) => (currentId !== null && items.some((i) => i.id === currentId) ? currentId : null);

  return (
    <nav aria-label={t.outline} className="wb-chrome-side flex h-full min-h-0 flex-col bg-sheet text-ink">
      <div className="flex items-center gap-2 border-b border-line p-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t.filterLabel}</span>
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={filters.q}
            onChange={(e) => patch({ q: e.target.value })}
            placeholder={t.filterPlaceholder}
            className="h-8 w-full wb-field pl-8 pr-7 text-[13.5px] placeholder:text-ink-3"
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
        {filtering ? null : <KindLinks outline={outline} state={state} onNavigate={onNavigate} />}
        {outline.parts.map((part, i) => {
          const chapters = byPart.get(part.id)!;
          return <PartBlock key={part.id} number={i + 1} outline={outline} part={part} chapters={chapters} state={state} currentId={holds(chapters.flatMap((v) => v.chapter.items))} filtering={filtering} onNavigate={onNavigate} />;
        })}
        {visible
          .filter((v) => v.chapter.partId === null)
          .map(({ chapter, items }) => (
            <ChapterBlock key={chapter.id} outline={outline} chapter={chapter} items={items} state={state} currentId={holds(chapter.items)} forceOpen={filtering} onNavigate={onNavigate} />
          ))}
        {shown === 0 && filtering ? (
          <p className="px-4 py-8 text-center text-sm text-ink-2">{t.noExerciseFits}</p>
        ) : null}
      </div>
    </nav>
  );
}

/**
 * The course's work besides its chapters: sessions, homework, old exams. A building block of its own, so it
 * comes first, and looks like one: a band like the parts, its kinds like chapters.
 */
function KindLinks({ outline, state, onNavigate }: { outline: OutlineT; state: StudentState | undefined; onNavigate?: (() => void) | undefined }) {
  const t = useT();
  const [location] = useLocation();
  const kinds = kindsOf(outline);
  const here = kinds.some((k) => location === `/kind/${k}`);
  const [open, setOpen] = useState(() => readOpen('part-course-work'));
  useEffect(() => {
    if (here) setOpen(true);
  }, [here]);
  useEffect(() => writeOpen('part-course-work', open), [open]);
  if (!kinds.length) return null;
  const all = kinds.map((k) => kindProgress(outline, k, state));
  return (
    <section className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-line bg-sunk px-3 py-2.5 text-left hover:bg-line/60"
      >
        <ChevronDown size={16} className={clsx('shrink-0 text-ink-2 transition-transform', !open && '-rotate-90')} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-ink" title={t.courseWork}>{t.courseWorkShort}</span>
        <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">
          {all.reduce((n, p) => n + p.done, 0)}/{all.reduce((n, p) => n + p.total, 0)}
        </span>
      </button>
      {open ? (
        <ul>
          {kinds.map((k, i) => {
            const on = location === `/kind/${k}`;
            const Icon = KIND_ICONS[k];
            return (
              <li key={k}>
                <Link
                  href={`/kind/${k}`}
                  onClick={onNavigate}
                  aria-current={on ? 'page' : undefined}
                  className={clsx(
                    'relative flex items-center gap-2 border-line py-2 pl-[11px] pr-3 text-[13.5px] font-semibold tracking-tight',
                    i > 0 && 'border-t',
                    on ? 'bg-accent-soft text-ink' : 'bg-[color-mix(in_srgb,var(--paper)_45%,var(--sheet))] text-ink hover:bg-paper',
                  )}
                >
                  {on ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" /> : null}
                  <Icon size={14} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate">{t.threadKind[k]}</span>
                  <span className="shrink-0 text-xs font-normal tabular-nums text-ink-3">
                    {all[i]!.done}/{all[i]!.total}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

type VisibleChapter = { chapter: ChapterMeta; items: ItemMeta[] };

/** The top level. Collapses as a whole, so a course in two big parts can show one at a time. */
const PartBlock = memo(function PartBlock({
  number,
  outline,
  part,
  chapters,
  state,
  currentId,
  filtering,
  onNavigate,
}: {
  number: number;
  outline: OutlineT;
  part: PartMeta;
  chapters: VisibleChapter[];
  state: StudentState | undefined;
  currentId: string | null;
  filtering: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const containsCurrent = currentId !== null;
  const [open, setOpen] = useState(() => readOpen(`part-${part.id}`));
  useEffect(() => {
    if (containsCurrent) setOpen(true);
  }, [containsCurrent]);
  useEffect(() => writeOpen(`part-${part.id}`, open), [part.id, open]);
  // The band's height wraps with the title, so its chapters learn where to stick from the band itself.
  const section = useRef<HTMLElement>(null);
  const band = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const b = band.current;
    if (!b) return;
    const set = () => section.current?.style.setProperty('--band', `${b.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  const exercises = focusExercises(chapters.flatMap((v) => v.chapter.items), state);
  const done = exercises.filter((i) => statusOf(state, i.id) === 'done').length;
  const expanded = open || filtering;
  if (filtering && chapters.every((v) => v.items.length === 0)) return null;

  return (
    // Its chapters' headers stick just below the band (its measured height), so the two never cover each other.
    <section ref={section} className="border-b border-line">
      {/* The top level, so it reads as one: a band of its own, and it stays in view while its chapters scroll by. */}
      <button
        ref={band}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={expanded}
        className="sticky top-0 z-10 flex w-full items-center gap-2.5 border-b border-line bg-[color-mix(in_srgb,var(--paper)_55%,var(--sheet))] py-[9px] pl-3.5 pr-3 text-left hover:bg-[color-mix(in_srgb,var(--paper)_80%,var(--sheet))]"
      >
        {/* Numbered, so the course's parts read as the level above its chapters. */}
        <span aria-hidden className="grid size-[26px] shrink-0 place-items-center rounded-[7px] border border-line bg-sheet text-[13px] font-bold tabular-nums text-accent">{number}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold leading-tight text-ink">{part.title}</span>
          {part.summary ? <span className="block truncate text-xs leading-snug text-ink-3">{part.summary}</span> : null}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-ink-3">
          {done}/{exercises.length}
        </span>
        <ChevronDown size={14} className={clsx('shrink-0 text-ink-3 transition-transform', !expanded && '-rotate-90')} />
      </button>
      {expanded
        ? chapters.map(({ chapter, items }) => (
            <ChapterBlock key={chapter.id} outline={outline} chapter={chapter} items={items} state={state} currentId={chapter.items.some((i) => i.id === currentId) ? currentId : null} forceOpen={filtering} onNavigate={onNavigate} />
          ))
        : null}
    </section>
  );
});

const ChapterBlock = memo(function ChapterBlock({
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
  const containsCurrent = currentId !== null;
  const [open, setOpen] = useState(() => readOpen(chapter.id));
  useEffect(() => {
    if (containsCurrent) setOpen(true);
  }, [containsCurrent]);
  useEffect(() => writeOpen(chapter.id, open), [chapter.id, open]);

  // Counts what is in the focus. Review later is the student's own list, so it counts everything marked.
  const exercises = focusExercises(chapter.items, state);
  const done = exercises.filter((i) => statusOf(state, i.id) === 'done').length;
  const reviewing = chapter.items.filter((i) => i.type === 'exercise' && statusOf(state, i.id) === 'review').length;
  const expanded = open || forceOpen;
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (key: string) => setOpened((o) => (o.has(key) ? new Set([...o].filter((k) => k !== key)) : new Set([...o, key])));
  const entries = foldItems(chapter.id, items, state, opened, forceOpen);
  if (items.length === 0 && forceOpen) return null;

  return (
    <section className="pb-1.5">
      {/* Stays in sight while the chapter's rows scroll by, and leaves with the last of them. Its own ground marks where a chapter starts. */}
      <div className="group sticky top-[var(--band,0px)] z-[9] flex w-full items-center gap-1 bg-sheet pl-[9px] pr-3 hover:bg-[color-mix(in_srgb,var(--paper)_45%,var(--sheet))]">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={expanded} aria-label={expanded ? t.collapseChapter(chapter.title) : t.expandChapter(chapter.title)} className="shrink-0 rounded p-1 text-ink-3 hover:text-ink">
          <ChevronDown size={14} className={clsx('transition-transform', !expanded && '-rotate-90')} />
        </button>
        <NavLink
          href={`/chapter/${chapter.id}`}
          onClick={() => {
            setOpen(true);
            onNavigate?.();
          }}
          className="flex min-w-0 flex-1 items-center gap-2 py-[9px]"
        >
          {chapter.number !== null ? <span className="w-4 shrink-0 text-right text-[13.5px] font-medium tabular-nums text-ink-3">{chapter.number}</span> : null}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{chapter.title}</span>
          {reviewing > 0 ? <span className="text-xs font-medium text-review">{t.toReview(reviewing)}</span> : null}
          <Plant chapterId={chapter.id} className="shrink-0 text-[13px] leading-none" />
          <span className="shrink-0 text-xs font-medium tabular-nums text-ink-3">
            {done}/{exercises.length}
          </span>
        </NavLink>
      </div>
      {expanded ? (
        <ol className="pb-1">
          {entries.map((entry, i) => {
            const sectionId = entry.kind === 'item' ? entry.item.sectionId : entry.sectionId;
            const before = entries[i - 1];
            const previousSection = before ? (before.kind === 'item' ? before.item.sectionId : before.sectionId) : null;
            // A section's title goes above its first visible entry, so a filtered list has no empty sections.
            const section = sectionId !== previousSection ? chapter.sections.find((s) => s.id === sectionId) : undefined;
            const next = entries[i + 1];
            const endsThread = i === entries.length - 1 || (next?.kind === 'item' && isChapterWide(chapter, next.item));
            const label = section ? <SectionLabel title={section.title} adventure={adventureOfSection(outline, chapter, section.id)} {...(onNavigate ? { onNavigate } : {})} /> : null;
            if (entry.kind === 'fold')
              return (
                <Fragment key={entry.key}>
                  {label}
                  <FoldRow
                    text={entry.open ? t.foldAway : t.moreOutsideFocus(entry.hidden.length)}
                    open={entry.open}
                    first={i === 0 && !section}
                    last={endsThread}
                    onClick={() => toggleFold(entry.key)}
                  />
                </Fragment>
              );
            const item = entry.item;
            // The checklist that ends the chapter stands off the thread, below a short rule, so it does not look like part of the last section.
            return (
              <Fragment key={item.id}>
                {label}
                <Row item={item} status={statusOf(state, item.id)} answered={Object.keys(state?.checklists[item.id] ?? {}).length > 0} current={item.id === currentId} first={i === 0 && !section} last={endsThread} wide={isChapterWide(chapter, item)} outside={entry.outside} onNavigate={onNavigate} />
              </Fragment>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
});

/** Exercises outside the focus, folded into one quiet line on the thread. */
function FoldRow({ text, open, first, last, onClick }: { text: string; open: boolean; first: boolean; last: boolean; onClick: () => void }) {
  return (
    <li className="relative" data-first={first || undefined} data-last={last || undefined}>
      <button type="button" onClick={onClick} aria-expanded={open} className="relative flex w-full items-center gap-[9px] py-[5px] pl-[13px] pr-3.5 text-left text-[12.5px] text-ink-3 hover:text-ink">
        <span className="flex w-4 shrink-0 justify-center">
          <span aria-hidden className="size-[5px] rounded-full bg-line-strong" />
        </span>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        <ChevronDown size={13} className={clsx('shrink-0 transition-transform', open ? 'rotate-180' : '')} />
      </button>
    </li>
  );
}

const SECTION_TEXT = 'relative pb-[3px] pl-[38px] pr-3.5 pt-2.5 text-xs font-semibold';

function SectionLabel({ title, adventure, onNavigate }: { title: string; adventure: ThreadInfo | undefined; onNavigate?: () => void }) {
  return (
    <li className="relative">
      {adventure ? <AdventureLabel title={title} adventure={adventure} {...(onNavigate ? { onNavigate } : {})} /> : <p className={clsx(SECTION_TEXT, 'truncate text-ink-3')}>{title}</p>}
    </li>
  );
}

/** Only these few labels follow the location; a plain section title has no reason to be drawn again on a page change. */
function AdventureLabel({ title, adventure, onNavigate }: { title: string; adventure: ThreadInfo; onNavigate?: () => void }) {
  const t = useT();
  const [here] = useRoute(`/adventure/${adventure.id}`);
  return (
    <Link href={`/adventure/${adventure.id}`} onClick={onNavigate} aria-current={here ? 'page' : undefined} title={t.openAdventure} className={clsx(SECTION_TEXT, 'flex items-center gap-1.5 hover:underline', here ? 'text-accent' : 'text-ink-3')}>
      <span className="min-w-0 truncate">{title}</span>
      <Compass size={12} className="shrink-0 text-accent" aria-hidden />
    </Link>
  );
}

const Row = memo(function Row({ item, status, answered, current, first, last, wide, outside, onNavigate }: { item: ItemMeta; status: Status; answered: boolean; current: boolean; first: boolean; last: boolean; wide: boolean; outside: boolean; onNavigate?: (() => void) | undefined }) {
  const t = useT();
  const ex = item.type === 'exercise' ? item : null;
  const done = status === 'done';
  // In a long outline, what is open should not be somewhere out of sight. After the page is painted: finding out
  // where the row is lays out the whole page, which would otherwise happen once more before the first frame.
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (current) return afterPaint(() => row.current?.scrollIntoView({ block: 'nearest' }));
  }, [current]);
  return (
    <li ref={row} className={clsx('relative scroll-mt-10', wide && 'mt-1.5')} data-first={first || undefined} data-last={last || undefined}>
      {/* A short rule inside the chapter, not across the pane, so it does not read as the start of the next chapter. */}
      {wide ? <span aria-hidden className="absolute left-[14px] right-3.5 top-0 h-px bg-line" /> : null}
      <NavLink
        href={`/item/${item.id}`}
        onClick={onNavigate}
        aria-current={current ? 'page' : undefined}
        className={clsx(
          'relative flex min-h-[30px] items-center gap-[9px] py-1 text-[13.5px] leading-[1.35] transition-colors',
          'pl-[13px] pr-3.5',
          current ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-paper',
        )}
      >
        {current ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" /> : null}
        <span className="flex w-4 shrink-0 justify-center bg-transparent">
          {ex ? (
            <StatusMark status={status} />
          ) : item.type === 'checklist' ? (
            <ListChecks size={15} strokeWidth={1.75} className={answered ? 'text-done' : current ? 'text-accent' : 'text-ink-3'} />
          ) : item.type === 'lesson' ? (
            <BookOpen size={15} strokeWidth={1.75} className={done ? 'text-done' : current ? 'text-accent' : 'text-ink-3'} />
          ) : (
            <FileText size={15} strokeWidth={1.75} className={current ? 'text-accent' : 'text-ink-3'} />
          )}
        </span>
        <span className={clsx('min-w-0 flex-1', outside && !current && 'text-ink-3')} title={outside ? t.outsideFocus : undefined}>
          <span className={clsx('line-clamp-2', outside && 'italic')}><Title text={item.title} /></span>
          {outside ? <span className="sr-only">, {t.outsideFocus}</span> : null}
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
            <span className="flex w-[14px] justify-end"><Level level={ex.level} compact className="gap-[2.5px] [&>span]:size-[3.5px] [&>span]:opacity-55" /></span>
          </span>
        ) : null}
      </NavLink>
      {current && (item.type === 'lesson' || item.type === 'page') ? <LessonSections id={item.id} /> : null}
    </li>
  );
});

/** The sections of the lesson that is open, with the one being read marked. */
function LessonSections({ id }: { id: string }) {
  const t = useT();
  const toc = useLessonToc();
  const on = useSettings().data?.showLessonOutline ?? true;
  if (!on || toc?.id !== id || toc.sections.length < 2) return null;
  return (
    <ol aria-label={t.lessonSections} className="relative mb-1 ml-10 border-l border-line">
      {toc.sections.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            aria-current={i === toc.active ? 'location' : undefined}
            onClick={() => s.el.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className={clsx(
              'block w-full px-2.5 py-[3px] text-left text-[12.5px] leading-[1.35] transition-colors',
              i === toc.active ? 'text-accent shadow-[inset_2px_0_0_var(--accent)]' : 'text-ink-3 hover:text-ink',
            )}
          >
            <Title text={s.title} />
          </button>
        </li>
      ))}
    </ol>
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
        <Popover.Content align="end" sideOffset={8} className="wb-menu max-h-[70vh] w-72 overflow-y-auto p-4">
          <Group title={t.filterShow}>
            {ITEM_TYPES.map((k) => (
              <Toggle key={k} on={filters.types.includes(k)} onClick={() => patch({ types: toggle(filters.types, k) })}>
                {t.itemTypes[k]}
              </Toggle>
            ))}
          </Group>
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

