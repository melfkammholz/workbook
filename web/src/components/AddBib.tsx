import type { ImportChoice, ImportPreview, WorkState } from '@wb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { importWorks, sortNewWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { StateRow, TagsRow } from './AddShared';
import { Button, Spinner, clsx } from './ui';

/**
 * BibTeX or Hayagriva in the add dialog: one row per entry. Ones the library has already are unchecked ("Already
 * there"); checking one fills the existing work's empty fields instead of adding a second. State and tags go to the new works.
 */
export function AddBib({ text, onBack, onClose }: { text: string; onBack: () => void; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [on, setOn] = useState<boolean[]>([]);
  const [state, setState] = useState<WorkState | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.post<ImportPreview>('/api/works/import/preview', { text }).then(
      (p) => {
        if (!live) return;
        setPreview(p);
        setOn(p.items.map((i) => i.similar.length === 0));
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [text]);
  const chosen = on.filter(Boolean).length;
  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    const works: ImportChoice[] = preview.items.flatMap((i, n) => (on[n] ? [{ title: i.title, authors: i.authors, year: i.year, venue: i.venue, doi: i.doi, url: i.url, raw: i.raw, into: i.similar[0]?.id ?? null }] : []));
    try {
      const r = await importWorks(qc, works);
      await sortNewWorks(qc, r.addedIds, state, tags);
      onClose();
    } catch {
      setBusy(false);
    }
  };
  const empty = failed || (preview !== null && preview.items.length === 0);
  if (!preview && !failed) {
    return (
      <div className="grid place-items-center py-8">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {empty ? (
        <p className="text-ink-2">{t.bibImportNone}</p>
      ) : (
        <>
          <p className="text-[13px] text-ink-2">{t.bibImportIntro(preview!.items.length, preview!.format === 'hayagriva' ? 'Hayagriva' : 'BibTeX')}</p>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {preview!.items.map((i, n) => (
              <li key={n} className="flex items-start gap-2 py-2">
                <input type="checkbox" className="wb-check mt-1" aria-label={i.title} checked={!!on[n]} onChange={(e) => setOn(on.map((v, k) => (k === n ? e.target.checked : v)))} />
                <div className="min-w-0 flex-1">
                  <p className={clsx('break-words text-[14px] font-medium', !on[n] && 'text-ink-3')}>{i.title}</p>
                  <p className="break-words text-[12px] text-ink-2">{[i.authors, i.year, i.venue].filter(Boolean).join(' · ')}</p>
                </div>
                {i.similar.length ? <span className="shrink-0 text-[12px] text-warn">{on[n] ? t.addMerges : t.addThere}</span> : null}
              </li>
            ))}
          </ul>
          <div className="border-t border-line pt-2">
            <StateRow value={state} onChange={setState} />
            <TagsRow value={tags} onChange={setTags} />
          </div>
        </>
      )}
      <div className="flex items-center gap-2 pt-1">
        <span className="mr-auto text-[12px] text-ink-3">{empty ? '' : t.addFilesLater}</span>
        <Button variant="ghost" onClick={onBack}>
          {t.addBack}
        </Button>
        <Button variant="primary" disabled={busy || chosen === 0} onClick={() => void confirm()}>
          {t.addCount(chosen)}
        </Button>
      </div>
    </div>
  );
}
