import { rectsTop, type PdfAnnotation, type PdfPageItem, type Resource } from '@wb/shared';
import { FileText, StickyNote } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { pdfRefText, useAllPdfAnnotations } from '@/lib/pdfAnnotations';
import { pageHasContent, pdfPageRefText, useAllPdfPages } from '@/lib/pdfPages';
import { registerPdfRefPicker, type InsertText } from '@/lib/pdfRefPicker';
import { useResources } from '@/lib/resources';
import { swatchProps } from '@/lib/annotations';
import { Dialog } from './ui';

/** Mounted once by the app: waits for an editor to ask, and only then loads the materials. */
export function PdfRefPicker() {
  const [insert, setInsert] = useState<{ fn: InsertText } | null>(null);
  const on = !!useSettings().data?.showMaterials;
  useEffect(() => {
    if (!on) return;
    registerPdfRefPicker((fn) => setInsert({ fn }));
    return () => registerPdfRefPicker(null);
  }, [on]);
  return insert ? <PickerDialog onPick={(text) => { insert.fn(text); setInsert(null); }} onClose={() => setInsert(null)} /> : null;
}

type Row = { key: string; resource: Resource; highlight?: PdfAnnotation; page?: PdfPageItem };
const MAX_ROWS = 60;

function PickerDialog({ onPick, onClose }: { onPick: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const resources = useResources(null).data?.resources;
  const highlights = useAllPdfAnnotations().data;
  const pageItems = useAllPdfPages().data;
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byResource = new Map<string, PdfAnnotation[]>();
    for (const h of highlights ?? []) (byResource.get(h.resource) ?? byResource.set(h.resource, []).get(h.resource)!).push(h);
    const pagesOf = new Map<string, PdfPageItem[]>();
    for (const p of pageItems ?? []) if (pageHasContent(p)) (pagesOf.get(p.resource) ?? pagesOf.set(p.resource, []).get(p.resource)!).push(p);
    const out: Row[] = [];
    for (const r of resources ?? []) {
      const own = !q || `${r.title} ${r.author}`.toLowerCase().includes(q);
      const hs = (byResource.get(r.id) ?? []).filter((h) => own || `${h.quote} ${h.comment}`.toLowerCase().includes(q)).sort((a, b) => a.pageIndex - b.pageIndex || rectsTop(a.rects) - rectsTop(b.rects));
      const ps = (pagesOf.get(r.id) ?? []).filter((p) => own || `${p.note} ${t.pdfPageN(p.pageIndex + 1)}`.toLowerCase().includes(q));
      if (!own && !hs.length && !ps.length) continue;
      // Searching for a passage lists the passages; the file itself is there while its title matches.
      if (own) out.push({ key: r.id, resource: r });
      // Pages and highlights in the order of the file.
      const inOrder = [...hs.map((h) => ({ at: h.pageIndex + rectsTop(h.rects) / 2, row: { key: h.id, resource: r, highlight: h } as Row })), ...ps.map((p) => ({ at: p.pageIndex, row: { key: p.id, resource: r, page: p } as Row }))].sort((a, b) => a.at - b.at);
      for (const x of inOrder) out.push(x.row);
    }
    return out.slice(0, MAX_ROWS);
  }, [resources, highlights, pageItems, query, t]);

  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const choose = (row: Row | undefined) => row && onPick(row.page ? pdfPageRefText(row.resource.id, row.page, firstWords(row.page, t.pdfPageN(row.page.pageIndex + 1))) : pdfRefText(row.resource.id, row.highlight));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.pdfRefTitle} description={t.pdfRefHint} width="max-w-xl">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.pdfRefSearch}
        aria-label={t.pdfRefSearch}
        role="combobox"
        aria-expanded
        aria-controls="wb-pdfref-list"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setAt((i) => Math.min(rows.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setAt((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter') choose(rows[at]);
          else return;
          e.preventDefault();
        }}
        className="block h-9 w-full wb-field px-2.5 text-sm"
      />
      <ul id="wb-pdfref-list" ref={list} role="listbox" className="mt-3 max-h-[46vh] overflow-y-auto">
        {rows.map((row, i) => (
          <li key={row.key} role="option" aria-selected={i === at}>
            <button
              type="button"
              tabIndex={-1}
              onMouseMove={() => setAt(i)}
              onClick={() => choose(row)}
              className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === at ? 'bg-sunk' : ''} ${row.highlight || row.page ? 'pl-7' : ''}`}
            >
              {row.page ? (
                <>
                  <StickyNote size={14} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="text-[12px] text-ink-3">
                      {t.pdfPageN(row.page.pageIndex + 1)} · {t.pdfRefPage}
                    </span>
                    <span className="line-clamp-2 block break-words">{row.page.note.trim() || t.pdfPageN(row.page.pageIndex + 1)}</span>
                  </span>
                </>
              ) : row.highlight ? (
                <>
                  <span {...swatchProps(row.highlight.color)} aria-hidden className="wb-ann-swatch mt-[0.2em] w-1 shrink-0 self-stretch rounded-full" />
                  <span className="min-w-0 flex-1">
                    <span className="text-[12px] text-ink-3">{t.pdfPageN(row.highlight.pageIndex + 1)}</span>
                    <span className="line-clamp-2 block break-words">{row.highlight.quote.trim()}</span>
                  </span>
                </>
              ) : (
                <>
                  <FileText size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {row.resource.title} <span className="font-normal text-ink-3">· {t.pdfRefWholeFile}</span>
                  </span>
                </>
              )}
            </button>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-2 py-3 text-[13px] text-ink-3">{t.pdfRefNone}</li> : null}
      </ul>
    </Dialog>
  );
}

/** What the reference to a page quotes if the file goes: the start of the note, else the page's number. */
const firstWords = (p: PdfPageItem, fallback: string): string => p.note.trim().split('\n')[0]?.replace(/[#*_`$]/g, '').trim() || fallback;
