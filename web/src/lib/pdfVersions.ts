import { useQuery, type QueryClient } from '@tanstack/react-query';
import { pageText, reanchor, textItems, type PageText, type PageRect, type Resource, type StaleItems, type UnplacedItems } from '@wb/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ApiError, api } from './api';
import { fileUrl, refreshResources } from './resources';
import { forgetPdf, openPdf } from './pdf';

const base = (id: string) => `/api/resources/${encodeURIComponent(id)}`;

/** Sends a new file for a resource; the old one is replaced at once, the items are placed afterwards (`placeStale`). */
export async function uploadVersion(id: string, file: File): Promise<Resource> {
  const res = await fetch(`${base(id)}/version?${new URLSearchParams({ filename: file.name })}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  forgetPdf(id);
  return (await res.json()) as Resource;
}

/** Every page's text and boxes, read with pdf.js. */
export async function readPages(doc: PDFDocumentProxy): Promise<PageText[]> {
  const out: PageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const page = await doc.getPage(n);
      out.push(pageText(textItems((await page.getTextContent()).items, page.getViewport({ scale: 1 }))));
    } catch {
      out.push(pageText([]));
    }
  }
  return out;
}

const running = new Map<string, Promise<void>>();

/**
 * Places the highlights and page items that were made on an older file on the current one, then tells the server. Runs
 * once at a time per resource; `doc` is the open file if the caller has it.
 */
export function placeStale(qc: QueryClient, resource: Resource, doc?: PDFDocumentProxy): Promise<void> {
  const prev = running.get(resource.id);
  if (prev) return prev;
  const job = (async () => {
    const stale = await api.get<StaleItems>(`${base(resource.id)}/stale`);
    if (stale.highlights.length + stale.pages.length + stale.toc.length + stale.questions.length > 0) {
      const own = doc ? null : await openPdf(fileUrl(resource));
      try {
        const pages = await readPages(doc ?? own!);
        await api.post(`${base(resource.id)}/reanchor`, reanchor(stale, pages));
      } finally {
        void own?.loadingTask.destroy();
      }
    }
    for (const key of ['pdf-annotations', 'pdf-pages', 'pdf-toc', 'pdf-unplaced', 'questions']) void qc.invalidateQueries({ queryKey: [key] });
    await refreshResources(qc);
  })().finally(() => running.delete(resource.id));
  running.set(resource.id, job);
  return job;
}

export const unplacedKey = (resource: string) => ['pdf-unplaced', resource] as const;

/** What the new file could not place; empty most of the time. */
export const useUnplaced = (resource: string, enabled: boolean) =>
  useQuery({ queryKey: unplacedKey(resource), queryFn: () => api.get<UnplacedItems>(`${base(resource)}/unplaced`), enabled, staleTime: 30_000 });

export type UnplacedKind = 'highlight' | 'page' | 'toc' | 'question';

/** Puts an item on a page of the current file (a highlight with its rectangles). Resolves false if the page has a note already. */
export async function placeUnplaced(qc: QueryClient, resource: string, kind: UnplacedKind, item: string, where: { pageIndex: number; rects?: PageRect[]; fingerprint?: string }): Promise<boolean> {
  try {
    qc.setQueryData(unplacedKey(resource), await api.put<UnplacedItems>(`${base(resource)}/unplaced/${kind}/${encodeURIComponent(item)}`, where));
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return false;
    throw e;
  }
  for (const key of ['pdf-annotations', 'pdf-pages', 'pdf-toc', 'questions']) void qc.invalidateQueries({ queryKey: [key] });
  await refreshResources(qc);
  return true;
}

export async function dropUnplaced(qc: QueryClient, resource: string, kind: UnplacedKind, item: string): Promise<void> {
  qc.setQueryData(unplacedKey(resource), await api.delete<UnplacedItems>(`${base(resource)}/unplaced/${kind}/${encodeURIComponent(item)}`));
  void qc.invalidateQueries({ queryKey: ['questions'] });
  await refreshResources(qc);
}
