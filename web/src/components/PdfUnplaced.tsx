import { useQueryClient } from '@tanstack/react-query';
import type { Resource } from '@wb/shared';
import { useState } from 'react';
import { swatchProps } from '@/lib/annotations';
import { useT } from '@/lib/i18n';
import { dropUnplaced, placeUnplaced, useUnplaced, type UnplacedKind } from '@/lib/pdfVersions';
import { FoldSection } from './FoldSection';
import { readSelection } from './PdfHighlights';
import { Button } from './ui';

/**
 * What a new version of the file had no place for: highlights are placed by selecting their passage on the page,
 * notes and contents entries on the page in view; each can be dropped. Nothing shows when everything was placed.
 */
export function PdfUnplaced({ resource, current, pageInfo }: { resource: Resource; current: number; pageInfo: (n: number) => Promise<{ fingerprint: string }> }) {
  const t = useT();
  const qc = useQueryClient();
  const data = useUnplaced(resource.id, resource.unplaced > 0).data;
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  if (resource.unplaced === 0 || !data) return null;
  const say = (id: string, text: string) => setMessage({ id, text });

  const placeHighlight = (id: string) => {
    const sel = getSelection();
    const read = sel && !sel.isCollapsed && sel.rangeCount ? readSelection(sel.getRangeAt(0)) : null;
    if (!read || read === 'crossed') return say(id, read === 'crossed' ? t.pdfAnnOnePage : t.pdfFixSelectFirst);
    sel?.removeAllRanges();
    void placeUnplaced(qc, resource.id, 'highlight', id, { pageIndex: read.page, rects: read.rects });
  };
  const placeOnPage = async (kind: UnplacedKind, id: string) => {
    const info = await pageInfo(current);
    const ok = await placeUnplaced(qc, resource.id, kind, id, { pageIndex: current - 1, fingerprint: info.fingerprint });
    if (!ok) say(id, t.pdfFixTaken);
  };
  const drop = (kind: UnplacedKind, id: string) => void dropUnplaced(qc, resource.id, kind, id);

  const row = (id: string, kind: UnplacedKind, from: number, body: React.ReactNode, place: React.ReactNode) => (
    <li key={id} className="rounded-md border border-line px-2 py-1.5">
      <div className="text-[12px] text-ink-3">{t.pdfFixKind[kind](from + 1)}</div>
      {body}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {place}
        <Button size="sm" variant="ghost" onClick={() => drop(kind, id)}>
          {t.pdfFixDrop}
        </Button>
      </div>
      {message?.id === id ? <p className="mt-1 text-[12px] text-review">{message.text}</p> : null}
    </li>
  );

  return (
    <FoldSection id="pdf-unplaced" title={`${t.pdfFixTitle} (${resource.unplaced})`} defaultOpen className="mt-5">
      <p className="mb-2 text-[13px] text-ink-2">{t.pdfFixIntro}</p>
      <ul className="space-y-1.5">
        {data.highlights.map((a) =>
          row(
            a.id,
            'highlight',
            a.pageIndex,
            <div className="flex gap-2">
              <span {...swatchProps(a.color)} aria-hidden className="wb-ann-swatch mt-[0.2em] w-1 shrink-0 self-stretch rounded-full" />
              <span className="line-clamp-3 min-w-0 break-words">{a.quote.trim()}</span>
            </div>,
            // The button must not take the selection away from the page.
            <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => placeHighlight(a.id)}>
              {t.pdfFixPlaceSelection}
            </Button>,
          ),
        )}
        {data.pages.map((p) =>
          row(p.id, 'page', p.pageIndex, <span className="line-clamp-3 whitespace-pre-wrap break-words">{p.note.trim() || '…'}</span>, (
            <Button size="sm" onClick={() => void placeOnPage('page', p.id)}>
              {t.pdfFixPlaceHere(current)}
            </Button>
          )),
        )}
        {data.questions.map((q) =>
          row(q.id, 'question', q.anchor.kind === 'page' ? q.anchor.pageIndex : 0, <span className="line-clamp-3 whitespace-pre-wrap break-words">{q.text.trim() || '…'}</span>, (
            <Button size="sm" onClick={() => void placeOnPage('question', q.id)}>
              {t.pdfFixPlaceHere(current)}
            </Button>
          )),
        )}
        {data.toc.map((e) =>
          row(e.id, 'toc', e.pageIndex, <span className="line-clamp-2 break-words">{e.title.trim() || '…'}</span>, (
            <Button size="sm" onClick={() => void placeOnPage('toc', e.id)}>
              {t.pdfFixPlaceHere(current)}
            </Button>
          )),
        )}
      </ul>
    </FoldSection>
  );
}
