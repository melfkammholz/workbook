import type { LibraryWork } from '@wb/shared';
import { Bookmark } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { setWantToRead, setWorkTags, useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { Empty, Spinner, clsx } from './ui';
import { useTagMap } from '@/lib/tags';
import { TagDot, TagPicker } from './TagPicker';
import { SimilarWorks, WorkEntry, WorkHave } from './WorkBits';

type Filter = 'all' | 'want' | 'have' | 'missing';

/** The works of all the student's PDFs as one library: who cites them, which ones the student has, reading wishes. */
export function WorksLibrary() {
  const t = useT();
  const qc = useQueryClient();
  const works = useWorks().data;
  const [filter, setFilter] = useState<Filter>('all');
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
  const shown = works.filter((w) => tagFilter.every((g) => w.tags.includes(g))).filter((w) => (filter === 'want' ? w.wantToRead : filter === 'have' ? !!w.resource : filter === 'missing' ? !w.resource : true));
  const filters: [Filter, string][] = [['all', t.workFilterAll], ['want', t.workFilterWant], ['have', t.workFilterHave], ['missing', t.workFilterMissing]];
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
      {shown.length === 0 ? (
        <p className="mt-8 text-ink-2">{t.workNoneFilter}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {shown.map((w) => (
            <WorkRow key={w.id} work={w} onWant={() => setWantToRead(qc, '', w, !w.wantToRead)} />
          ))}
        </ul>
      )}
    </>
  );
}

function WorkRow({ work: w, onWant }: { work: LibraryWork; onWant: () => void }) {
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
        <button type="button" aria-pressed={w.wantToRead} aria-label={w.wantToRead ? t.pdfRefWantOn : t.pdfRefWant} data-tip={w.wantToRead ? t.pdfRefWantOn : t.pdfRefWant} onClick={onWant} className={clsx('inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk', w.wantToRead ? 'text-accent' : 'text-ink-2')}>
          <Bookmark size={16} fill={w.wantToRead ? 'currentColor' : 'none'} />
        </button>
      </div>
    </li>
  );
}
