import { useQuery, type QueryClient } from '@tanstack/react-query';
import { isCustomColor, type AnnotationColor, type AnnotationReview, type PageRect, type PdfAnnotation, type TextQuote } from '@wb/shared';
import type { CSSProperties } from 'react';
import { api, useSettings } from './api';
import { reportSaveFailed } from './saveNotice';

export const pdfAnnotationKey = (resource: string) => ['pdf-annotations', resource] as const;
export const pdfAnnotationsAllKey = ['pdf-annotations'] as const;

/** Highlights are on for materials only when both settings are. */
export function usePdfAnnotationsOn(): boolean {
  const s = useSettings().data;
  return !!s?.showMaterials && !!s.showAnnotations;
}

/** All highlights of one PDF, in one request. */
export function usePdfAnnotations(resource: string) {
  const on = usePdfAnnotationsOn();
  return useQuery({ queryKey: pdfAnnotationKey(resource), queryFn: () => api.get<PdfAnnotation[]>(`/api/resources/${encodeURIComponent(resource)}/annotations`), enabled: on, staleTime: 30_000 });
}

/** The highlights of every PDF, for the highlights page. */
export function useAllPdfAnnotations() {
  const on = usePdfAnnotationsOn();
  return useQuery({ queryKey: [...pdfAnnotationsAllKey, '*'], queryFn: () => api.get<PdfAnnotation[]>('/api/pdf-annotations'), enabled: on, staleTime: 30_000 });
}

export type NewPdfHighlight = { version: string; pageIndex: number; rects: PageRect[]; color: AnnotationColor; label?: string | null; comment?: string; review?: AnnotationReview | null } & TextQuote;
export type PdfHighlightPatch = Partial<Pick<PdfAnnotation, 'color' | 'label' | 'comment' | 'review'>>;

const setList = (qc: QueryClient, resource: string, f: (list: PdfAnnotation[]) => PdfAnnotation[]) => qc.setQueryData<PdfAnnotation[]>(pdfAnnotationKey(resource), (l) => f(l ?? []));
const refresh = (qc: QueryClient, resource: string) => {
  void qc.invalidateQueries({ queryKey: pdfAnnotationKey(resource) });
  void qc.invalidateQueries({ queryKey: [...pdfAnnotationsAllKey, '*'] });
};

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Highlights still on their way to the server: a change to one waits for it to arrive. */
const arriving = new Map<string, Promise<unknown>>();
const arrived = (id: string) => arriving.get(id)?.catch(() => undefined);

/** Shown at once with an id made here, saved behind it; on failure it disappears again and the student is told. */
export function addPdfHighlight(qc: QueryClient, resource: string, a: NewPdfHighlight): PdfAnnotation {
  const t = Date.now();
  const body = { version: a.version, pageIndex: a.pageIndex, rects: a.rects, quote: a.quote, prefix: a.prefix, suffix: a.suffix, color: a.color, label: a.label ?? null, comment: a.comment ?? '', review: a.review ?? null, id: uuid() };
  const made: PdfAnnotation = { ...body, resource, createdAt: t, updatedAt: t };
  setList(qc, resource, (l) => [...l, made]);
  const saving = api.post<PdfAnnotation>(`/api/resources/${encodeURIComponent(resource)}/annotations`, body).then(
    () => refresh(qc, resource),
    (e: unknown) => {
      setList(qc, resource, (l) => l.filter((x) => x.id !== made.id));
      reportSaveFailed();
      throw e;
    },
  );
  arriving.set(made.id, saving);
  void saving.finally(() => arriving.delete(made.id)).catch(() => undefined);
  return made;
}

export async function updatePdfHighlight(qc: QueryClient, resource: string, id: string, patch: PdfHighlightPatch): Promise<void> {
  setList(qc, resource, (l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  try {
    await arrived(id);
    await api.patch<PdfAnnotation>(`/api/pdf-annotations/${encodeURIComponent(id)}`, patch);
  } catch (e) {
    refresh(qc, resource);
    reportSaveFailed();
    throw e;
  }
}

export async function deletePdfHighlight(qc: QueryClient, resource: string, id: string): Promise<void> {
  setList(qc, resource, (l) => l.filter((a) => a.id !== id));
  await arrived(id);
  await api.delete(`/api/pdf-annotations/${encodeURIComponent(id)}`).then(
    () => refresh(qc, resource),
    () => {
      refresh(qc, resource);
      reportSaveFailed();
    },
  );
}

/** The page's own fill: pale, the same in both themes, because a PDF page is white in both. */
export function markStyle(color: AnnotationColor): { 'data-color': string; style?: CSSProperties } {
  return isCustomColor(color) ? { 'data-color': 'custom', style: { background: `color-mix(in srgb, ${color} 55%, white)` } } : { 'data-color': color };
}

/** Makes the viewer open at a highlight: it reads where it was from here (see `PdfPage`). */
export function rememberPdfPosition(a: Pick<PdfAnnotation, 'resource' | 'pageIndex' | 'rects'>): void {
  const key = `wb-pdf-view-${a.resource}`;
  try {
    const prev = JSON.parse(localStorage.getItem(key) ?? '{}') as object;
    const top = a.rects.length ? Math.min(...a.rects.map((r) => r.y)) : 0;
    localStorage.setItem(key, JSON.stringify({ ...prev, page: a.pageIndex + 1, offset: top }));
  } catch {
    /* it then opens where it was */
  }
}
