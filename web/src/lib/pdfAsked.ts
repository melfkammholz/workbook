import { useSyncExternalStore } from 'react';
import { locateQuote, type TextQuote } from '@wb/shared';
import { rangeOf, textModel } from './annotations';

/**
 * The passages of the open PDF that have an open question, by page (0-based). They are marked in the text of the
 * page with a dotted underline: not a highlight, so it is not kept in the highlight list and goes with the question.
 */
let asked = new Map<number, TextQuote[]>();
const listeners = new Set<() => void>();
const NONE: TextQuote[] = [];

export function setAsked(next: Map<number, TextQuote[]>): void {
  asked = next;
  listeners.forEach((l) => l());
}

export function useAsked(pageIndex: number): TextQuote[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => asked.get(pageIndex) ?? NONE,
  );
}

const painted = new Map<number, Range[]>();

function repaint(): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
  const all = [...painted.values()].flat();
  if (all.length) CSS.highlights.set('wb-q-mark', new Highlight(...all));
  else CSS.highlights.delete('wb-q-mark');
}

/** Marks the quotes in a page's rendered text layer (none: the page let go of its text). */
export function paintAsked(pageIndex: number, layer: HTMLElement | null, quotes: TextQuote[]): void {
  const ranges: Range[] = [];
  if (layer && quotes.length) {
    const m = textModel(layer);
    for (const q of quotes) {
      const at = locateQuote(m.text, q);
      const r = at && rangeOf(m, at.start, at.end);
      if (r) ranges.push(r);
    }
  }
  if (ranges.length) painted.set(pageIndex, ranges);
  else painted.delete(pageIndex);
  repaint();
}
