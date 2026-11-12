import { useQueryClient } from '@tanstack/react-query';
import { ANNOTATION_COLORS, MAX_QUOTE, isAnnotationColor, itemOfTarget, quoteAt, type Annotation, type AnnotationColor, type HighlightLabel, type PaletteColor, type TextQuote } from '@wb/shared';
import { Check, Layers, MessageSquare, NotebookPen, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import {
  addAnnotation,
  annotationAt,
  appendToOpenNote,
  deleteAnnotation,
  noteSnippet,
  offsetsOf,
  paintedRange,
  setActiveAnnotation,
  showAnnotationOnArrival,
  swatchProps,
  textModel,
  updateAnnotation,
  useAnnotations,
} from '@/lib/annotations';
import { api, keys, saveNote, useSettings, type Work } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { isTyping } from '@/lib/keys';
import { useDebouncedCallback } from '@/lib/useDebounced';
import { MakeCardDialog } from './MakeCardDialog';
import { clsx } from './ui';

type Pop =
  | { kind: 'new'; target: string; part: string; quote: TextQuote; range: Range }
  | { kind: 'edit'; id: string; focus: boolean }
  | { kind: 'notice'; text: string; range: Range }
  | { kind: 'removed'; ann: Annotation; rect: DOMRect };

export const LAST_COLOR = 'wb-ann-color';
export const lastColor = (): AnnotationColor => {
  try {
    const c = localStorage.getItem(LAST_COLOR);
    return c && isAnnotationColor(c) ? c : 'yellow';
  } catch {
    return 'yellow';
  }
};

/** The host text a node is in, if it can be highlighted. */
const hostOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-annotate-target]') ?? null;

/**
 * Making and editing highlights, for every text on screen. Selecting text offers the colours; a click on a highlight
 * opens it. The highlights themselves are painted by `Prose`.
 */
export function AnnotationLayer() {
  const on = !!useSettings().data?.showAnnotations;
  return on ? <Layer /> : null;
}

