import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { MAX_QUOTE, SNIPPET_LENGTH, normalizeQuote, type PageRect, type Question, type Resource, type TextQuote } from '@wb/shared';
import { askQuestion, useQuestions } from '@/lib/api';
import { addPdfHighlight, usePdfAnnotationsOn } from '@/lib/pdfAnnotations';
import { setAsked } from '@/lib/pdfAsked';
import { useQueryClient } from '@tanstack/react-query';
import { lastColor } from './AnnotationLayer';
import { useT } from '@/lib/i18n';
import { FoldSection } from './FoldSection';
import { readSelection } from './PdfHighlights';
import { CaptureField, QuestionCard, QuestionRow } from './Questions';

/** What the viewer knows about a page when a question is written on it. */
export type PageInfo = (n: number) => Promise<{ fingerprint: string; text: string }>;

/** The questions asked on this file's pages, in reading order. Those the file could not place wait in the fix list. */
export function usePdfQuestions(resource: Resource): Question[] {
  const all = useQuestions().data;
  return useMemo(
    () =>
      (all ?? [])
        .filter((q) => (q.anchor.kind === 'material' && q.anchor.resource === resource.id) || (q.anchor.kind === 'page' && q.anchor.resource === resource.id && !q.unplaced && q.anchor.version === resource.file.sha256))
        .sort((a, b) => pageOf(a) - pageOf(b) || a.createdAt - b.createdAt),
    [all, resource.id, resource.file.sha256],
  );
}

/** -1: about the whole material, before the pages. */
const pageOf = (q: Question) => (q.anchor.kind === 'page' ? q.anchor.pageIndex : -1);

/** About 200 characters of the page around the quote, or its start when there is no quote. */
export function snippetOf(text: string, quote: string | null): string {
  const flat = normalizeQuote(text).replace(/\s+/g, ' ').trim();
  const at = quote ? flat.indexOf(normalizeQuote(quote).replace(/\s+/g, ' ').trim()) : -1;
  if (at < 0) return flat.slice(0, SNIPPET_LENGTH);
  const pad = Math.max(0, Math.floor((SNIPPET_LENGTH - quote!.length) / 2));
  return flat.slice(Math.max(0, at - pad), at + quote!.length + pad).slice(0, SNIPPET_LENGTH * 2);
}

/**
 * The passage the student last selected on a page of the viewer. Focusing the question line empties the browser's own
 * selection, so the passage is kept (until the next click on the pages) and painted by the highlight API meanwhile.
 */
function useSelectedPassage(scroller: RefObject<HTMLElement | null>) {
  const [sel, setSel] = useState<{ page: number; quote: TextQuote; rects: PageRect[] } | null>(null);
  const range = useRef<Range | null>(null);
  const keep = (next: { page: number; quote: TextQuote; rects: PageRect[]; range: Range } | null, paint = true) => {
    range.current = next?.range ?? null;
    setSel(next && { page: next.page, quote: next.quote, rects: next.rects });
    if (paint) paintKept(next?.range ?? null);
  };
  useEffect(() => {
    const onChange = () => {
      const s = getSelection();
      const box = scroller.current;
      if (!s || s.isCollapsed || !s.rangeCount || !box?.contains(s.getRangeAt(0).commonAncestorContainer)) {
        // The native selection is gone (the line took the focus): the kept passage stands in for it.
        paintKept(range.current);
        return;
      }
      const r = s.getRangeAt(0);
      const read = readSelection(r);
      paintKept(null); // the real selection is painted by the browser; never both
      if (read && read !== 'crossed') keep({ page: read.page, quote: read.quote, rects: read.rects, range: r.cloneRange() }, false);
    };
    const onDown = (e: MouseEvent) => {
      if (scroller.current?.contains(e.target as Node)) keep(null);
    };
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('mousedown', onDown, true);
      paintKept(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller]);
  return [sel, () => keep(null)] as const;
}

/** Paints the kept passage exactly like the browser's selection (see `::highlight(wb-q-sel)`), so it seems to stay selected. */
function paintKept(r: Range | null): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  if (r) CSS.highlights.set('wb-q-sel', new Highlight(r));
  else CSS.highlights.delete('wb-q-sel');
}

/**
 * Pinned under the pages, a card with one line: Enter saves a question about the material and the cursor stays.
 * `!p` ties it to the page in view, `!s` to the selection (and its page).
 */
