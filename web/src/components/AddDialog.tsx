import type { LibraryWork, WorkEdit } from '@wb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createWork, lookupWork, useWorks } from '@/lib/bibliography';
import { useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BibImportDialog, looksLikeBibliography } from './BibImport';
import { ARXIV_ID, WorkFormFields, yearValid } from './WorkEditDialog';
import { Button, Dialog, Spinner, clsx } from './ui';

const EMPTY: WorkEdit = { title: '', authors: '', year: null, venue: '', doi: '', url: '', volume: '', pages: '', arxiv: '' };
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;

type Kind = { kind: 'doi'; id: string } | { kind: 'arxiv'; id: string } | { kind: 'bibtex' } | { kind: 'title'; text: string } | null;

/** What the input holds: a DOI (also as doi.org link), an arXiv id, BibTeX, or else a title. */
export function detect(raw: string): Kind {
  const s = raw.trim();
  if (!s) return null;
  if (looksLikeBibliography(s)) return { kind: 'bibtex' };
  const arxiv = ARXIV_ID.exec(s)?.[1];
  if (arxiv && !/\s/.test(s)) return { kind: 'arxiv', id: arxiv };
  const doi = DOI.exec(s)?.[1];
  if (doi && !/\s/.test(s.replace(doi, '').replace(/^doi:|^https?:\/\/(dx\.)?doi\.org\//i, ''))) return { kind: 'doi', id: doi.replace(/[.,;]+$/, '') };
  return { kind: 'title', text: s };
}

const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const isDuplicate = (works: LibraryWork[] | undefined, f: WorkEdit) =>
  !!works?.some((w) => (f.doi && w.doi && w.doi.toLowerCase() === f.doi.toLowerCase()) || (f.arxiv && w.arxiv && w.arxiv === f.arxiv) || (norm(f.title).length > 8 && norm(w.title) === norm(f.title)));

/**
 * One dialog to add to the library: a field that takes a DOI, arXiv id, BibTeX or a title, files by drop or choice
 * (handed to `onFiles`), or "by hand". Details are editable before adding; "add another" keeps the dialog open.
 */
export function AddDialog({ onClose, onFiles, initialText = '' }: { onClose: () => void; onFiles: (files: File[]) => void; initialText?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const works = useWorks().data;
  const lookupOn = !!useSettings().data?.lookupReferences;
  const [text, setText] = useState(initialText);
  const [step, setStep] = useState<'start' | 'fields'>('start');
  const [f, setF] = useState<WorkEdit>(EMPTY);
  const [fetching, setFetching] = useState(false);
  const [miss, setMiss] = useState(false);
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [bibtex, setBibtex] = useState<string | null>(null);

  const go = (value = text) => {
    const d = detect(value);
    if (!d || fetching) return;
    setMiss(false);
    if (d.kind === 'bibtex') return setBibtex(value);
    if (d.kind === 'title') {
      setF({ ...EMPTY, title: d.text });
      return setStep('fields');
    }
    const base: WorkEdit = d.kind === 'doi' ? { ...EMPTY, doi: d.id } : { ...EMPTY, arxiv: d.id };
    if (!lookupOn) {
      setF(base);
      return setStep('fields');
    }
    setFetching(true);
    void lookupWork(d.id).then((found) => {
      setFetching(false);
      setMiss(!found);
      setF({ ...base, ...(found ?? {}), arxiv: base.arxiv || (found as Partial<WorkEdit> | null)?.arxiv || '' });
      setStep('fields');
    });
  };
  const files = (list: FileList | File[] | null) => {
    const picked = list ? [...list] : [];
    if (!picked.length) return;
    onFiles(picked);
    onClose();
  };
  const yearOk = yearValid(f);
  const save = () => {
    if (busy || !yearOk || !f.title.trim()) return;
    setBusy(true);
    void createWork(qc, f).then(
      () => {
        setBusy(false);
        if (!again) return onClose();
        setText('');
        setF(EMPTY);
        setMiss(false);
        setStep('start');
      },
      () => setBusy(false),
    );
  };

  if (bibtex !== null) return <BibImportDialog text={bibtex} onClose={onClose} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.addTitle} width="max-w-xl">
      {step === 'start' ? (
        <div className="space-y-3">
          <div
            onDragOver={(e) => {
              if ([...e.dataTransfer.types].includes('Files')) {
                e.preventDefault();
                setOver(true);
              }
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const items = [...e.dataTransfer.items];
              files([...e.dataTransfer.files].filter((_, i) => !items[i]?.webkitGetAsEntry?.()?.isDirectory));
            }}
            className={clsx('grid place-items-center gap-2 rounded-md border border-dashed px-4 py-6 text-center text-[13px]', over ? 'border-accent bg-accent-soft' : 'border-line-strong text-ink-2')}
          >
            <span>{t.addDrop}</span>
            <label className="cursor-pointer font-medium text-accent hover:underline">
              {t.addChooseFiles}
              <input type="file" multiple hidden onChange={(e) => files(e.target.files)} />
            </label>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <textarea
              autoFocus
              rows={1}
              value={text}
              placeholder={t.addPlaceholder}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text/plain');
                const d = detect(pasted);
                if (d && d.kind !== 'title' && !text.trim()) {
                  e.preventDefault();
                  setText(pasted);
                  go(pasted);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  go();
                }
              }}
              className="wb-field min-w-0 flex-1 resize-none p-1.5 text-[14px] text-ink"
            />
            <Button type="submit" variant="primary" disabled={!text.trim() || fetching}>
              {fetching ? <Spinner /> : t.addGo}
            </Button>
          </form>
          <p className="text-[12px] text-ink-3">{lookupOn ? t.addOnline : t.addOffline}</p>
          <div className="flex justify-between">
            <button
              type="button"
              className="text-[13px] font-medium text-accent hover:underline"
              onClick={() => {
                setF(EMPTY);
                setStep('fields');
              }}
            >
              {t.addByHand}
            </button>
            <Button variant="ghost" onClick={onClose}>
              {t.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && save()}
        >
          {miss ? <p className="text-[12px] text-ink-3">{t.workFetchMiss}</p> : null}
          {isDuplicate(works, f) ? <p className="rounded-md bg-sunk p-2 text-[13px] text-ink-2">{t.addAlready}</p> : null}
          <WorkFormFields f={f} setF={setF} autoFocusTitle />
          <div className="flex items-center gap-2 pt-1">
            <label className="mr-auto flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" className="wb-check" checked={again} onChange={(e) => setAgain(e.target.checked)} />
              {t.addAnother}
            </label>
            <Button variant="ghost" onClick={() => setStep('start')}>
              {t.addBack}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !yearOk || !f.title.trim()}>
              {t.addSave}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
