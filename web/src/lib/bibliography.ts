import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { entryAt, type Destination, type ImportChoice, linesOf, parseBibliography, textItems, type BibEntry, type BibEntryInput, type LibraryWork, type PageLines, type Work, type WorkEdit, type WorkFields, type WorkState } from '@wb/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect } from 'react';
import { api, useSettings } from './api';
import { linksOf, resolveDest, type Target } from './pdfLinks';
import { reportSaveFailed } from './saveNotice';

export const bibliographyKey = (resource: string) => ['pdf-bibliography', resource] as const;

/** The reference entries of one PDF with their works. */
export function useBibliography(resource: string) {
  const on = !!useSettings().data?.showMaterials;
  return useQuery({ queryKey: bibliographyKey(resource), queryFn: () => api.get<BibEntry[]>(`/api/resources/${encodeURIComponent(resource)}/bibliography`), enabled: on, staleTime: 30_000 });
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

/** "Same work": the citations, tags and state of `from` go to `into`; `keep` is the material that stays its file. */
export const mergeWork = (qc: QueryClient, from: string, into: string, keep?: string | null) =>
  api.post(`/api/works/${encodeURIComponent(from)}/merge`, { into, ...(keep !== undefined ? { keep } : {}) }).then(
    (r) => {
      void qc.invalidateQueries({ queryKey: ['resources'] });
      done(qc)();
      return r;
    },
    failed(qc),
  );
/** "Not the same": the pair is not suggested again. */
export const keepWorksSeparate = (qc: QueryClient, a: string, b: string) => api.post(`/api/works/${encodeURIComponent(a)}/separate`, { other: b }).then(done(qc), failed(qc));
/** "I have this": the work is that material, or none. */
export const linkWork = (qc: QueryClient, work: string, resource: string | null) => api.put(`/api/works/${encodeURIComponent(work)}/resource`, { resource }).then(done(qc), failed(qc));

/** Sorts a work (null: back to Unsorted); the library and every PDF's list show it at once. */
export function setWorkState(qc: QueryClient, work: string, state: WorkState | null): void {
  qc.setQueriesData<BibEntry[]>({ queryKey: ['pdf-bibliography'] }, (list) => list?.map((e) => (e.work.id === work ? { ...e, work: { ...e.work, state } } : e)));
  qc.setQueryData<LibraryWork[]>(worksKey, (list) => list?.map((w) => (w.id === work ? { ...w, state } : w)));
  void api.put(`/api/works/${encodeURIComponent(work)}/state`, { state }).catch(() => {
    refreshWorks(qc);
    reportSaveFailed();
  });
}

/** Removes a work for good (it is not brought back by re-reading a PDF). */
export const removeWork = (qc: QueryClient, work: string) => api.delete(`/api/works/${encodeURIComponent(work)}`).then(done(qc), (e: unknown) => {
  failed(qc)();
  throw e;
});

/** The student's edit of a work's fields (the work is locked from then on). */
export function editWork(qc: QueryClient, work: string, fields: WorkEdit): Promise<Work> {
  return api.patch<Work>(`/api/works/${encodeURIComponent(work)}`, fields).then(
    (w) => {
      refreshWorks(qc);
      return w;
    },
    (e: unknown) => {
      reportSaveFailed();
      throw e;
    },
  );
}

/** A work the student adds by hand. */
export function createWork(qc: QueryClient, fields: WorkEdit): Promise<Work> {
  return api.post<Work>('/api/works', fields).then(
    (w) => {
      refreshWorks(qc);
      return w;
    },
    (e: unknown) => {
      reportSaveFailed();
      throw e;
    },
  );
}

/** The fields Crossref has for a DOI or arXiv id; null if it knows none or cannot be reached. */
export const lookupWork = (id: string): Promise<WorkFields | null> => api.post<{ fields: WorkFields | null }>('/api/works/lookup', { id }).then((r) => r.fields, () => null);

/** The student's tags on a work of the library, shown at once. */
export function setWorkTags(qc: QueryClient, work: string, tags: string[]): void {
  qc.setQueryData<LibraryWork[]>(worksKey, (list) => list?.map((w) => (w.id === work ? { ...w, tags } : w)));
  void api.put(`/api/tags/on/work/${encodeURIComponent(work)}`, { ids: tags }).catch(() => {
    void qc.invalidateQueries({ queryKey: worksKey });
    reportSaveFailed();
  });
}

/** Adds the works the student chose from a pasted or uploaded BibTeX/Hayagriva text. */
export function importWorks(qc: QueryClient, works: ImportChoice[]): Promise<{ added: number; merged: number; addedIds: string[] }> {
  return api.post<{ added: number; merged: number; addedIds: string[] }>('/api/works/import', { works }).then(
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

/**
 * The works a page cites (`#cite-work`) enter the library when the page is opened (the server finds the keys in the
 * workbook's own references and reuses works it has). Answers the work of each key.
 */
export function useCitedWorks(course: string | undefined, page: { id: string; title: string; href: string } | undefined, keys: string[]) {
  const qc = useQueryClient();
  const list = [...new Set(keys)].sort();
  return useQuery({
    queryKey: ['cited-works', course, page?.id, list.join('\n')],
    enabled: !!course && !!page && list.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const ids = await api.post<Record<string, string>>('/api/works/cited', { page: page!.id, title: page!.title, href: page!.href, keys: list });
      void qc.invalidateQueries({ queryKey: worksKey });
      return ids;
    },
  });
}

/** State and tags for works just made (waits for the server, then the library is read again). */
export async function sortNewWorks(qc: QueryClient, ids: string[], state: WorkState | null, tags: string[]): Promise<void> {
  try {
    await Promise.all(
      ids.flatMap((id) => [
        ...(state ? [api.put(`/api/works/${encodeURIComponent(id)}/state`, { state })] : []),
        ...(tags.length ? [api.put(`/api/tags/on/work/${encodeURIComponent(id)}`, { ids: tags })] : []),
      ]),
    );
  } catch (e) {
    reportSaveFailed();
    throw e;
  } finally {
    refreshWorks(qc);
  }
}
