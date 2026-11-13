import type { LibraryWork } from '@wb/shared';
import { Bookmark } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { setWantToRead, useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { Empty, Spinner, clsx } from './ui';
import { SimilarWorks, WorkHave } from './WorkBits';

type Filter = 'all' | 'want' | 'have' | 'missing';

/** The works of all the student's PDFs as one library: who cites them, which ones the student has, reading wishes. */
export function WorksLibrary() {
  const t = useT();
  const qc = useQueryClient();
  const works = useWorks().data;
  const [filter, setFilter] = useState<Filter>('all');
  if (!works) {
    return (
      <div className="mt-10 grid place-items-center">
        <Spinner />
      </div>
    );
  }
  if (works.length === 0) return <div className="mt-10"><Empty title={t.workNone} /></div>;
  const shown = works.filter((w) => (filter === 'want' ? w.wantToRead : filter === 'have' ? !!w.resource : filter === 'missing' ? !w.resource : true));
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
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-medium">{w.title || w.raw}</p>
          {w.title ? <p className="break-words text-[13px] text-ink-2">{[w.authors, w.year, w.venue].filter(Boolean).join(' · ')}</p> : null}
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
            ) : (
              <span>{t.workNotCited}</span>
            )}
          </p>
          <WorkHave work={w} />
          <SimilarWorks work={w} similar={w.similar} />
        </div>
        <button type="button" aria-pressed={w.wantToRead} aria-label={w.wantToRead ? t.pdfRefWantOn : t.pdfRefWant} data-tip={w.wantToRead ? t.pdfRefWantOn : t.pdfRefWant} onClick={onWant} className={clsx('inline-flex size-8 items-center justify-center rounded-md hover:bg-sunk', w.wantToRead ? 'text-accent' : 'text-ink-2')}>
          <Bookmark size={16} fill={w.wantToRead ? 'currentColor' : 'none'} />
        </button>
      </div>
    </li>
  );
}
