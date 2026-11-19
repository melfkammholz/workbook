import type { Work, WorkEdit } from '@wb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createWork, editWork, lookupWork, removeWork } from '@/lib/bibliography';
import { useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Dialog } from './ui';

const EMPTY: WorkEdit = { title: '', authors: '', year: null, venue: '', doi: '', url: '', volume: '', pages: '', arxiv: '' };
const ARXIV = /(?:arxiv\.org\/(?:abs|pdf)\/|^arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i;

/**
 * The fields of a work as a form. The text the PDF gave is behind "Original text" and is not edited. Without `work`
 * it makes a new one: a DOI or arXiv id can fetch the fields (online lookup on), or BibTeX is pasted instead.
 */
export const yearValid = (f: WorkEdit) => f.year === null || (Number.isInteger(f.year) && f.year >= 0 && f.year <= 3000);
export const ARXIV_ID = ARXIV;

/** The rows of a work's fields; shared by the edit dialog and the add dialog. */
export function WorkFormFields({ f, setF, autoFocusTitle }: { f: WorkEdit; setF: (f: WorkEdit) => void; autoFocusTitle?: boolean }) {
  const t = useT();
  const set = (k: keyof WorkEdit) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const row = 'block text-[13px] text-ink-2';
  const yearOk = yearValid(f);
  return (
    <>
        <label className={row}>
          {t.workFieldTitle}
          <textarea autoFocus={autoFocusTitle} rows={2} value={f.title} onChange={set('title')} className="wb-field mt-0.5 w-full resize-y p-1.5 text-[14px] text-ink" />
        </label>
        <label className={row}>
          {t.workFieldAuthors}
          <input value={f.authors} onChange={set('authors')} className="wb-field mt-0.5 w-full p-1.5 text-[14px] text-ink" />
        </label>
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <label className={row}>
            {t.workFieldYear}
            <input inputMode="numeric" value={f.year ?? ''} onChange={(e) => setF({ ...f, year: e.target.value.trim() === '' ? null : Number(e.target.value.trim()) })} aria-invalid={!yearOk} className="wb-field mt-0.5 w-full p-1.5 text-[14px] text-ink" />
          </label>
          <label className={row}>
            {t.workFieldVenue}
            <input value={f.venue} onChange={set('venue')} className="wb-field mt-0.5 w-full p-1.5 text-[14px] text-ink" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={row}>
            {t.workFieldVolume}
            <input value={f.volume} onChange={set('volume')} className="wb-field mt-0.5 w-full p-1.5 text-[14px] text-ink" />
          </label>
          <label className={row}>
            {t.workFieldPages}
            <input value={f.pages} onChange={set('pages')} className="wb-field mt-0.5 w-full p-1.5 text-[14px] text-ink" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={row}>
            {t.workFieldDoi}
            <input value={f.doi} onChange={set('doi')} className="wb-field mt-0.5 w-full p-1.5 text-[14px] text-ink" />
          </label>
          <label className={row}>
            {t.workFieldArxiv}
            <input value={f.arxiv} onChange={set('arxiv')} className="wb-field mt-0.5 w-full p-1.5 text-[14px] text-ink" />
          </label>
        </div>
        <label className={row}>
          {t.workFieldUrl}
          <input value={f.url} onChange={set('url')} className="wb-field mt-0.5 w-full p-1.5 text-[14px] text-ink" />
        </label>
    </>
  );
}

export function WorkEditDialog({ work, onClose }: { work?: Work; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState<WorkEdit>(work ? { title: work.title, authors: work.authors, year: work.year, venue: work.venue, doi: work.doi, url: work.url, volume: work.volume, pages: work.pages, arxiv: work.arxiv } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [fetchId, setFetchId] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchMiss, setFetchMiss] = useState(false);
  const lookupOn = !!useSettings().data?.lookupReferences;
  const [confirm, setConfirm] = useState(false);
  const fetchIt = () => {
    if (!fetchId.trim() || fetching) return;
    setFetching(true);
    setFetchMiss(false);
    void lookupWork(fetchId.trim()).then((found) => {
      setFetching(false);
      if (!found) return setFetchMiss(true);
      const arxiv = ARXIV.exec(fetchId.trim())?.[1] ?? f.arxiv;
      setF({ ...f, ...found, arxiv, volume: f.volume, pages: f.pages });
    });
  };
  const yearOk = f.year === null || (Number.isInteger(f.year) && f.year >= 0 && f.year <= 3000);
  const [askDoi, setAskDoi] = useState(false);
  const doiChanged = !!work && !!f.doi.trim() && f.doi.trim() !== work.doi.trim();
  const fetchForDoi = () => {
    setAskDoi(false);
    setFetching(true);
    setFetchMiss(false);
    void lookupWork(f.doi.trim()).then((found) => {
      setFetching(false);
      if (!found) return setFetchMiss(true);
      setF({ ...f, ...found, doi: f.doi, arxiv: f.arxiv, volume: f.volume, pages: f.pages });
    });
  };
  const save = (skipAsk = false) => {
    if (busy || fetching || !yearOk || !f.title.trim()) return;
    if (!skipAsk && lookupOn && doiChanged) return setAskDoi(true);
    setBusy(true);
    void (work ? editWork(qc, work.id, f) : createWork(qc, f)).then(onClose, () => setBusy(false));
  };
  const row = 'block text-[13px] text-ink-2';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={work ? t.workEditTitle : t.workNewTitle} description={work ? t.workEditHint : t.workNewHint} width="max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && save()}
        className="space-y-3"
      >
        {work ? null : (
          <div className="rounded-md border border-line p-2">
            <label className={row}>
              {t.workFetchLabel}
              <span className="mt-0.5 flex gap-2">
                <input
                  autoFocus
                  value={fetchId}
                  onChange={(e) => setFetchId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      if (lookupOn) fetchIt();
                    }
                  }}
                  placeholder="10.1145/99370.99404, arXiv:2001.01234"
                  className="wb-field min-w-0 flex-1 p-1.5 text-[14px] text-ink"
                />
                <Button type="button" disabled={!lookupOn || fetching || !fetchId.trim()} onClick={fetchIt}>
                  {fetching ? t.workFetching : t.workFetch}
                </Button>
              </span>
            </label>
            <p className="mt-1 text-[12px] text-ink-3">{!lookupOn ? t.workFetchOff : fetchMiss ? t.workFetchMiss : t.workFetchHint}</p>
          </div>
        )}
        <WorkFormFields f={f} setF={setF} autoFocusTitle={!!work} />
        {askDoi ? (
          <div className="rounded-md border border-line p-2 text-[13px] text-ink-2">
            <p>{t.workDoiAsk}</p>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => save(true)}>
                {t.workDoiKeep}
              </Button>
              <Button type="button" variant="primary" autoFocus onClick={fetchForDoi}>
                {t.workDoiFetch}
              </Button>
            </div>
          </div>
        ) : fetchMiss && work ? (
          <p className="text-[12px] text-ink-3">{t.workFetchMiss}</p>
        ) : null}
        {work?.raw ? (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-2 hover:text-ink">{t.workAdvanced}</summary>
            <p className="mt-1 text-[12px] text-ink-3">{t.workAdvancedHint}</p>
            <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-sunk p-2 text-[12px] text-ink-2">{work.raw}</p>
          </details>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-1">
          {!work ? null : confirm ? (
            <>
              <span className="mr-auto text-[13px] text-ink-2">{t.workRemoveAsk}</span>
              <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>
                {t.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void removeWork(qc, work!.id).then(onClose, () => setBusy(false));
                }}
              >
                {t.workRemove}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => setConfirm(true)}>
              {t.workRemove}
            </Button>
          )}
          {confirm ? null : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={busy || !yearOk || !f.title.trim()}>
                {t.save}
              </Button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}
