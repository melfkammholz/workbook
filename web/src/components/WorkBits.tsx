import { MIN_CONFIDENCE, WORK_STATES, type SimilarWork, type Work, type WorkState } from '@wb/shared';
import { Bookmark, Check, EyeOff, Lightbulb, Link2, Pencil, Unlink } from 'lucide-react';
import { useState } from 'react';
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
  return (
    <select
      autoFocus
      aria-label={t.workPick}
      defaultValue=""
      onBlur={() => setPicking(false)}
      onKeyDown={(e) => e.key === 'Escape' && setPicking(false)}
      onChange={(e) => {
        if (e.target.value) void linkWork(qc, work.id, e.target.value);
        setPicking(false);
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
export function WorkEntry({ work, size = 'md', fallback }: { work: Pick<Work, 'confidence' | 'title' | 'authors' | 'year' | 'venue'>; size?: 'md' | 'sm'; fallback: string }) {
  const ok = sure(work);
  return (
    <>
      <span className={clsx('block break-words', size === 'md' && 'text-[15px]', ok && 'font-medium')}>{ok ? work.title : fallback}</span>
      {ok ? <span className={clsx('block break-words text-ink-2', size === 'md' ? 'text-[13px]' : 'text-[12px]')}>{[work.authors, work.year, size === 'md' ? work.venue : ''].filter(Boolean).join(' · ')}</span> : null}
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

/** The line under a cited work in a text: "Open" when the student has it as a material, and the sorting buttons. */
export function CiteWorkActions({ work }: { work: Work }) {
  const t = useT();
  const resources = useResources(null).data?.resources;
  const linked = work.resource ? resources?.find((r) => r.id === work.resource) : undefined;
  return (
    <span className="mt-1 inline-flex items-center gap-2 text-[12px]">
      {linked ? (
        <Link href={`/resources/${encodeURIComponent(linked.id)}`} data-tip={t.workOpenTip(linked.title)} className="rounded-md border border-line px-2 py-0.5 font-medium text-accent hover:bg-sunk">
          {t.workOpen}
        </Link>
      ) : null}
      <WorkStateButtons work={work} size="sm" />
    </span>
  );
}
