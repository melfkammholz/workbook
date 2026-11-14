import { MIN_CONFIDENCE, WORK_STATES, type SimilarWork, type Work, type WorkState } from '@wb/shared';
import * as Popover from '@radix-ui/react-popover';
import { Bookmark, Check, EyeOff, Lightbulb, Link2, Pencil, Unlink } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { keepWorksSeparate, linkWork, mergeWork, setWorkState } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { useResources } from '@/lib/resources';
import { useQueryClient } from '@tanstack/react-query';
import { IconButton, clsx } from './ui';
import { WorkEditDialog } from './WorkEditDialog';

/** Whether the fields read from a reference's text can be shown; if not, the raw text is. */
export const sure = (w: Pick<Work, 'confidence' | 'title'>) => !!w.title && w.confidence >= MIN_CONFIDENCE;

/** "Looks like X in your library": the student says it is the same work (merge) or not (kept separate). */
export function SimilarWorks({ work, similar }: { work: Work; similar: SimilarWork[] }) {
  const t = useT();
  const qc = useQueryClient();
  if (similar.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {similar.map((s) => (
        <li key={s.id} className="rounded-md bg-accent-soft px-2 py-1 text-[12px]">
          <span className="block break-words">{t.workLooksLike(s.title || s.authors, s.year, s.cited)}</span>
          <span className="mt-0.5 flex gap-2">
            <button type="button" onClick={() => void mergeWork(qc, s.id, work.id)} className="font-medium text-accent hover:underline">
              {t.workMerge}
            </button>
            <button type="button" onClick={() => void keepWorksSeparate(qc, work.id, s.id)} className="text-ink-2 hover:underline">
              {t.workKeepSeparate}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "I have this": which material of the student's is the work; following the link opens that PDF. */
export function WorkHave({ work, except }: { work: Work; except?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const resources = useResources(null).data?.resources;
  const [picking, setPicking] = useState(false);
  const linked = work.resource ? resources?.find((r) => r.id === work.resource) : undefined;
  if (work.resource) {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-2">
        <span>{t.workHave}</span>
        {linked ? (
          <Link href={`/resources/${encodeURIComponent(linked.id)}`} className="min-w-0 truncate font-medium text-accent hover:underline">
            {linked.title}
          </Link>
        ) : null}
        <button type="button" aria-label={t.workUnlink} data-tip={t.workUnlink} onClick={() => void linkWork(qc, work.id, null)} className="rounded p-0.5 text-ink-3 hover:bg-sunk hover:text-ink">
          <Unlink size={12} />
        </button>
      </p>
    );
  }
  if (!picking) {
    return (
      <button type="button" onClick={() => setPicking(true)} className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink hover:underline">
        <Link2 size={12} /> {t.workIHaveThis}
      </button>
    );
  }
  return <WorkLinkPicker work={work} except={except} onDone={() => setPicking(false)} />;
}

/** The choice of which material of the student's a work is; picking one links it, leaving the field or Escape closes it. */
export function WorkLinkPicker({ work, except, onDone }: { work: Work; except?: string; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const resources = useResources(null).data?.resources;
  return (
    <select
      autoFocus
      aria-label={t.workPick}
      defaultValue=""
      onBlur={() => onDone()}
      onKeyDown={(e) => e.key === 'Escape' && onDone()}
      onChange={(e) => {
        if (e.target.value) void linkWork(qc, work.id, e.target.value);
        onDone();
      }}
      className="wb-field mt-0.5 w-full max-w-full py-0.5 text-[12px]"
    >
      <option value="" disabled>
        {t.workPick}
      </option>
      {(resources ?? [])
        .filter((r) => r.id !== except)
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
    </select>
  );
}

/**
 * A work as an entry: the title, then who and when. The same look in the library (`md`), a PDF's list (`sm`) and, as
 * CSS (`.wb-cite-work` in styles.css, which must stay in step), in a text of a workbook.
 */
export function WorkEntry({ work, size = 'md', fallback, extra = [], tail }: { work: Pick<Work, 'confidence' | 'title' | 'authors' | 'year' | 'venue'>; size?: 'md' | 'sm'; fallback: string; extra?: ReactNode[]; tail?: ReactNode }) {
  const ok = sure(work);
  const line = ok ? [work.authors, work.year, size === 'md' ? work.venue : ''].filter(Boolean).join(' · ') : '';
  // What the caller adds (where it is cited, its file) joins the same line, after a dot; `tail` (the tags) follows without one.
  const parts = [line, ...extra].filter(Boolean);
  return (
    <>
      <span className={clsx('block break-words', size === 'md' && 'text-[15px]', ok && 'font-medium')}>{ok ? work.title : fallback}</span>
      {parts.length || tail ? (
        <span className={clsx('flex flex-wrap items-center gap-x-1.5 break-words text-ink-2', size === 'md' ? 'text-[13px]' : 'text-[12px]')}>
          {parts.map((p, i) => (
            <Fragment key={i}>
              {i > 0 ? <span aria-hidden>·</span> : null}
              {p}
            </Fragment>
          ))}
          {tail ? <span className={parts.length ? 'ml-1' : ''}>{tail}</span> : null}
        </span>
      ) : null}
    </>
  );
}

const STATE_ICON = { later: Bookmark, read: Check, know: Lightbulb, skip: EyeOff } as const;

/** One state per work: Later, Read, Know, Skip. Pressing the one that is on puts the work back to Unsorted. */
export function WorkStateButtons({ work, labels = false, size = 'md' }: { work: Pick<Work, 'id' | 'state'>; labels?: boolean; size?: 'sm' | 'md' }) {
  const t = useT();
  const qc = useQueryClient();
  const names: Record<WorkState, string> = { later: t.workStateLater, read: t.workStateRead, know: t.workStateKnow, skip: t.workStateSkip };
  return (
    <span className="inline-flex items-center gap-0.5" role="group" aria-label={t.workStateLater}>
      {WORK_STATES.map((st) => {
        const Icon = STATE_ICON[st];
        const on = work.state === st;
        return (
          <button
            key={st}
            type="button"
            aria-pressed={on}
            aria-label={names[st]}
            data-tip={t.workStateTip[st]}
            onClick={() => setWorkState(qc, work.id, on ? null : st)}
            className={clsx('inline-flex items-center justify-center gap-1 rounded-md hover:bg-sunk', labels ? 'h-7 px-1.5 text-[12px]' : size === 'sm' ? 'size-6' : 'size-8', on ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2')}
          >
            <Icon size={size === 'sm' ? 13 : 15} />
            {labels ? names[st] : null}
          </button>
        );
      })}
    </span>
  );
}

/** The four states as labeled buttons with their keys, for the highlighted work in the Unsorted tray. */
export function WorkSortStrip({ work }: { work: Pick<Work, 'id' | 'state'> }) {
  const t = useT();
  const qc = useQueryClient();
  const names: Record<WorkState, string> = { later: t.workStateLater, read: t.workStateRead, know: t.workStateKnow, skip: t.workStateSkip };
  return (
    <span className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t.workStateLater}>
      {WORK_STATES.map((st) => {
        const Icon = STATE_ICON[st];
        return (
          <button key={st} type="button" data-tip={t.workStateTip[st]} onClick={() => setWorkState(qc, work.id, st)} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-sheet py-[3px] pl-2 pr-1.5 text-[13px] hover:bg-sunk">
            <Icon size={13} className="text-ink-2" />
            {names[st]}
            <kbd className="rounded border border-line bg-sunk px-1 text-[11.5px] leading-[1.35] text-ink-2">{STATE_KEY[st]}</kbd>
          </button>
        );
      })}
    </span>
  );
}

const STATE_LOOK: Record<WorkState | 'none', string> = {
  later: 'bg-accent-soft text-accent',
  read: 'bg-done-soft text-done',
  know: 'bg-review-soft text-review',
  skip: 'text-ink-3',
  none: 'border border-dashed border-line-strong text-ink-3',
};
const STATE_KEY: Record<WorkState, string> = { later: 'L', read: 'R', know: 'K', skip: 'S' };

/**
 * The state of a work as the glyph in the row's first column (a dashed circle while unsorted). Pressing it opens the
 * four states with their keys; the one that is on, chosen again, puts the work back to unsorted.
 */
export function WorkStateMenu({ work }: { work: Pick<Work, 'id' | 'state'> }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const names: Record<WorkState, string> = { later: t.workStateLater, read: t.workStateRead, know: t.workStateKnow, skip: t.workStateSkip };
  const Glyph = work.state ? STATE_ICON[work.state] : null;
  const set = (st: WorkState) => {
    setWorkState(qc, work.id, work.state === st ? null : st);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={work.state ? names[work.state] : t.workStateNone}
          data-tip={work.state ? t.workStateTip[work.state] : t.workStateNone}
          className={clsx('grid size-7 shrink-0 place-items-center rounded-lg hover:brightness-95', STATE_LOOK[work.state ?? 'none'], open && 'ring-2 ring-accent ring-offset-1 ring-offset-sheet')}
        >
          {Glyph ? <Glyph size={15} /> : <span aria-hidden className="size-1.5 rounded-full bg-line-strong" />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          role="menu"
          aria-label={t.workStateLater}
          className="wb-menu w-56 p-1"
          onKeyDown={(e) => {
            const st = ({ l: 'later', r: 'read', k: 'know', s: 'skip' } as Record<string, WorkState>)[e.key.toLowerCase()];
            if (!st || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            set(st);
          }}
        >
          {WORK_STATES.map((st) => {
            const Icon = STATE_ICON[st];
            const on = work.state === st;
            return (
              <button key={st} type="button" role="menuitemradio" aria-checked={on} onClick={() => set(st)} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13.5px] outline-none hover:bg-sunk focus-visible:bg-sunk">
                <span className={clsx('grid size-6 place-items-center rounded-md', on ? STATE_LOOK[st] : 'text-ink-2')}>
                  <Icon size={14} />
                </span>
                <span className={clsx('flex-1', on && 'font-medium')}>{names[st]}</span>
                <kbd className="rounded border border-line bg-sunk px-1.5 text-[11.5px] text-ink-2">{STATE_KEY[st]}</kbd>
              </button>
            );
          })}
          {work.state ? <p className="px-2.5 pb-1 pt-1.5 text-[12px] text-ink-3">{t.workStateAgain}</p> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The pencil that opens the form for a work's fields. */
export function WorkEditButton({ work, className }: { work: Work; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={t.workEdit} onClick={() => setOpen(true)} className={className ?? 'size-6'}>
        <Pencil size={13} />
      </IconButton>
      {open ? <WorkEditDialog work={work} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The parts of a cited work's row in a text: the state glyph (first column) and "Open" (last), placed by the grid of
 * `.wb-cite-work` in styles.css.
 */
export function CiteWorkActions({ work }: { work: Work }) {
  const t = useT();
  const resources = useResources(null).data?.resources;
  const linked = work.resource ? resources?.find((r) => r.id === work.resource) : undefined;
  return (
    <>
      <WorkStateMenu work={work} />
      {linked ? (
        <Link href={`/resources/${encodeURIComponent(linked.id)}`} data-tip={t.workOpenTip(linked.title)} className="rounded-md border border-line px-2 py-0.5 text-[12px] font-medium text-accent hover:bg-sunk">
          {t.workOpen}
        </Link>
      ) : null}
    </>
  );
}
