import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { PdfAnnotation, PdfPageItem, ResourcesResponse } from '@wb/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { keepPdf } from '@/lib/pdf';
import { pdfAnnotationKey } from '@/lib/pdfAnnotations';
import type { Target } from '@/lib/pdfLinks';
import { pdfPagesKey } from '@/lib/pdfPages';
import { fileUrl, resourceKeys } from '@/lib/resources';
import { HOVER_MS, Peek } from '@/components/PdfLinks';

/** The open PDF and the place a `#pdf-ref` (`data-pdf-ref="<resource>[/<highlight or page id>]"`) leads to. */
async function resolve(qc: QueryClient, ref: string): Promise<{ doc: PDFDocumentProxy; target: Target } | null> {
  const slash = ref.indexOf('/');
  const id = slash < 0 ? ref : ref.slice(0, slash);
  const part = slash < 0 ? null : ref.slice(slash + 1);
  const list = await qc.fetchQuery({ queryKey: resourceKeys.list(null), queryFn: () => api.get<ResourcesResponse>('/api/resources'), staleTime: 30_000 });
  const resource = list.resources.find((r) => r.id === id);
  if (!resource || !/\.pdf$/i.test(resource.file.filename)) return null;
  let target: Target = { page: 1, y: null };
  if (part) {
    const enc = encodeURIComponent(id);
    const marks = await qc.fetchQuery({ queryKey: pdfAnnotationKey(id), queryFn: () => api.get<PdfAnnotation[]>(`/api/resources/${enc}/annotations`), staleTime: 30_000 });
    const h = marks.find((a) => a.id === part);
    if (h) target = { page: h.pageIndex + 1, y: h.rects[0]?.y ?? null };
    else {
      const pages = await qc.fetchQuery({ queryKey: pdfPagesKey(id), queryFn: () => api.get<PdfPageItem[]>(`/api/resources/${enc}/pages`), staleTime: 30_000 });
      const p = pages.find((x) => x.id === part);
      if (!p) return null;
      target = { page: p.pageIndex + 1, y: null };
    }
  }
  const { doc } = await keepPdf(resource.id, resource.file.sha256, fileUrl(resource));
  return { doc, target };
}

/**
 * Hovering a `#pdf-ref` anywhere (card, answer, note) shows the passage it points at, as in the viewer's links. It
 * appears only once the picture is ready, so a slow first open of a PDF is never a visible wait.
 */
export function PdfRefPeek() {
  const qc = useQueryClient();
  const [peek, setPeek] = useState<{ doc: PDFDocumentProxy; target: Target; at: DOMRect } | null>(null);
  useEffect(() => {
    let timer = 0;
    let current: Element | null = null;
    const leave = () => {
      current = null;
      clearTimeout(timer);
      setPeek(null);
    };
    const over = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a.wb-pdf-ref:not(.wb-pdf-ref-broken)') ?? null;
      if (a === current) return;
      leave();
      if (!a) return;
      const ref = a.getAttribute('data-pdf-ref');
      if (!ref) return;
      current = a;
      timer = window.setTimeout(() => {
        void resolve(qc, ref)
          .then((r) => r && current === a && setPeek({ ...r, at: a.getBoundingClientRect() }))
          .catch(() => undefined);
      }, HOVER_MS);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('scroll', leave, true);
    document.addEventListener('mousedown', leave, true);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('scroll', leave, true);
      document.removeEventListener('mousedown', leave, true);
      clearTimeout(timer);
    };
  }, [qc]);
  return peek ? <Peek doc={peek.doc} target={peek.target} at={peek.at} /> : null;
}
