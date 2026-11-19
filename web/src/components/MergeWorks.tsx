import type { LibraryWork } from '@wb/shared';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { mergeWork, useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { useResources } from '@/lib/resources';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog } from './ui';

/** Whether merging two works needs the student to decide something (two different files) or to know something (two states). */
export const mergeNeedsDialog = (a: LibraryWork, b: LibraryWork) => (!!a.resource && !!b.resource && a.resource !== b.resource) || (!!a.state && !!b.state && a.state !== b.state);

const label = (w: LibraryWork) => [w.title || w.raw.slice(0, 80), w.authors, w.year].filter(Boolean).join(' · ');

/**
 * Two references that are one: which details stay, which file stays linked if both have one, and what is combined,
 * said before it happens. `b` is kept by default.
 */
export function MergeDialog({ a, b, onClose }: { a: LibraryWork; b: LibraryWork; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const resources = useResources(null).data?.resources;
  const [survivor, setSurvivor] = useState<'a' | 'b'>('b');
  const [file, setFile] = useState<'a' | 'b'>('b');
  const [busy, setBusy] = useState(false);
  const into = survivor === 'a' ? a : b;
  const from = survivor === 'a' ? b : a;
  const two = !!a.resource && !!b.resource && a.resource !== b.resource;
  const fileOf = (w: LibraryWork) => resources?.find((r) => r.id === w.resource)?.title ?? w.resource ?? '';
  const names = t.workStateNames;
  const radio = (name: string, value: 'a' | 'b', cur: string, set: (v: 'a' | 'b') => void, text: string) => (
    <label className="flex items-start gap-2 py-0.5">
      <input type="radio" name={name} className="mt-1" checked={cur === value} onChange={() => set(value)} />
      <span className="min-w-0 break-words">{text}</span>
    </label>
  );
  const go = () => {
    setBusy(true);
    const keep = two ? (file === 'a' ? a.resource : b.resource) : undefined;
    void mergeWork(qc, from.id, into.id, keep).then(onClose, onClose);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.workMergeTitle}>
      <div className="space-y-3 text-sm text-ink-2">
        <p>{t.workMergeIntro}</p>
        <fieldset>
          <legend className="font-medium text-ink">{t.workMergeKeepDetails}</legend>
          {radio('survivor', 'a', survivor, setSurvivor, label(a))}
          {radio('survivor', 'b', survivor, setSurvivor, label(b))}
        </fieldset>
        {two ? (
          <fieldset>
            <legend className="font-medium text-ink">{t.workMergeKeepFile}</legend>
            {radio('file', 'a', file, setFile, fileOf(a))}
            {radio('file', 'b', file, setFile, fileOf(b))}
            <p className="text-[12px] text-ink-3">{t.workMergeFileOther}</p>
          </fieldset>
        ) : null}
        {a.state && b.state && a.state !== b.state ? <p className="text-[13px]">{t.workMergeState(names[a.state] ?? a.state, names[b.state] ?? b.state)}</p> : null}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button variant="primary" disabled={busy} onClick={go}>
          {t.workMergeDo}
        </Button>
      </div>
    </Dialog>
  );
}

/** "Merge into…": search the library for the other reference, then the merge dialog. */
export function MergeIntoDialog({ work, onClose }: { work: LibraryWork; onClose: () => void }) {
  const t = useT();
  const works = useWorks().data;
  const [query, setQuery] = useState('');
  const [other, setOther] = useState<LibraryWork | null>(null);
  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (works ?? []).filter((w) => w.id !== work.id && words.every((x) => `${w.title} ${w.authors} ${w.year ?? ''} ${w.venue}`.toLowerCase().includes(x))).slice(0, 40);
  }, [works, work.id, query]);
  if (other) return <MergeDialog a={work} b={other} onClose={onClose} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.workMergePickTitle} description={label(work)}>
      <label className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-ink-3 focus-within:border-accent">
        <Search size={14} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.workMergeSearch} aria-label={t.workMergeSearch} className="w-full min-w-0 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3" />
      </label>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {rows.map((w) => (
          <li key={w.id}>
            <button type="button" onClick={() => setOther(w)} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-sunk">
              {label(w)}
            </button>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-2 py-1.5 text-[13px] text-ink-3">{t.workMergeNone}</li> : null}
      </ul>
    </Dialog>
  );
}
