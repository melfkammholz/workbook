import { useQueryClient } from '@tanstack/react-query';
import { MAX_QUOTE, type AnnotationColor, hitsRects, mergeLineRects, normalizeQuote, quoteAt, toPageRects, type PdfAnnotation, type PageRect, type Resource, type TextQuote } from '@wb/shared';
import { Check, Layers, Link2, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useSettings } from '@/lib/api';
import { addPdfHighlight, deletePdfHighlight, pdfRefText, updatePdfHighlight } from '@/lib/pdfAnnotations';
import { useT } from '@/lib/i18n';
import { isTyping } from '@/lib/keys';
import { useDebouncedCallback } from '@/lib/useDebounced';
import { MakeCardDialog } from './MakeCardDialog';
import { Floating, IconAction, LAST_COLOR, Removed, Swatches, lastColor, useSwatches } from './AnnotationLayer';

/** Copies a reference, for pasting into a card, a note or an answer; the icon says it worked. */
export function CopyTextButton({ text, size = 15 }: { text: () => string | Promise<string>; size?: number }) {
  const t = useT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <IconAction
      onClick={() => {
        void Promise.resolve(text())
          .then((v) => navigator.clipboard?.writeText(v))
          .then(() => setDone(true));
      }}
      label={done ? t.pdfRefCopied : t.pdfCopyRef}
    >
      {done ? <Check size={size} className="text-done" /> : <Link2 size={size} />}
    </IconAction>
  );
}

/** The reference to a highlight. */
export function CopyRefButton({ resource, a, size = 15 }: { resource: string; a: Pick<PdfAnnotation, 'id' | 'quote'>; size?: number }) {
  return <CopyTextButton text={() => pdfRefText(resource, a)} size={size} />;
}

export interface Editing {
  id: string;
  focus: boolean;
}

type Pop =
  | { kind: 'new'; page: number; rects: PageRect[]; quote: TextQuote; range: Range }
  | { kind: 'notice'; text: string; range: Range }
  | { kind: 'removed'; ann: PdfAnnotation; rects: DOMRect[] };

/** Rectangles taller than this share of the page are the text layer's own wrappers, not lines of text. */
const MAX_LINE = 0.08;

const pageOf = (n: Node | null): HTMLElement | null => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-page]') ?? null;

/** The selected passage as the browser shows it on one page: line rectangles (fractions of the page) and the quote. */
export function readSelection(range: Range): { page: number; rects: PageRect[]; quote: TextQuote } | 'crossed' | null {
  const el = pageOf(range.startContainer);
  if (!el || el !== pageOf(range.endContainer)) return el || pageOf(range.endContainer) ? 'crossed' : null;
  const layer = el.querySelector('.textLayer');
  if (!layer?.contains(range.commonAncestorContainer)) return null;
  const box = el.getBoundingClientRect();
  const rects = mergeLineRects(toPageRects([...range.getClientRects()], box).filter((r) => r.h < MAX_LINE));
  const quote = normalizeQuote(range.toString()).trim();
  if (!rects.length || !quote) return null;
  const text = normalizeQuote(layer.textContent ?? '');
  const at = text.indexOf(quote);
  const anchored = at >= 0 ? quoteAt(text, at, at + quote.length) : null;
  return { page: Number(el.dataset.page) - 1, rects, quote: anchored ?? { quote, prefix: '', suffix: '' } };
}

/**
 * Making and editing highlights on the pages of the viewer: selecting text offers the colours (and `c`, `r`), a click on
 * a highlight opens it (`d` removes it, with undo). The highlights are painted by the pages themselves.
 */