function Layer() {
  const t = useT();
  const qc = useQueryClient();
  const [pop, setPop] = useState<Pop | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();
  const [card, setCard] = useState<{ exerciseId: string | null; highlightId: string } | null>(null);
  const swatches = useSwatches();
  const cards = !!useSettings().data?.showFlashcards;
  const annotations = useAnnotations().data;

  const close = useCallback(() => setPop(null), []);
  useEffect(close, [location]);
  useEffect(() => setActiveAnnotation(pop?.kind === 'edit' ? pop.id : null), [pop]);

  useEffect(() => {
    const inPop = (e: Event) => !!popRef.current?.contains(e.target as Node);
    /** After a selection is made, by mouse or keyboard: the colours, or why not. */
    const onSelect = (e: Event) => {
      if (inPop(e)) return;
      setTimeout(() => {
        const sel = getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const r = sel.getRangeAt(0);
        const host = hostOf(r.commonAncestorContainer);
        if (!host) return;
        const m = textModel(host);
        const at = offsetsOf(m, host, r);
        if (at === 'crossed') return setPop({ kind: 'notice', text: t.annCrossed, range: r.cloneRange() });
        if (!at) return;
        if (at.end - at.start > MAX_QUOTE) return setPop({ kind: 'notice', text: t.annTooLong, range: r.cloneRange() });
        const quote = quoteAt(m.text, at.start, at.end);
        if (quote) setPop({ kind: 'new', target: host.dataset.annotateTarget!, part: host.dataset.annotatePart!, quote, range: r.cloneRange() });
      }, 0);
    };
    /** A click on a highlight opens it; a click anywhere else closes what is open. */
    const onClick = (e: MouseEvent) => {
      if (inPop(e)) return;
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return;
      const el = e.target as Element;
      const hit = hostOf(el) && !el.closest('a, button, input, textarea, select, label') ? annotationAt(e.clientX, e.clientY) : null;
      setPop(hit ? { kind: 'edit', id: hit.ann.id, focus: false } : null);
    };
    const onKeyUp = (e: KeyboardEvent) => e.shiftKey && onSelect(e);
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setPop((p) => (p ? null : p));
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
  }, [t]);

  // A link to a highlight (in a deck's text) scrolls to it on arrival.
  useEffect(() => {
    const onLink = (e: MouseEvent) => {
      const id = (e.target as Element).closest<HTMLElement>('a[data-highlight]')?.dataset.highlight;
      if (id) showAnnotationOnArrival(id);
    };
    document.addEventListener('click', onLink);
    return () => document.removeEventListener('click', onLink);
  }, []);

  // A pointer over a highlight says it can be clicked.
  useEffect(() => {
    let frame = 0;
    let hovered: HTMLElement | null = null;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const host = hostOf(e.target as Element);
        const over = host && annotationAt(e.clientX, e.clientY) ? host : null;
        if (over === hovered) return;
        hovered?.style.removeProperty('cursor');
        over?.style.setProperty('cursor', 'pointer');
        hovered = over;
      });
    };
    document.addEventListener('mousemove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousemove', onMove);
      hovered?.style.removeProperty('cursor');
    };
  }, []);

  const create = (color: AnnotationColor, then?: 'comment' | 'review' | 'card', label: string | null = null) => {
    if (pop?.kind !== 'new') return;
    try {
      localStorage.setItem(LAST_COLOR, color);
    } catch {
      /* only a convenience */
    }
    getSelection()?.removeAllRanges();
    const made = addAnnotation(qc, { target: pop.target, part: pop.part, ...pop.quote, color, label, review: then === 'review' ? 'open' : null });
    if (then === 'card') setCard({ exerciseId: itemOfTarget(made.target), highlightId: made.id });
    setPop(then === 'comment' || then === 'review' ? { kind: 'edit', id: made.id, focus: then === 'comment' } : null);
  };

  // Keys while the colours are offered: 1 to 9 for a colour or label, c to comment, r to come back to it, a to add a card.
  // These listen on the document, so they run before `usePageKeys` (on the window) and a lone `a` is never taken for `g a`.
  useEffect(() => {
    if (pop?.kind !== 'new') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = '123456789'.indexOf(e.key);
      const action = i >= 0 && swatches[i] ? () => create(swatches[i]!.color, undefined, swatches[i]!.label) : e.key === 'a' && cards ? () => create(lastColor(), 'card') : e.key === 'c' ? () => create(lastColor(), 'comment') : e.key === 'r' ? () => create(lastColor(), 'review') : null;
      if (!action) return;
      e.preventDefault();
      void action();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // In an open highlight, unless a text is being written: the same key makes a card, d removes it (with undo).
  useEffect(() => {
    if (pop?.kind !== 'edit') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'a' || !cards) && e.key !== 'd') return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const a = annotations?.find((x) => x.id === pop.id);
      if (!a) return;
      e.preventDefault();
      if (e.key === 'd') return void remove(a);
      setCard({ exerciseId: itemOfTarget(a.target), highlightId: a.id });
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const remove = async (ann: Annotation) => {
    const rect = paintedRange(ann.id)?.getBoundingClientRect() ?? popRef.current?.getBoundingClientRect();
    await deleteAnnotation(qc, ann.id);
    if (rect) setPop({ kind: 'removed', ann, rect });
    else close();
  };

  const anchor = (): { rects: DOMRect[] } | null => {
    if (!pop) return null;
    if (pop.kind === 'removed') return { rects: [pop.rect] };
    const range = pop.kind === 'edit' ? paintedRange(pop.id) : pop.range;
    return range ? { rects: [...range.getClientRects()] } : null;
  };

  return (
    <>
      {pop ? (
        <Floating anchor={anchor} popRef={popRef} wide={pop.kind === 'edit'}>
          {pop.kind === 'new' ? (
            <NewHighlight onPick={(c, then, label) => void create(c, then, label)} />
          ) : pop.kind === 'notice' ? (
            <p className="max-w-xs px-3 py-2 text-[13px] text-ink-2">{pop.text}</p>
          ) : pop.kind === 'removed' ? (
            <Removed
              onUndo={() => {
                const { ann } = pop;
                const back = addAnnotation(qc, { target: ann.target, part: ann.part, quote: ann.quote, prefix: ann.prefix, suffix: ann.suffix, color: ann.color, label: ann.label, comment: ann.comment, review: ann.review });
                setPop({ kind: 'edit', id: back.id, focus: false });
              }}
              onGone={close}
            />
          ) : (
            <EditHighlight
              key={pop.id}
              id={pop.id}
              focus={pop.focus}
              onRemove={(a) => void remove(a)}
              onCard={(a) => {
                setCard({ exerciseId: itemOfTarget(a.target), highlightId: a.id });
                close();
              }}
              onGone={close}
            />
          )}
        </Floating>
      ) : null}
      {card ? <MakeCardDialog open onClose={() => setCard(null)} exerciseId={card.exerciseId} highlightId={card.highlightId} /> : null}
    </>
  );
}

/** Next to the passage: below it, or above if there is no room below. Follows it while the page scrolls. */
export function Floating({ anchor, popRef, wide, children }: { anchor: () => { rects: DOMRect[] } | null; popRef: React.RefObject<HTMLDivElement | null>; wide: boolean; children: ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const place = () => {
    const a = anchor();
    const el = popRef.current;
    if (!a?.rects.length || !el) return setPos(null);
    const first = a.rects[0]!;
    const last = a.rects[a.rects.length - 1]!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = last.bottom + 8;
    const top = Math.round(below + h > innerHeight - 8 && first.top - h - 8 > 8 ? first.top - h - 8 : below);
    const left = Math.round(Math.max(8, Math.min(first.left, innerWidth - w - 8)));
    // Only a move is a change: this runs after every render.
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  };
  useLayoutEffect(place);
  useEffect(() => {
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => {
      removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
    };
  });
  return createPortal(
    <div
      ref={popRef}
      // Not a dialog: the page's own keys stay on while it is open (they look for one).
      role="group"
      aria-label={useT().annLabel}
      data-wb-annotation=""
      className={clsx('wb-pop fixed z-50 rounded-lg border border-line-strong bg-sheet text-ink shadow-[var(--shadow)]', wide && 'w-[min(24rem,calc(100vw-16px))]')}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface Swatch {
  key: string;
  color: AnnotationColor;
  /** The student's label, if the swatch is one. */
  label: string | null;
  name: string;
}

/** What a selection can be highlighted as: the student's labels, or the plain colors while there are none. */
export function useSwatches(): Swatch[] {
  const t = useT();
  const settings = useSettings().data;
  const names = settings?.safeColors ? t.annColorSafe : t.annColor;
  const labels = settings?.highlightLabels ?? [];
  return labels.length
    ? labels.map((l: HighlightLabel) => ({ key: l.id, color: l.color, label: l.id, name: l.name.trim() || names[l.color as PaletteColor] || l.color }))
    : ANNOTATION_COLORS.map((c) => ({ key: c, color: c, label: null, name: names[c] }));
}

export function Swatches({ value, onPick }: { value?: { color: AnnotationColor; label: string | null }; onPick: (s: Swatch) => void }) {
  const t = useT();
  const items = useSwatches();
  const labelled = items.some((s) => s.label);
  return (
    <div className="flex items-center gap-1">
      {items.map((s, i) => {
        const selected = value ? (labelled ? value.label === s.label : value.color === s.color) : false;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onPick(s)}
            aria-label={labelled ? s.name : t.annHighlightIn(s.name)}
            aria-pressed={value === undefined ? undefined : selected}
            title={value === undefined && i < 9 ? `${labelled ? s.name : t.annHighlightIn(s.name)} (${i + 1})` : s.name}
            className="grid size-7 place-items-center rounded-md hover:bg-sunk"
          >
            <span {...swatchProps(s.color)} className={clsx('wb-ann-swatch grid size-4.5 place-items-center rounded-full border border-ink/15', selected && 'ring-2 ring-accent ring-offset-1 ring-offset-sheet')}>
              {selected ? <Check size={11} strokeWidth={3} className="text-ink" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NewHighlight({ onPick }: { onPick: (c: AnnotationColor, then?: 'comment' | 'review' | 'card', label?: string | null) => void }) {
  const t = useT();
  const showCards = !!useSettings().data?.showFlashcards;
  const last = lastColor();
  return (
    <div className="flex items-center gap-1 p-1">
      <Swatches onPick={(s) => onPick(s.color, undefined, s.label)} />
      <span className="mx-0.5 h-5 w-px bg-line" />
      <IconAction onClick={() => onPick(last, 'comment')} label={`${t.annComment} (c)`}>
        <MessageSquare size={15} />
      </IconAction>
      <IconAction onClick={() => onPick(last, 'review')} label={`${t.annComeBack} (r)`}>
        <RotateCcw size={15} />
      </IconAction>
      {showCards ? (
        <IconAction onClick={() => onPick(last, 'card')} label={`${t.annMakeCard} (a)`}>
          <Layers size={15} />
        </IconAction>
      ) : null}
    </div>
  );
}

/** A button with an icon only; its name shows on hover and is read out. */
export function IconAction({ children, onClick, label, pressed }: { children: ReactNode; onClick: () => void; label: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={clsx('grid size-7 place-items-center rounded-md hover:bg-sunk', pressed ? 'bg-review-soft text-review' : 'text-ink-2 hover:text-ink')}
    >
      {children}
    </button>
  );
}

export function PopButton({ children, onClick, title, pressed }: { children: ReactNode; onClick: () => void; title?: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={pressed}
      className={clsx('inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium hover:bg-sunk', pressed ? 'bg-review-soft text-review' : 'text-ink-2 hover:text-ink')}
    >
      {children}
    </button>
  );
}

function EditHighlight({ id, focus, onRemove, onCard, onGone }: { id: string; focus: boolean; onRemove: (a: Annotation) => void; onCard: (a: Annotation) => void; onGone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings().data;
  const ann = useAnnotations().data?.find((a) => a.id === id);
  const [draft, setDraft] = useState(ann?.comment ?? '');
  const [noted, setNoted] = useState(false);
  const save = useDebouncedCallback((comment: string) => void updateAnnotation(qc, id, { comment }), 500);
  useEffect(() => {
    if (!ann) onGone();
  }, [ann, onGone]);
  if (!ann) return null;
  const item = itemOfTarget(ann.target);

  const toNote = async () => {
    save.flush();
    const a = { ...ann, comment: draft };
    if (!item) return;
    if (!appendToOpenNote(item, noteSnippet(a))) {
      const work = await api.get<Work>(`/api/work/${encodeURIComponent(item)}`);
      const before = work.note?.content.trimEnd() ?? '';
      await saveNote(item, 'typst', before ? `${before}\n\n${noteSnippet(a)}` : noteSnippet(a));
      void qc.invalidateQueries({ queryKey: keys.work(item) });
    }
    setNoted(true);
  };

  const review = ann.review;
  return (
    <div className="p-2">
      <div className="flex items-center gap-1">
        <Swatches value={ann} onPick={(s) => void updateAnnotation(qc, id, { color: s.color, label: s.label })} />
        <span className="flex-1" />
        {review === 'open' ? (
          <IconAction pressed onClick={() => void updateAnnotation(qc, id, { review: 'resolved' })} label={`${t.annMarked}: ${t.annClearUp}`}>
            <RotateCcw size={15} />
          </IconAction>
        ) : review === 'resolved' ? (
          <IconAction onClick={() => void updateAnnotation(qc, id, { review: 'open' })} label={`${t.annIsClearedUp}: ${t.annReopen}`}>
            <Check size={15} className="text-done" />
          </IconAction>
        ) : (
          <IconAction onClick={() => void updateAnnotation(qc, id, { review: 'open' })} label={t.annComeBack}>
            <RotateCcw size={15} />
          </IconAction>
        )}
        {item ? (
          <IconAction onClick={() => void toNote()} label={noted ? t.annToNoteDone : t.annToNote}>
            {noted ? <Check size={15} className="text-done" /> : <NotebookPen size={15} />}
          </IconAction>
        ) : null}
        {settings?.showFlashcards ? (
          <IconAction
            onClick={() => {
              save.flush();
              onCard({ ...ann, comment: draft });
            }}
            label={`${t.annMakeCard} (a)`}
          >
            <Layers size={15} />
          </IconAction>
        ) : null}
        <button type="button" onClick={() => onRemove(ann)} aria-label={t.annRemove} title={`${t.annRemove} (d)`} className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-sunk hover:text-danger">
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

export function Removed({ onUndo, onGone }: { onUndo: () => void; onGone: () => void }) {
  const t = useT();
  useEffect(() => {
    const timer = setTimeout(onGone, 6000);
    return () => clearTimeout(timer);
  }, [onGone]);
  return (
    <div role="status" className="flex items-center gap-2 py-1 pl-3 pr-1 text-[13px]">
      <span className="text-ink-2">{t.annRemoved}</span>
      <PopButton onClick={onUndo}>
        <Undo2 size={14} /> {t.undo}
      </PopButton>
    </div>
  );
}
