import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { Highlighter, Layers, Sparkles, StickyNote } from 'lucide-react';
import { useState } from 'react';
import type { Anchor, PdfPageItem, Question } from '@wb/shared';
import { api, linkQuestion } from '@/lib/api';
import { addAnnotation, arrived as textArrived, escapeMarkup } from '@/lib/annotations';
import { useT } from '@/lib/i18n';
import { addPdfHighlight, arrived as pdfArrived } from '@/lib/pdfAnnotations';
import { pageSaved, pdfPagesKey, savePdfPage } from '@/lib/pdfPages';
import { MakeCardDialog } from './MakeCardDialog';
import { IconButton } from './ui';

const pageAnchor = (a: Anchor) => (a.kind === 'page' ? a : null);

/** The menu among a row's actions: make a card, a page note or a highlight from the question; each saves the link. */
export function QuestionMake({ item, q, size = 'sm' }: { item: string | null; q: Question; size?: 'sm' | 'md' }) {
  const t = useT();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [card, setCard] = useState(false);
  const a = q.anchor;
  const page = pageAnchor(a);
  const quote = a.kind === 'text' ? a.quote : page?.quote?.trim() || '';
  const canNote = !!page && !q.unplaced;
  const canMark = !q.highlightId && !!quote && (a.kind === 'text' || (!!page && !!page.rects?.length && !q.unplaced));
  const linked = (k: string) => q.links.some((l) => l.kind === k);

  const addNote = async () => {
    if (!page) return;
    const list = await qc.fetchQuery({ queryKey: pdfPagesKey(page.resource), queryFn: () => api.get<PdfPageItem[]>(`/api/resources/${encodeURIComponent(page.resource)}/pages`), staleTime: 30_000 });
    const prev = list.find((p) => p.pageIndex === page.pageIndex);
    const snippet = `${quote ? `#quote(block: true)[${escapeMarkup(quote)}]\n\n` : ''}${q.text ? `${escapeMarkup(q.text)}\n` : ''}${q.answer ? `\n${q.answer.trim()}\n` : ''}`;
    const note = prev?.note.trim() ? `${prev.note.trim()}\n\n${snippet}` : snippet;
    const made = savePdfPage(qc, page.resource, page.pageIndex, { version: page.version, fingerprint: page.fingerprint }, { note });
    await pageSaved(page.resource, page.pageIndex);
    await linkQuestion(item, q.id, 'note', made.id);
  };
  const mark = async () => {
    if (a.kind === 'text') {
      const made = addAnnotation(qc, { target: a.target, part: a.part, quote: a.quote, prefix: a.prefix, suffix: a.suffix, color: 'yellow' });
      await textArrived(made.id);
      await linkQuestion(item, q.id, 'highlight', made.id);
    } else if (page?.rects) {
      const made = addPdfHighlight(qc, page.resource, { version: page.version, pageIndex: page.pageIndex, rects: page.rects, quote, prefix: page.prefix ?? '', suffix: page.suffix ?? '', color: 'yellow' });
      await pdfArrived(made.id);
      await linkQuestion(item, q.id, 'highlight', made.id);
    }
  };

  const cls = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-sunk';
  const run = (f: () => Promise<void>) => () => {
    setMenu(false);
    void f().catch(() => undefined);
  };
  const dim = size === 'sm' ? 12 : 13;
  return (
    <>
      <Popover.Root open={menu} onOpenChange={setMenu}>
        <Popover.Trigger asChild>
          <IconButton label={t.questionMake} className={size === 'sm' ? 'size-5' : 'size-6'}>
            <Sparkles size={dim} />
          </IconButton>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={4} aria-label={t.questionMake} className="wb-menu w-56 p-1">
            <button type="button" className={cls} onClick={() => { setMenu(false); setCard(true); }}>
              <Layers size={14} /> {t.questionMakeCard}
            </button>
            {canNote ? (
              <button type="button" className={cls} onClick={run(addNote)}>
                <StickyNote size={14} /> {t.questionMakeNote}
              </button>
            ) : null}
            {canMark && !linked('highlight') ? (
              <button type="button" className={cls} onClick={run(mark)}>
                <Highlighter size={14} /> {t.questionMakeHighlight}
              </button>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {card ? (
        <MakeCardDialog
          open
          onClose={() => setCard(false)}
          exerciseId={a.kind === 'exercise' ? a.id : null}
          highlightId={q.highlightId}
          initial={{ kind: 'basic', front: q.text || quote, back: q.answer ?? '', anchor: a.kind === 'none' ? null : a }}
          onMade={({ cardId }) => void linkQuestion(item, q.id, 'card', cardId)}
        />
      ) : null}
    </>
  );
}