export function PdfQuestionBar({ resource, current, pageInfo, scroller }: { resource: Resource; current: number; pageInfo: PageInfo; scroller: RefObject<HTMLElement | null> }) {
  const t = useT();
  const [sel, clearSel] = useSelectedPassage(scroller);
  const qc = useQueryClient();
  const canHighlight = usePdfAnnotationsOn() && resource.stale === 0;
  const questions = usePdfQuestions(resource);
  useEffect(() => {
    const byPage = new Map<number, TextQuote[]>();
    for (const q of questions) {
      if (q.status !== 'open' || q.anchor.kind !== 'page' || !q.anchor.quote) continue;
      const list = byPage.get(q.anchor.pageIndex) ?? byPage.set(q.anchor.pageIndex, []).get(q.anchor.pageIndex)!;
      list.push({ quote: q.anchor.quote, prefix: q.anchor.prefix ?? '', suffix: q.anchor.suffix ?? '' });
    }
    setAsked(byPage);
    return () => setAsked(new Map());
  }, [questions]);
  const save = (text: string, o: { continuePass: boolean; tags: string[] }) => {
    const use = o.tags.includes('s') || o.tags.includes('h') ? sel : null;
    const n = use ? use.page + 1 : current;
    // `!h`: the passage also becomes a highlight, a record of its own that is not tied to the question.
    if (use && o.tags.includes('h') && canHighlight && use.quote.quote.length <= MAX_QUOTE) {
      addPdfHighlight(qc, resource.id, { version: resource.file.sha256, pageIndex: use.page, rects: use.rects, ...use.quote, color: lastColor() });
    }
    if (use) clearSel();
    if (!use && !o.tags.includes('p')) return void askQuestion({ material: resource.id }, text, o.continuePass);
    void pageInfo(n).then((info) =>
      askQuestion(
        { page: { resource: resource.id, version: resource.file.sha256, pageIndex: n - 1, fingerprint: info.fingerprint, ...(use ? { ...use.quote } : {}), snippet: snippetOf(info.text, use?.quote.quote ?? null) } },
        text,
        o.continuePass,
      ),
    );
  };
  return (
    <div className="shrink-0 bg-sunk px-3 pb-2 pt-1">
      <QuestionCard className="mx-auto max-w-2xl">
        <CaptureField
          attr="data-pdf-question"
          placeholder={t.pdfQuestionPlaceholder}
          onSave={save}
          tags={[
            { key: 'p', hint: '', available: true },
            { key: 's', hint: '', available: !!sel },
            { key: 'h', hint: '', available: !!sel && canHighlight },
          ]}
        />
      </QuestionCard>
    </div>
  );
}

/** The paper's questions in the notes card, grouped by page in reading order; a click on the text goes to the page. */
export function PdfQuestionList({ resource, questions, current, labelOf, onGo }: { resource: Resource; questions: Question[]; current: number; labelOf: (n: number) => string; onGo: (n: number) => void }) {
  const t = useT();
  const [showDone, setShowDone] = useState(false);
  const shown = questions.filter((q) => showDone || q.status === 'open');
  const groups = useMemo(() => {
    const out: { page: number; items: Question[] }[] = [];
    for (const q of shown) {
      const n = pageOf(q) + 1;
      const last = out[out.length - 1];
      if (last && last.page === n) last.items.push(q);
      else out.push({ page: n, items: [q] });
    }
    return out;
  }, [shown]);
  const hasDone = questions.some((q) => q.status === 'done');
  const ref = useRef<HTMLElement>(null);
  return (
    <FoldSection id="pdf-questions" title={t.pdfQuestionsTitle} defaultOpen sectionRef={ref} className="mt-5">
      {groups.length === 0 ? <p className="text-[13px] text-ink-3">{t.pdfQuestionsNone}</p> : null}
      {groups.map((g) => (
        <div key={g.page} className="mb-2" data-resource={resource.id}>
          {g.page === 0 ? (
            <span className="mb-0.5 block px-1.5 text-[12px] font-medium text-ink-3">{t.pdfQuestionWhole}</span>
          ) : (
            <button type="button" onClick={() => onGo(g.page)} className={`mb-0.5 px-1.5 text-[12px] font-medium hover:underline ${g.page === current ? 'text-accent' : 'text-ink-3'}`}>
              {labelOf(g.page) !== String(g.page) ? `${t.pdfPageN(g.page)} (${labelOf(g.page)})` : t.pdfPageN(g.page)}
            </button>
          )}
          <ul className="divide-y divide-line">
            {g.items.map((q) => (
              <QuestionRow key={q.id} item={null} q={q} extra={<Quote q={q} />} />
            ))}
          </ul>
        </div>
      ))}
      {hasDone ? (
        <button type="button" onClick={() => setShowDone(!showDone)} aria-pressed={showDone} className="mt-1 text-[12.5px] text-ink-3 hover:text-ink">
          {showDone ? t.hideDoneQuestions : t.showDoneQuestions}
        </button>
      ) : null}
    </FoldSection>
  );
}

/** What the question was about: the selection, or else the start of the page's text. */
export function Quote({ q }: { q: Question }) {
  if (q.anchor.kind !== 'page') return null;
  const text = q.anchor.quote?.trim() || q.anchor.snippet?.trim();
  return text ? <p className="mt-0.5 line-clamp-2 break-words text-[12px] italic text-ink-3">{text}</p> : null;
}
