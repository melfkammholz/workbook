import { useQuery, type QueryClient } from '@tanstack/react-query';
import { entryAt, type ImportChoice, linesOf, parseBibliography, textItems, type BibEntry, type BibEntryInput, type LibraryWork, type PageLines, type Work } from '@wb/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect } from 'react';
import { api, useSettings } from './api';
import { linksOf, resolveDest } from './pdfLinks';
import { reportSaveFailed } from './saveNotice';

export const bibliographyKey = (resource: string) => ['pdf-bibliography', resource] as const;

/** The reference entries of one PDF with their works. */
export function useBibliography(resource: string) {
  const on = !!useSettings().data?.showMaterials;
  return useQuery({ queryKey: bibliographyKey(resource), queryFn: () => api.get<BibEntry[]>(`/api/resources/${encodeURIComponent(resource)}/bibliography`), enabled: on, staleTime: 30_000 });
}

/** How many pages from the end are searched for the references (a bibliography is at the end; the pages before it are not read). */
const TAIL = 60;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Reads the bibliography of an open PDF: the references section from the text, and where the PDF cites each entry from
 * its links (a link whose target is inside the section). Empty when the file has no references section.
 */
export async function readBibliography(doc: PDFDocumentProxy, isLive: () => boolean = () => true): Promise<BibEntryInput[]> {
  const from = Math.max(0, doc.numPages - TAIL);
  const tail: PageLines[] = [];
  for (let n = from + 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    tail.push(linesOf(textItems((await page.getTextContent()).items, page.getViewport({ scale: 1 }))));
    if (!isLive()) return [];
  }
  const parsed = parseBibliography(tail).map((e) => ({ ...e, pageIndex: e.pageIndex + from }));
  if (parsed.length < 2) return [];
  const out: BibEntryInput[] = parsed.map((e) => ({ text: e.text, pageIndex: e.pageIndex, y: e.y, citedAt: [] }));
  const first = parsed[0]!.pageIndex;
  const seen = new Set<string>();
  for (let n = 1; n <= first; n++) {
    await tick();
    if (!isLive()) return [];
    const page = await doc.getPage(n);
    for (const l of await linksOf(page)) {
      if (!l.dest) continue;
      const target = await resolveDest(doc, l.dest);
      if (!target) continue;
      const i = entryAt(parsed, target.page - 1, target.y);
      if (i < 0) continue;
      const key = `${i}:${n}:${Math.round(l.y * 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out[i]!.citedAt.push({ pageIndex: n - 1, y: l.y });
    }
  }
  return out;
}

const checkedKey = (sha: string) => `wb-bib-checked-${sha}`;
function checked(sha: string): boolean {
  try {
    return localStorage.getItem(checkedKey(sha)) === '1';
  } catch {
    return false;
  }
}
function markChecked(sha: string): void {
  try {
    localStorage.setItem(checkedKey(sha), '1');
  } catch {
    /* it is just read again next time */
  }
}

const queues = new Map<string, Promise<unknown>>();
/** Saves go out one after the other per PDF, so the last change stays. */
function enqueue<T>(resource: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(resource) ?? Promise.resolve()).catch(() => undefined).then(job);
  queues.set(resource, run);
  void run.then(
    () => queues.get(resource) === run && queues.delete(resource),
    () => queues.get(resource) === run && queues.delete(resource),
  );
  return run;
}

/** Stores a list of entries (read, or fixed by the student) and shows the stored result. */
export function saveBibliography(qc: QueryClient, resource: string, version: string, entries: BibEntryInput[]): Promise<BibEntry[]> {
  return enqueue(resource, () => api.put<BibEntry[]>(`/api/resources/${encodeURIComponent(resource)}/bibliography`, { version, entries })).then(
    (list) => {
      qc.setQueryData(bibliographyKey(resource), list);
      return list;
    },
    (e: unknown) => {
      void qc.invalidateQueries({ queryKey: bibliographyKey(resource) });
      reportSaveFailed();
      throw e;
    },
  );
}

const input = (e: BibEntry): BibEntryInput => ({ id: e.id, text: e.text, pageIndex: e.pageIndex, y: e.y, citedAt: e.citedAt });

/** The entries after a change by the student: new text, joined with the one before, or split at a character. */
export type Fix = { kind: 'text'; text: string } | { kind: 'join' } | { kind: 'split'; at: number };

export function fixEntry(qc: QueryClient, resource: string, version: string, list: BibEntry[], index: number, fix: Fix): Promise<BibEntry[]> | null {
  const next = list.map(input);
  const e = list[index]!;
  if (fix.kind === 'text') {
    if (!fix.text.trim()) return null;
    next[index] = { ...next[index]!, text: fix.text };
  } else if (fix.kind === 'join') {
    if (index === 0) return null;
    const prev = next[index - 1]!;
    next[index - 1] = { ...prev, text: `${prev.text} ${e.text}`, citedAt: [...prev.citedAt, ...e.citedAt] };
    next.splice(index, 1);
  } else {
    const a = e.text.slice(0, fix.at).trim();
    const b = e.text.slice(fix.at).trim();
    if (!a || !b) return null;
    next[index] = { ...next[index]!, text: a };
    next.splice(index + 1, 0, { text: b, pageIndex: e.pageIndex, y: Math.min(1, e.y + 0.001), citedAt: [] });
  }
  return saveBibliography(qc, resource, version, next);
}

export const worksKey = ['works'] as const;

/** Every work of the student's library (the References tab of the materials page). */
export function useWorks(enabled = true) {
  return useQuery({ queryKey: worksKey, queryFn: () => api.get<LibraryWork[]>('/api/works'), enabled, staleTime: 30_000 });
}

/** A change to the library: the library and every PDF's list are read again. */
function refreshWorks(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: worksKey });
  void qc.invalidateQueries({ queryKey: ['pdf-bibliography'] });
}

const done = (qc: QueryClient) => () => refreshWorks(qc);
const failed = (qc: QueryClient) => () => {
  refreshWorks(qc);
  reportSaveFailed();
};

/** "Same work": the citations of `from` go to `into`. */
export const mergeWork = (qc: QueryClient, from: string, into: string) => api.post(`/api/works/${encodeURIComponent(from)}/merge`, { into }).then(done(qc), failed(qc));
/** "Not the same": the pair is not suggested again. */
export const keepWorksSeparate = (qc: QueryClient, a: string, b: string) => api.post(`/api/works/${encodeURIComponent(a)}/separate`, { other: b }).then(done(qc), failed(qc));
/** "I have this": the work is that material, or none. */
export const linkWork = (qc: QueryClient, work: string, resource: string | null) => api.put(`/api/works/${encodeURIComponent(work)}/resource`, { resource }).then(done(qc), failed(qc));

export function setWantToRead(qc: QueryClient, resource: string, work: Work, want: boolean): void {
  if (resource) qc.setQueryData<BibEntry[]>(bibliographyKey(resource), (list) => list?.map((e) => (e.work.id === work.id ? { ...e, work: { ...e.work, wantToRead: want } } : e)));
  else qc.setQueryData<LibraryWork[]>(worksKey, (list) => list?.map((w) => (w.id === work.id ? { ...w, wantToRead: want } : w)));
  void api.put(`/api/works/${encodeURIComponent(work.id)}/want`, { want }).then(() => void qc.invalidateQueries({ queryKey: worksKey })).catch(() => {
    void qc.invalidateQueries({ queryKey: resource ? bibliographyKey(resource) : worksKey });
    reportSaveFailed();
  });
}

/** The student's tags on a work of the library, shown at once. */
export function setWorkTags(qc: QueryClient, work: string, tags: string[]): void {
  qc.setQueryData<LibraryWork[]>(worksKey, (list) => list?.map((w) => (w.id === work ? { ...w, tags } : w)));
  void api.put(`/api/tags/on/work/${encodeURIComponent(work)}`, { ids: tags }).catch(() => {
    void qc.invalidateQueries({ queryKey: worksKey });
    reportSaveFailed();
  });
}

/**
 * Reads the bibliography once per file, in the background after the viewer is up: when nothing is stored for this
 * version of the file (and it was not read before without result). Returns nothing; the list is the query's.
 */
export function useBibliographyReader(qc: QueryClient, resource: string, version: string, doc: PDFDocumentProxy | null, stored: BibEntry[] | undefined): void {
  const fresh = stored !== undefined && (stored.length === 0 ? checked(version) : stored.every((e) => e.version === version));
  useEffect(() => {
    if (!doc || stored === undefined || fresh) return;
    let live = true;
    // Behind everything the viewer does first.
    const timer = setTimeout(() => {
      void readBibliography(doc, () => live).then(
        async (entries) => {
          if (!live) return;
          markChecked(version);
          if (entries.length || stored.length) await saveBibliography(qc, resource, version, entries);
        },
        () => undefined,
      );
    }, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [doc, stored, fresh, qc, resource, version]);
}

/** Reads it again now, whatever is stored: the entries keep their works when their text is the same. */
export async function rereadBibliography(qc: QueryClient, resource: string, version: string, doc: PDFDocumentProxy): Promise<BibEntry[]> {
  const entries = await readBibliography(doc);
  markChecked(version);
  return saveBibliography(qc, resource, version, entries);
}

/** Adds the works the student chose from a pasted or uploaded BibTeX/Hayagriva text. */
export function importWorks(qc: QueryClient, works: ImportChoice[]): Promise<{ added: number; merged: number }> {
  return api.post<{ added: number; merged: number }>('/api/works/import', { works }).then(
    (r) => {
      refreshWorks(qc);
      return r;
    },
    (e: unknown) => {
      reportSaveFailed();
      throw e;
    },
  );
}
