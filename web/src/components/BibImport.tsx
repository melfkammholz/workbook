import type { ImportCandidate, ImportChoice, ImportPreview } from '@wb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { importWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { isTyping } from '@/lib/keys';
import { Button, Dialog, Spinner } from './ui';

/** Looks like BibTeX (an `@type{` entry) or Hayagriva (a key with type/title/author under it). */
export function looksLikeBibliography(text: string): boolean {
  return /(^|\n)\s*@[A-Za-z]+\s*[{(]/.test(text) || /^[\w.:-]+:[ \t]*\n[ \t]+(?:type|title|author):/m.test(text);
}

/**
 * Pasting BibTeX or Hayagriva (Ctrl+V outside a text field) or choosing a file opens a preview of the works in it.
 * The clipboard is only read by the paste event, never asked for. Put `node` into the page.
 */
export function useBibImport(): { node: ReactNode; pickFile: () => void } {
  const [text, setText] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[role=dialog]')) return;
      const pasted = e.clipboardData?.getData('text/plain') ?? '';
      if (!looksLikeBibliography(pasted)) return;
      e.preventDefault();
      setText(pasted);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  const node = (
    <>
      <input
        ref={input}
        type="file"
        accept=".bib,.bibtex,.yml,.yaml,.txt,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && f.size < 3_000_000) void f.text().then(setText);
        }}
      />
      {text !== null ? <BibImportDialog text={text} onClose={() => setText(null)} /> : null}
    </>
  );
  return { node, pickFile: () => input.current?.click() };
}

type Pick = 'add' | 'skip' | string;

function BibImportDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.post<ImportPreview>('/api/works/import/preview', { text }).then(
      (p) => {
        if (!live) return;
        setPreview(p);
        // A work that looks like one in the library fills that one by default; the student can add it anyway.
        setPicks(p.items.map((i) => (i.similar[0] ? `into:${i.similar[0].id}` : 'add')));
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [text]);
  const chosen = picks.filter((p) => p !== 'skip').length;
  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    const works: ImportChoice[] = [];
    preview.items.forEach((i, n) => {
      const p = picks[n];
      if (p === 'skip' || !p) return;
      works.push({ title: i.title, authors: i.authors, year: i.year, venue: i.venue, doi: i.doi, url: i.url, raw: i.raw, into: p.startsWith('into:') ? p.slice(5) : null });
    });
    try {
      await importWorks(qc, works);
      onClose();
    } catch {
      setBusy(false);
    }
  };
  const empty = failed || (preview !== null && preview.items.length === 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.bibImportTitle} description={preview && preview.items.length ? t.bibImportIntro(preview.items.length, preview.format === 'hayagriva' ? 'Hayagriva' : 'BibTeX') : undefined} width="max-w-2xl">
      {!preview && !failed ? (
        <div className="grid place-items-center py-8">
          <Spinner />
        </div>
      ) : empty ? (
        <p className="text-ink-2">{t.bibImportNone}</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {preview!.items.map((i, n) => (
              <li key={n} className="py-2">
                <p className={`break-words text-[14px] font-medium ${picks[n] === 'skip' ? 'text-ink-3 line-through' : ''}`}>{i.title}</p>
                <p className="break-words text-[12px] text-ink-2">{[i.authors, i.year, i.venue].filter(Boolean).join(' · ')}</p>
                <Choice item={i} value={picks[n] ?? 'add'} onChange={(v) => setPicks(picks.map((p, k) => (k === n ? v : p)))} />
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button variant="primary" disabled={busy || chosen === 0} onClick={() => void confirm()}>
              {t.bibImportConfirm(chosen)}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function Choice({ item, value, onChange }: { item: ImportCandidate; value: Pick; onChange: (v: Pick) => void }) {
  const t = useT();
  return (
    <select aria-label={item.title} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 max-w-full rounded-md border border-line bg-sheet px-1.5 py-0.5 text-[12px] text-ink-2">
      <option value="add">{t.bibImportAdd}</option>
      {item.similar.map((s) => (
        <option key={s.id} value={`into:${s.id}`}>
          {t.bibImportSame(s.title || s.authors, s.year)}
        </option>
      ))}
      <option value="skip">{t.bibImportSkip}</option>
    </select>
  );
}