export function PdfHighlightLayer({ resource, scroller, list, editing, setEditing }: { resource: Resource; scroller: RefObject<HTMLElement | null>; list: PdfAnnotation[]; editing: Editing | null; setEditing: (e: Editing | null) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [pop, setPop] = useState<Pop | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const swatches = useSwatches();
  const cards = !!useSettings().data?.showFlashcards;
  const [card, setCard] = useState<string | null>(null);
  const listRef = useRef(list);
  listRef.current = list;

  const close = useCallback(() => {
    setPop(null);
    setEditing(null);
  }, [setEditing]);

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const inPop = (e: Event) => !!popRef.current?.contains(e.target as Node);
    const onSelect = (e: Event) => {
      if (inPop(e) || !sc.contains(e.target as Node)) return;
      setTimeout(() => {
        const sel = getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const r = sel.getRangeAt(0);
        if (!sc.contains(r.commonAncestorContainer)) return;
        const read = readSelection(r);
        if (!read) return;
        if (read === 'crossed') return setPop({ kind: 'notice', text: t.pdfAnnOnePage, range: r.cloneRange() });
        if (read.quote.quote.length > MAX_QUOTE) return setPop({ kind: 'notice', text: t.annTooLong, range: r.cloneRange() });
        setEditing(null);
        setPop({ kind: 'new', ...read, range: r.cloneRange() });
      }, 0);
    };
    const onClick = (e: MouseEvent) => {
      // The side column's own buttons (jump to a highlight) open one themselves.
      if (inPop(e) || (e.target as Element).closest?.('[data-pdf-column]')) return;
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return;
      const el = pageOf(e.target as Node);
      if (!el || !sc.contains(el)) return void close();
      const box = el.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width;
      const y = (e.clientY - box.top) / box.height;
      const index = Number(el.dataset.page) - 1;
      // The last one made is on top.
      const hit = [...listRef.current].reverse().find((a) => a.pageIndex === index && hitsRects(a.rects, x, y));
      setPop(null);
      setEditing(hit ? { id: hit.id, focus: false } : null);
    };
    const onKeyUp = (e: KeyboardEvent) => e.shiftKey && onSelect(e);
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mouseup', onSelect);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mouseup', onSelect);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [scroller, t, close, setEditing]);

  // A pointer over a highlight says it can be clicked.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = pageOf(e.target as Node);
        let over = false;
        if (el) {
          const box = el.getBoundingClientRect();
          const x = (e.clientX - box.left) / box.width;
          const y = (e.clientY - box.top) / box.height;
          over = listRef.current.some((a) => a.pageIndex === Number(el.dataset.page) - 1 && hitsRects(a.rects, x, y));
        }
        sc.style.cursor = over ? 'pointer' : '';
      });
    };
    sc.addEventListener('mousemove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      sc.removeEventListener('mousemove', onMove);
      sc.style.cursor = '';
    };
  }, [scroller]);

  const create = (color: AnnotationColor, then?: 'comment' | 'review' | 'card', label: string | null = null) => {
    if (pop?.kind !== 'new') return;
    try {
      localStorage.setItem(LAST_COLOR, color);
    } catch {
      /* only a convenience */
    }
    getSelection()?.removeAllRanges();
    const made = addPdfHighlight(qc, resource.id, { version: resource.file.sha256, pageIndex: pop.page, rects: pop.rects, ...pop.quote, color, label, review: then === 'review' ? 'open' : null });
    setPop(null);
    if (then === 'card') {
      setEditing(null);
      setCard(pdfRefText(resource.id, made));
      return;
    }
    setEditing(then ? { id: made.id, focus: then === 'comment' } : null);
  };

  // While the colours are offered: 1 to 9 for a colour or label, c to comment, r to come back to it.
  useEffect(() => {
    if (pop?.kind !== 'new') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = '123456789'.indexOf(e.key);
      const action = i >= 0 && swatches[i] ? () => create(swatches[i]!.color, undefined, swatches[i]!.label) : e.key === 'a' && cards ? () => create(lastColor(), 'card') : e.key === 'c' ? () => create(lastColor(), 'comment') : e.key === 'r' ? () => create(lastColor(), 'review') : null;
      if (!action) return;
      e.preventDefault();
      action();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const markRects = (id: string) => [...(scroller.current?.querySelectorAll<HTMLElement>(`[data-mark="${id}"]`) ?? [])].flatMap((m) => [...m.getClientRects()]);
  const remove = async (ann: PdfAnnotation) => {
    const rects = markRects(ann.id);
    setEditing(null);
    await deletePdfHighlight(qc, resource.id, ann.id);
    setPop(rects.length ? { kind: 'removed', ann, rects } : null);
  };

  // In an open highlight, unless a text is being written: d removes it.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'd' && (e.key !== 'a' || !cards)) || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const a = listRef.current.find((x) => x.id === editing.id);
      if (!a) return;
      e.preventDefault();
      if (e.key === 'a') {
        setCard(pdfRefText(resource.id, a));
        return close();
      }
      void remove(a);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const ann = editing ? list.find((a) => a.id === editing.id) : undefined;
  const anchor = (): { rects: DOMRect[] } | null => {
    if (pop?.kind === 'removed') return { rects: pop.rects };
    if (pop) return { rects: [...pop.range.getClientRects()] };
    return ann ? { rects: markRects(ann.id) } : null;
  };
  const dialog = card ? <MakeCardDialog open onClose={() => setCard(null)} exerciseId={null} initial={{ back: card }} /> : null;
  if (!pop && !ann) return dialog;
  return (
    <>
    {dialog}
    <Floating anchor={anchor} popRef={popRef} wide={!pop && !!ann}>
      {pop?.kind === 'new' ? (
        <div className="flex items-center gap-1 p-1">
          <Swatches onPick={(s) => create(s.color, undefined, s.label)} />
          <span className="mx-0.5 h-5 w-px bg-line" />
          <IconAction onClick={() => create(lastColor(), 'comment')} label={`${t.annComment} (c)`}>
            <MessageSquare size={15} />
          </IconAction>
          <IconAction onClick={() => create(lastColor(), 'review')} label={`${t.annComeBack} (r)`}>
            <RotateCcw size={15} />
          </IconAction>
          {cards ? (
            <IconAction onClick={() => create(lastColor(), 'card')} label={`${t.annMakeCard} (a)`}>
              <Layers size={15} />
            </IconAction>
          ) : null}
        </div>
      ) : pop?.kind === 'notice' ? (
        <p className="max-w-xs px-3 py-2 text-[13px] text-ink-2">{pop.text}</p>
      ) : pop?.kind === 'removed' ? (
        <Removed
          onUndo={() => {
            const a = pop.ann;
            const back = addPdfHighlight(qc, resource.id, { version: a.version, pageIndex: a.pageIndex, rects: a.rects, quote: a.quote, prefix: a.prefix, suffix: a.suffix, color: a.color, label: a.label, comment: a.comment, review: a.review });
            setPop(null);
            setEditing({ id: back.id, focus: false });
          }}
          onGone={() => setPop(null)}
        />
      ) : ann ? (
        <EditPdfHighlight key={ann.id} ann={ann} resourceId={resource.id} focus={editing!.focus} onRemove={() => void remove(ann)} onCard={cards ? () => { setCard(pdfRefText(resource.id, ann)); close(); } : undefined} />
      ) : null}
    </Floating>
    </>
  );
}

function EditPdfHighlight({ ann, resourceId, focus, onRemove, onCard }: { ann: PdfAnnotation; resourceId: string; focus: boolean; onRemove: () => void; onCard?: (() => void) | undefined }) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(ann.comment);
  const save = useDebouncedCallback((comment: string) => void updatePdfHighlight(qc, resourceId, ann.id, { comment }), 500);
  const review = ann.review;
  const patch = (p: Parameters<typeof updatePdfHighlight>[3]) => void updatePdfHighlight(qc, resourceId, ann.id, p);
  return (
    <div className="p-2">
      <div className="flex items-center gap-1">
        <Swatches value={ann} onPick={(s) => patch({ color: s.color, label: s.label })} />
        <span className="flex-1" />
        {review === 'open' ? (
          <IconAction pressed onClick={() => patch({ review: 'resolved' })} label={`${t.annMarked}: ${t.annClearUp}`}>
            <RotateCcw size={15} />
          </IconAction>
        ) : review === 'resolved' ? (
          <IconAction onClick={() => patch({ review: 'open' })} label={`${t.annIsClearedUp}: ${t.annReopen}`}>
            <Check size={15} className="text-done" />
          </IconAction>
        ) : (
          <IconAction onClick={() => patch({ review: 'open' })} label={t.annComeBack}>
            <RotateCcw size={15} />
          </IconAction>
        )}
        <CopyRefButton resource={resourceId} a={ann} />
        {onCard ? (
          <IconAction onClick={onCard} label={`${t.annMakeCard} (a)`}>
            <Layers size={15} />
          </IconAction>
        ) : null}
        <button type="button" onClick={onRemove} aria-label={t.annRemove} title={`${t.annRemove} (d)`} className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-sunk hover:text-danger">
          <Trash2 size={15} />
        </button>
      </div>
      <label className="mt-1.5 block">
        <span className="sr-only">{t.annCommentLabel}</span>
        <textarea
          autoFocus={focus}
          value={draft}
          rows={draft.split('\n').length > 2 ? 5 : 3}
          maxLength={4000}
          placeholder={t.annCommentPlaceholder}
          onChange={(e) => {
            setDraft(e.target.value);
            save.call(e.target.value);
          }}
          onBlur={() => save.flush()}
          className="block w-full resize-y wb-field px-2.5 py-1.5 text-[14px] leading-snug placeholder:text-ink-3"
        />
      </label>
    </div>
  );
}
