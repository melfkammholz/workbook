import type { LibraryWork } from '@wb/shared';
import { BookOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '@/lib/api';
import { useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { type InsertText } from '@/lib/pdfRefPicker';
import { citeWorkText, registerWorkPicker } from '@/lib/workPicker';
import { Dialog } from './ui';

/** Mounted once by the app: waits for an editor to ask, and only then loads the library. */
export function WorkPicker() {
  const [insert, setInsert] = useState<{ fn: InsertText } | null>(null);
  const on = !!useSettings().data?.showMaterials;
  useEffect(() => {
    if (!on) return;
    registerWorkPicker((fn) => setInsert({ fn }));
    return () => registerWorkPicker(null);
  }, [on]);
  return insert ? <PickerDialog onPick={(text) => { insert.fn(text); setInsert(null); }} onClose={() => setInsert(null)} /> : null;
}

const MAX_ROWS = 60;

function PickerDialog({ onPick, onClose }: { onPick: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const works = useWorks().data;
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Works the student skipped are not offered; a work with no readable fields has nothing to cite by.
    return (works ?? []).filter((w) => w.title && w.state !== 'skip' && words.every((x) => `${w.title} ${w.authors} ${w.year ?? ''} ${w.venue}`.toLowerCase().includes(x))).slice(0, MAX_ROWS);
  }, [works, query]);

  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const choose = (w: LibraryWork | undefined) => w && onPick(citeWorkText(w));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.workPickTitle} description={t.workPickHint} width="max-w-xl">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.workPickSearch}
        aria-label={t.workPickSearch}
        role="combobox"
        aria-expanded
        aria-controls="wb-workpick-list"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setAt((i) => Math.min(rows.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setAt((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter') choose(rows[at]);
          else return;
          e.preventDefault();
        }}
        className="block h-9 w-full wb-field px-2.5 text-sm"
      />
      <ul id="wb-workpick-list" ref={list} role="listbox" className="mt-3 max-h-[46vh] overflow-y-auto">
        {rows.map((w, i) => (
          <li key={w.id} role="option" aria-selected={i === at}>
            <button type="button" tabIndex={-1} onMouseMove={() => setAt(i)} onClick={() => choose(w)} className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === at ? 'bg-sunk' : ''}`}>
              <BookOpen size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block break-words font-medium">{w.title}</span>
                <span className="block truncate text-[12px] text-ink-3">{[w.authors, w.year].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-2 py-3 text-[13px] text-ink-3">{works && works.length === 0 ? t.workPickEmpty : t.pdfRefNone}</li> : null}
      </ul>
    </Dialog>
  );
}
