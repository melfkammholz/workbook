import type { LibraryWork, WorkState } from '@wb/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { isTyping } from '@/lib/keys';
import { setWorkState, setWorkTags, useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { Empty, Spinner, clsx } from './ui';
import { useTagMap } from '@/lib/tags';
import { TagDot, TagPicker } from './TagPicker';
import { SimilarWorks, WorkEditButton, WorkEntry, WorkHave, WorkStateButtons } from './WorkBits';

type Filter = 'library' | 'later' | 'read' | 'know' | 'skip' | 'have' | 'missing' | 'all';

/** Works that were only found in a PDF's list and that the student has not sorted: the Unsorted tray. */
const isUnsorted = (w: LibraryWork) => w.state === null && w.citedOn.length === 0 && w.citedBy.length > 0;
/** What the library shows by default: sorted into later, read or know, cited in a workbook, or added by hand. */
const inLibrary = (w: LibraryWork) => (w.state === null ? !isUnsorted(w) : w.state !== 'skip');

/** The works of all the student's PDFs as one library: sorted into later, read, know and skipped; new finds wait in Unsorted. */
export function WorksLibrary() {
  const t = useT();
  const qc = useQueryClient();
  const works = useWorks().data;
  const [filter, setFilter] = useState<Filter>('library');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const tagMap = useTagMap();
  if (!works) {
    return (
      <div className="mt-10 grid place-items-center">
        <Spinner />
      </div>
    );
  }
  if (works.length === 0) return <div className="mt-10"><Empty title={t.workNone} /></div>;
  const usedTags = [...tagMap.values()].filter((g) => works.some((w) => w.tags.includes(g.id)));
  const byTag = works.filter((w) => tagFilter.every((g) => w.tags.includes(g)));
  const pick = (w: LibraryWork) => {
    if (filter === 'all') return true;
    if (filter === 'later' || filter === 'read' || filter === 'know' || filter === 'skip') return w.state === filter;
    if (!inLibrary(w)) return false;
    return filter === 'have' ? !!w.resource : filter === 'missing' ? !w.resource : true;
  };
  const shown = byTag.filter(pick);
  const unsorted = filter === 'library' ? byTag.filter(isUnsorted) : [];
  const filters: [Filter, string][] = [['library', t.workFilterLibrary], ['later', t.workFilterLater], ['read', t.workFilterRead], ['know', t.workFilterKnow], ['skip', t.workFilterSkip], ['have', t.workFilterHave], ['missing', t.workFilterMissing], ['all', t.workFilterAll]];
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group">
        {filters.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={clsx('rounded-full border px-2.5 py-0.5 text-[13px]', filter === f ? 'border-accent bg-accent-soft font-medium' : 'border-line text-ink-2 hover:bg-sunk')}>
            {label}
          </button>
        ))}
      </div>
      {usedTags.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t.tagFilter}>
          {usedTags.map((g) => {
            const on = tagFilter.includes(g.id);
            return (
              <button key={g.id} type="button" aria-pressed={on} onClick={() => setTagFilter(on ? tagFilter.filter((x) => x !== g.id) : [...tagFilter, g.id])} className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px]', on ? 'border-accent bg-accent-soft font-medium' : 'border-line text-ink-2 hover:bg-sunk')}>
                <TagDot color={g.color} />
                {g.name}
              </button>
            );
          })}
        </div>
      ) : null}
      {shown.length === 0 && unsorted.length === 0 ? (
        <p className="mt-8 text-ink-2">{t.workNoneFilter}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {shown.map((w) => (
            <WorkRow key={w.id} work={w} />
          ))}
        </ul>
      )}
      {unsorted.length ? <UnsortedTray works={unsorted} /> : null}
    </>
  );
}

/**
 * New finds from the PDFs, collapsed. Open, the keys sort the work under the cursor (L later, R read, K know, S skip),
 * the arrows move, and the next work slides into its place.
 */
function UnsortedTray({ works }: { works: LibraryWork[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const cursor = Math.min(at, works.length - 1);
  const cur = works[cursor];
  useEffect(() => {
    if (!open) return;
    const keys: Record<string, WorkState> = { l: 'later', r: 'read', k: 'know', s: 'skip' };
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('[role=dialog]')) return;
      if (e.key === 'ArrowDown') setAt(Math.min(cursor + 1, works.length - 1));
      else if (e.key === 'ArrowUp') setAt(Math.max(cursor - 1, 0));
      else if (keys[e.key.toLowerCase()] && cur) setWorkState(qc, cur.id, keys[e.key.toLowerCase()]!);
      else return;
      e.preventDefault();
      // The page's own single keys (l forward, k scroll) must not also fire.
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [open, cursor, cur, works.length, qc]);
  useEffect(() => {
    if (open) list.current?.querySelector('[data-cursor=true]')?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor, cur?.id]);
  return (
    <section className="mt-6 rounded-lg border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[14px] font-medium hover:bg-sunk">
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        {t.workUnsorted}
        <span className="tabular-nums text-ink-2">· {works.length}</span>
      </button>
      {open ? (
        <>
          <p className="px-3 pb-2 pt-0.5 text-[12px] text-ink-3">{t.workUnsortedHint}</p>
          <ul ref={list} className="divide-y divide-line border-t border-line">
            {works.map((w, i) => (
              <li key={w.id} data-cursor={i === cursor} onClick={() => setAt(i)} className={clsx('flex items-start gap-2 px-3 py-1.5', i === cursor && 'bg-accent-soft')}>
                <div className="min-w-0 flex-1">
                  <WorkEntry work={w} size="sm" fallback={w.raw} />
                </div>
                <WorkStateButtons work={w} labels />
                <WorkEditButton work={w} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function WorkRow({ work: w }: { work: LibraryWork }) {
  const t = useT();
  const qc = useQueryClient();
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <WorkEntry work={w} fallback={w.raw} />
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-3">
            {w.citedBy.length ? (
              <>
                <span>{t.workCitedBy}</span>
                {w.citedBy.map((c) => (
                  <Link key={c.resource} href={`/resources/${encodeURIComponent(c.resource)}`} className="max-w-[16rem] truncate rounded border border-line px-1.5 text-ink-2 hover:bg-sunk">
                    {c.title}
                  </Link>
                ))}
              </>
            ) : w.citedOn.length ? null : (
              <span>{t.workNotCited}</span>
            )}
            {w.citedOn.length ? (
              <>
                <span>{t.workCitedOn}</span>
                {w.citedOn.map((c) => (
                  <Link key={`${c.course}/${c.page}`} href={c.href} className="max-w-[16rem] truncate rounded border border-line px-1.5 text-ink-2 hover:bg-sunk">
                    {c.title}
                  </Link>
                ))}
              </>
            ) : null}
          </p>
          <WorkHave work={w} />
          <SimilarWorks work={w} similar={w.similar} />
          <div className="mt-1.5">
            <TagPicker size="sm" value={w.tags} onChange={(v) => setWorkTags(qc, w.id, v)} />
          </div>
        </div>
        <WorkStateButtons work={w} />
        <WorkEditButton work={w} className="size-8" />
      </div>
    </li>
  );
}
