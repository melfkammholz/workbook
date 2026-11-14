import type { Work, WorkEdit } from '@wb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { editWork, removeWork } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { Button, Dialog } from './ui';

/** The fields of a work as a form. The text the PDF gave is behind "Original text" and is not edited. */
export function WorkEditDialog({ work, onClose }: { work: Work; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState<WorkEdit>({ title: work.title, authors: work.authors, year: work.year, venue: work.venue, doi: work.doi, url: work.url, volume: work.volume, pages: work.pages, arxiv: work.arxiv });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = (k: keyof WorkEdit) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const yearOk = f.year === null || (Number.isInteger(f.year) && f.year >= 0 && f.year <= 3000);
  const save = () => {
    if (busy || !yearOk) return;
    setBusy(true);
    void editWork(qc, work.id, f).then(onClose, () => setBusy(false));
  };
  const row = 'block text-[13px] text-ink-2';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.workEditTitle} description={t.workEditHint} width="max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && save()}
        className="space-y-3"
      >
        <label className={row}>
          {t.workFieldTitle}
          <textarea autoFocus rows={2} value={f.title} onChange={set('title')} className="wb-field mt-0.5 w-full resize-y p-1.5 text-[14px] text-ink" />
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
        {work.raw ? (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-2 hover:text-ink">{t.workAdvanced}</summary>
            <p className="mt-1 text-[12px] text-ink-3">{t.workAdvancedHint}</p>
            <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-sunk p-2 text-[12px] text-ink-2">{work.raw}</p>
          </details>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-1">
          {confirm ? (
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
                  void removeWork(qc, work.id).then(onClose, () => setBusy(false));
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
              <Button type="submit" variant="primary" disabled={busy || !yearOk}>
                {t.save}
              </Button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}
