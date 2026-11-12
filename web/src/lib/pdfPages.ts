import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { AnnotationReview, PdfPageItem } from '@wb/shared';
import { api, useSettings } from './api';
import { reportSaveFailed } from './saveNotice';
import { typstString } from './pdfAnnotations';

export const pdfPagesKey = (resource: string) => ['pdf-pages', resource] as const;
const allKey = ['pdf-pages', '*'] as const;

/** All page items of one PDF, in one request, with the viewer. */
export function usePdfPages(resource: string) {
  const on = !!useSettings().data?.showMaterials;
  return useQuery({ queryKey: pdfPagesKey(resource), queryFn: () => api.get<PdfPageItem[]>(`/api/resources/${encodeURIComponent(resource)}/pages`), enabled: on, staleTime: 30_000 });
}

/** The page items of every PDF, for the picker of references. */
export function useAllPdfPages() {
  const on = !!useSettings().data?.showMaterials;
  return useQuery({ queryKey: allKey, queryFn: () => api.get<PdfPageItem[]>('/api/pdf-pages'), enabled: on, staleTime: 30_000 });
}

export interface PagePatch {
  note?: string;
  marks?: string[];
  review?: AnnotationReview | null;
}
export interface PageBase {
  version: string;
  fingerprint: string;
}

/** Saves of one page go out one after the other, so the last change is the one that stays. */
const queue = new Map<string, Promise<unknown>>();

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Makes the item of a page (0-based) or changes it. Shown at once, with an id made here, saved behind it; on failure
 * the list is read again and the student is told. Returns the item as it is now, so a reference can use its id.
 */
export function savePdfPage(qc: QueryClient, resource: string, pageIndex: number, base: PageBase, patch: PagePatch): PdfPageItem {
  const key = pdfPagesKey(resource);
  const list = qc.getQueryData<PdfPageItem[]>(key) ?? [];
  const prev = list.find((p) => p.pageIndex === pageIndex);
  const t = Date.now();
  const next: PdfPageItem = prev
    ? { ...prev, ...patch, updatedAt: t }
    : { id: uuid(), resource, version: base.version, pageIndex, fingerprint: base.fingerprint, note: '', marks: [], review: null, createdAt: t, updatedAt: t, ...patch };
  qc.setQueryData<PdfPageItem[]>(key, [...list.filter((p) => p.pageIndex !== pageIndex), next].sort((a, b) => a.pageIndex - b.pageIndex));
  const slot = `${resource}/${pageIndex}`;
  const run = (queue.get(slot) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => api.put(`/api/resources/${encodeURIComponent(resource)}/pages/${pageIndex}`, { id: next.id, version: base.version, fingerprint: base.fingerprint, ...patch }))
    .then(
      () => void qc.invalidateQueries({ queryKey: allKey }),
      () => {
        void qc.invalidateQueries({ queryKey: key });
        reportSaveFailed();
      },
    );
  queue.set(slot, run);
  void run.finally(() => queue.get(slot) === run && queue.delete(slot));
  return next;
}

/** The reference to a page as the student writes it in Typst; `quote` (the page's first words) stays if the file goes. */
export const pdfPageRefText = (resource: string, page: Pick<PdfPageItem, 'id'>, quote: string): string => `#pdf-ref(${typstString(resource)}, ${typstString(page.id)}, quote: ${typstString(quote)})`;

/** Whether the item holds anything the student wrote or decided. */
export const pageHasContent = (p: PdfPageItem): boolean => !!p.note.trim() || p.marks.length > 0 || p.review !== null;
