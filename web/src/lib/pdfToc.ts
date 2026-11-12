import { useQuery, type QueryClient } from '@tanstack/react-query';
import { MAX_TOC_LEVEL, type EmbeddedTocEntry, type TocEdit, type TocEditFields } from '@wb/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api, useSettings } from './api';
import { reportSaveFailed } from './saveNotice';

export const pdfTocKey = (resource: string) => ['pdf-toc', resource] as const;

/** The student's own entries and changes to the embedded outline, loaded with the viewer. */
export function usePdfToc(resource: string) {
  const on = !!useSettings().data?.showMaterials;
  return useQuery({ queryKey: pdfTocKey(resource), queryFn: () => api.get<TocEdit[]>(`/api/resources/${encodeURIComponent(resource)}/toc`), enabled: on, staleTime: 30_000 });
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Saves of the table go out one after the other per resource, so the last change stays. */
const queues = new Map<string, Promise<unknown>>();
function enqueue(qc: QueryClient, resource: string, job: () => Promise<unknown>): void {
  const run = (queues.get(resource) ?? Promise.resolve())
    .catch(() => undefined)
    .then(job)
    .catch(() => {
      void qc.invalidateQueries({ queryKey: pdfTocKey(resource) });
      reportSaveFailed();
    });
  queues.set(resource, run);
  void run.finally(() => queues.get(resource) === run && queues.delete(resource));
}

/** Makes or changes an entry (an embedded one is found by `embeddedKey`); shown at once, saved behind it. */
export function saveTocEdit(qc: QueryClient, resource: string, f: TocEditFields): TocEdit {
  const key = pdfTocKey(resource);
  const list = qc.getQueryData<TocEdit[]>(key) ?? [];
  const prev = list.find((e) => (f.embeddedKey != null ? e.embeddedKey === f.embeddedKey : e.id === f.id));
  const t = Date.now();
  const id = prev?.id ?? f.id ?? uuid();
  const next: TocEdit = prev
    ? { ...prev, title: f.title === undefined ? prev.title : f.title.trim(), level: f.level === undefined ? prev.level : f.level, hidden: f.hidden ?? prev.hidden, updatedAt: t }
    : { id, resource, version: f.version, pageIndex: f.pageIndex, fingerprint: f.fingerprint, title: (f.title ?? '').trim(), level: f.level ?? null, hidden: f.hidden ?? false, embeddedKey: f.embeddedKey ?? null, createdAt: t, updatedAt: t };
  qc.setQueryData<TocEdit[]>(key, [...list.filter((e) => e.id !== prev?.id), next]);
  enqueue(qc, resource, () => api.put(`/api/resources/${encodeURIComponent(resource)}/toc`, { ...f, id }));
  return next;
}

export function deleteTocEdit(qc: QueryClient, resource: string, id: string): void {
  const key = pdfTocKey(resource);
  qc.setQueryData<TocEdit[]>(key, (list) => (list ?? []).filter((e) => e.id !== id));
  enqueue(qc, resource, () => api.delete(`/api/resources/${encodeURIComponent(resource)}/toc/${id}`));
}

type Dest = string | unknown[] | null;
interface OutlineNode {
  title: string;
  dest: Dest;
  items?: OutlineNode[];
}

/** The outline the file carries, flat, with nesting as `level` and destinations turned into page indexes; null if it has none. */
export async function readOutline(doc: PDFDocumentProxy): Promise<EmbeddedTocEntry[] | null> {
  const tree = (await doc.getOutline().catch(() => null)) as OutlineNode[] | null;
  if (!tree?.length) return null;
  const out: EmbeddedTocEntry[] = [];
  const walk = async (nodes: OutlineNode[], depth: number): Promise<void> => {
    for (const n of nodes) {
      let page: number | null = null;
      try {
        const dest = typeof n.dest === 'string' ? await doc.getDestination(n.dest) : n.dest;
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (ref && typeof ref === 'object') page = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
        else if (typeof ref === 'number') page = ref;
      } catch {
        /* an entry that points nowhere is left out */
      }
      const title = n.title.replace(/\s+/g, ' ').trim();
      if (page !== null && title) out.push({ title, pageIndex: Math.min(Math.max(0, page), doc.numPages - 1), level: Math.min(depth, MAX_TOC_LEVEL) });
      if (n.items?.length) await walk(n.items, depth + 1);
    }
  };
  await walk(tree, 0);
  return out.length ? out : null;
}
