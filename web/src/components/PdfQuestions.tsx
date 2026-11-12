import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SNIPPET_LENGTH, normalizeQuote, type Question, type Resource, type TextQuote } from '@wb/shared';
import { askQuestion, useQuestions } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { FoldSection } from './FoldSection';
import { readSelection } from './PdfHighlights';
import { CaptureField, QuestionRow } from './Questions';

/** What the viewer knows about a page when a question is written on it. */
export type PageInfo = (n: number) => Promise<{ fingerprint: string; text: string }>;

/** The questions asked on this file's pages, in reading order. Those the file could not place wait in the fix list. */
export function usePdfQuestions(resource: Resource): Question[] {
  const all = useQuestions().data;
  return useMemo(
    () =>
      (all ?? [])
        .filter((q) => q.anchor.kind === 'page' && q.anchor.resource === resource.id && !q.unplaced && q.anchor.version === resource.file.sha256)
        .sort((a, b) => pageOf(a) - pageOf(b) || a.createdAt - b.createdAt),
    [all, resource.id, resource.file.sha256],
  );
}

const pageOf = (q: Question) => (q.anchor.kind === 'page' ? q.anchor.pageIndex : 0);

/** About 200 characters of the page around the quote, or its start when there is no quote. */
export function snippetOf(text: string, quote: string | null): string {
  const flat = normalizeQuote(text).replace(/\s+/g, ' ').trim();
  const at = quote ? flat.indexOf(normalizeQuote(quote).replace(/\s+/g, ' ').trim()) : -1;
  if (at < 0) return flat.slice(0, SNIPPET_LENGTH);
  const pad = Math.max(0, Math.floor((SNIPPET_LENGTH - quote!.length) / 2));
  return flat.slice(Math.max(0, at - pad), at + quote!.length + pad).slice(0, SNIPPET_LENGTH * 2);
}

/**
 * The passage the student last selected on a page of the viewer. It is kept while the cursor is in the question line
 * (which empties the browser's own selection) and let go of on the next click on the pages.
 */
function useSelectedPassage(scroller: RefObject<HTMLElement | null>) {
  const [sel, setSel] = useState<{ page: number; quote: TextQuote } | null>(null);
  useEffect(() => {
    const onChange = () => {
      const s = getSelection();
      const box = scroller.current;
      if (!s || s.isCollapsed || !s.rangeCount || !box?.contains(s.getRangeAt(0).commonAncestorContainer)) return;
      const read = readSelection(s.getRangeAt(0));
      if (read && read !== 'crossed') setSel({ page: read.page, quote: read.quote });
    };
    const onDown = (e: MouseEvent) => {
      if (scroller.current?.contains(e.target as Node)) setSel(null);
    };
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [scroller]);
  return [sel, setSel] as const;
}

/** Pinned under the pages: one line, Enter saves it on the page in view (or the page of the selection) and the cursor stays. */
export function PdfQuestionBar({ resource, current, pageInfo, scroller, labelOf }: { resource: Resource; current: number; pageInfo: PageInfo; scroller: RefObject<HTMLElement | null>; labelOf: (n: number) => string }) {
  const t = useT();
  const [sel, setSel] = useSelectedPassage(scroller);
  const [withSel, setWithSel] = useState(true);
  const page = sel && withSel ? sel.page + 1 : current;
  const save = (text: string, carryOn: boolean) => {
    const use = sel && withSel ? sel : null;
    const n = page;
    setSel(null);
    setWithSel(true);
    void pageInfo(n).then((info) =>
      askQuestion(
        { page: { resource: resource.id, version: resource.file.sha256, pageIndex: n - 1, fingerprint: info.fingerprint, ...(use ? { ...use.quote } : {}), snippet: snippetOf(info.text, use?.quote.quote ?? null) } },
        text,
        carryOn,
      ),
    );
  };
  return (
    <div className="shrink-0 border-t border-line bg-sheet px-3 py-2">
      {sel ? (
        <p className="mb-1.5 flex items-start gap-1.5 text-[12.5px] text-ink-2">
          <span className="min-w-0 flex-1">
            <span className="text-ink-3">{withSel ? t.pdfQuestionSelection : t.pdfQuestionDropSelection}: </span>
            <span className="line-clamp-2 break-words italic">{sel.quote.quote}</span>
          </span>
          <button type="button" aria-pressed={!withSel} title={withSel ? t.pdfQuestionDropSelection : t.pdfQuestionSelection} onClick={() => setWithSel(!withSel)} className="rounded p-0.5 text-ink-3 hover:bg-sunk hover:text-ink">
            <X size={14} />
          </button>
        </p>
      ) : null}
      <div className="mx-auto max-w-2xl" title={labelOf(page)}>
        <CaptureField attr="data-pdf-question" placeholder={t.pdfQuestionPlaceholder(page)} onSave={save} />
      </div>
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
          <button type="button" onClick={() => onGo(g.page)} className={`mb-0.5 px-1.5 text-[12px] font-medium hover:underline ${g.page === current ? 'text-accent' : 'text-ink-3'}`}>
            {labelOf(g.page) !== String(g.page) ? `${t.pdfPageN(g.page)} (${labelOf(g.page)})` : t.pdfPageN(g.page)}
          </button>
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
