import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { isCustomColor, locateQuote, type Annotation, type AnnotationColor, type AnnotationEntry, type AnnotationReview, type TextQuote } from '@wb/shared';
import { api, useSettings } from './api';
import { reportSaveFailed } from './saveNotice';

// ───────────────────────── data ─────────────────────────

export const annotationKey = ['annotations'] as const;

/** All highlights in the open course, and whether each is still found. Only while they are switched on. */
export function useAnnotations() {
  const on = !!useSettings().data?.showAnnotations;
  return useQuery({ queryKey: annotationKey, queryFn: () => api.get<AnnotationEntry[]>('/api/annotations'), enabled: on, staleTime: 30_000 });
}

export type NewAnnotation = { target: string; part: string; color: AnnotationColor; label?: string | null; comment?: string; review?: AnnotationReview | null } & TextQuote;
export type AnnotationPatch = Partial<Pick<Annotation, 'color' | 'label' | 'comment' | 'review'>>;

const setList = (qc: QueryClient, f: (list: AnnotationEntry[]) => AnnotationEntry[]) => qc.setQueryData<AnnotationEntry[]>(annotationKey, (l) => f(l ?? []));

/** `crypto.randomUUID` needs a secure context; the workbook may be opened over plain http from another machine. */
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

/**
 * Shown at once, with an id made here, and saved behind it. It was just made from the text on screen, so it is found.
 * On failure it disappears again and the student is told.
 */
export function addAnnotation(qc: QueryClient, a: NewAnnotation): AnnotationEntry {
  const t = Date.now();
  // Only the fields of a new one: an undo passes the removed highlight, whose id may still be on its way out.
  const body = { target: a.target, part: a.part, quote: a.quote, prefix: a.prefix, suffix: a.suffix, color: a.color, label: a.label ?? null, comment: a.comment ?? '', review: a.review ?? null, id: uuid() };
  const made: AnnotationEntry = { ...body, createdAt: t, updatedAt: t, found: true };
  setList(qc, (l) => [...l, made]);
  const saving = api.post<Annotation>('/api/annotations', body).then(
    (saved) => setList(qc, (l) => l.map((x) => (x.id === made.id ? { ...saved, ...x, createdAt: saved.createdAt } : x))),
    (e: unknown) => {
      setList(qc, (l) => l.filter((x) => x.id !== made.id));
      reportSaveFailed();
      throw e;
    },
  );
  arriving.set(made.id, saving);
  void saving.finally(() => arriving.delete(made.id)).catch(() => undefined);
  return made;
}

/** Shown at once, saved behind it; on failure the list is fetched again and the student is told. */
export async function updateAnnotation(qc: QueryClient, id: string, patch: AnnotationPatch): Promise<void> {
  setList(qc, (l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  try {
    await arrived(id);
    await api.patch<Annotation>(`/api/annotations/${encodeURIComponent(id)}`, patch);
  } catch (e) {
    void qc.invalidateQueries({ queryKey: annotationKey });
    reportSaveFailed();
    throw e;
  }
}

export async function deleteAnnotation(qc: QueryClient, id: string): Promise<void> {
  setList(qc, (l) => l.filter((a) => a.id !== id));
  await arrived(id);
  await api.delete(`/api/annotations/${encodeURIComponent(id)}`).catch(() => {
    void qc.invalidateQueries({ queryKey: annotationKey });
    reportSaveFailed();
  });
}

// ───────────────────────── the text ─────────────────────────

/**
 * What can be highlighted: the text nodes of a rendered text, in order, leaving out code blocks, math, pictures,
 * widgets and buttons. The same as `textOfHtml` on the server (`server/src/annotations.ts`), which checks whether a
 * quote is still there: keep the two alike.
 */
export const SKIPPED = 'pre, math, svg, button, script, style, [data-widget]';

export interface TextModel {
  text: string;
  nodes: { node: Text; start: number }[];
}

export function textModel(root: HTMLElement): TextModel {
  const nodes: TextModel['nodes'] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n instanceof Element ? (n.matches(SKIPPED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    nodes.push({ node: t, start: text.length });
    text += t.data;
  }
  return { text, nodes };
}

/** A DOM range for `[start, end)` of the model's text. */
export function rangeOf(m: TextModel, start: number, end: number): Range | null {
  const at = (offset: number, isEnd: boolean) => {
    for (const n of m.nodes) {
      const len = n.node.data.length;
      if (offset < n.start + len || (isEnd && offset === n.start + len)) return { node: n.node, offset: offset - n.start };
    }
    return null;
  };
  const a = at(start, false);
  const b = at(end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

/**
 * Where a selection lies in the model's text, or null if it lies outside it. A selection that reaches into something
 * that cannot be highlighted (code, math, a widget) is `crossed`: it is refused rather than cut down silently.
 */
export function offsetsOf(m: TextModel, root: HTMLElement, r: Range): { start: number; end: number } | 'crossed' | null {
  if (!root.contains(r.commonAncestorContainer)) return null;
  for (const el of root.querySelectorAll(SKIPPED)) if (r.intersectsNode(el)) return 'crossed';
  let start: number | null = null;
  let end: number | null = null;
  for (const n of m.nodes) {
    const len = n.node.data.length;
    if (start === null && r.intersectsNode(n.node)) start = n.start + (n.node === r.startContainer ? r.startOffset : 0);
    if (r.intersectsNode(n.node)) end = n.start + (n.node === r.endContainer ? r.endOffset : len);
  }
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

// ───────────────────────── painting ─────────────────────────

interface Painted {
  ann: Annotation;
  range: Range;
}

/** Every highlight on screen, by the text it was painted in. */
const layers = new Map<string, Painted[]>();
let active: string | null = null;

const supported = () => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** What a color the student added looks like as a fill: the same over a light page and a dark one. */
const customFill = (hex: string) => `color-mix(in srgb, ${hex} 55%, transparent)`;

/** For a swatch or a bar in a highlight's color: the palette by name, an added color by its own style. */
export function swatchProps(color: AnnotationColor): { 'data-color': string; style?: CSSProperties } {
  return isCustomColor(color) ? { 'data-color': 'custom', style: { background: customFill(color) } } : { 'data-color': color };
}

const customStyle = (() => {
  let el: HTMLStyleElement | null = null;
  return (names: Set<string>) => {
    el ??= Object.assign(document.createElement('style'), { id: 'wb-ann-custom' });
    if (!el.isConnected) document.head.appendChild(el);
    el.textContent = [...names].map((hex) => `::highlight(wb-ann-x-${hex.slice(1)}) { background-color: ${customFill(hex)}; }`).join('\n');
  };
})();

/** The names `repaint` set last time, so those no longer used are taken away. */
let paintedNames = new Set<string>();

/** One `Highlight` per colour and state for all texts on screen: the browser paints them, the DOM stays as it is. */
function repaint(): void {
  if (!supported()) return;
  const groups = new Map<string, Range[]>();
  const put = (name: string, r: Range) => (groups.get(name) ?? groups.set(name, []).get(name)!).push(r);
  for (const list of layers.values())
    for (const { ann, range } of list) {
      put(isCustomColor(ann.color) ? `wb-ann-x-${ann.color.slice(1)}` : `wb-ann-${ann.color}`, range);
      if (ann.review === 'open') put('wb-ann-review', range);
      else if (ann.comment.trim()) put('wb-ann-comment', range);
      if (ann.id === active) put('wb-ann-active', range);
    }
  customStyle(new Set([...groups.keys()].filter((n) => n.startsWith('wb-ann-x-')).map((n) => `#${n.slice(9)}`)));
  for (const name of new Set([...paintedNames, ...groups.keys()])) {
    const ranges = groups.get(name);
    if (ranges?.length) CSS.highlights.set(name, new Highlight(...ranges));
    else CSS.highlights.delete(name);
  }
  paintedNames = new Set(groups.keys());
}

/** Paints a text's highlights; returns those whose quote is not in it (any more). */
export function paintLayer(key: string, root: HTMLElement, list: Annotation[]): Annotation[] {
  const m = textModel(root);
  const painted: Painted[] = [];
  const missing: Annotation[] = [];
  for (const ann of list) {
    const at = locateQuote(m.text, ann);
    const range = at && rangeOf(m, at.start, at.end);
    if (range) painted.push({ ann, range });
    else missing.push(ann);
  }
  layers.set(key, painted);
  repaint();
  return missing;
}

export function clearLayer(key: string): void {
  if (layers.delete(key)) repaint();
}

/** The highlight being edited stands out. */
export function setActiveAnnotation(id: string | null): void {
  if (active === id) return;
  active = id;
  repaint();
}

/** The highlight under a point, the most recent one if they overlap. */
export function annotationAt(x: number, y: number): Painted | null {
  let hit: Painted | null = null;
  for (const list of layers.values())
    for (const p of list)
      for (const rect of p.range.getClientRects())
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && (!hit || p.ann.createdAt >= hit.ann.createdAt)) hit = p;
  return hit;
}

export function paintedRange(id: string): Range | null {
  for (const list of layers.values()) for (const p of list) if (p.ann.id === id) return p.range;
  return null;
}

// ───────────────────────── going to a highlight ─────────────────────────

/** A highlight to show once its text is on screen (after following a link from the list). */
let pending: string | null = null;
let pendingSince = 0;
export function showAnnotationOnArrival(id: string): void {
  pending = id;
  pendingSince = Date.now();
}

/**
 * Called after painting: scrolls to the pending highlight if it is now on screen. A
 * highlight that does not appear soon (in a hint not yet shown) is given up on, so it does not jump up later.
 */
export function revealPending(): void {
  if (!pending) return;
  if (Date.now() - pendingSince > 4000) {
    pending = null;
    return;
  }
  const range = paintedRange(pending);
  if (!range) return;
  const id = pending;
  pending = null;
  const el = range.startContainer.parentElement;
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ───────────────────────── to Typst ─────────────────────────

/** Plain text as Typst markup that reads as written: whatever would be markup is escaped. */
export function escapeMarkup(s: string): string {
  return s
    .replace(/[\\#*_$`<>@[\]~]/g, '\\$&')
    .replace(/\/\//g, '\\/\\/')
    .replace(/--/g, '-\\-')
    .replace(/^(\s*)([=+\-/])/gm, '$1\\$2');
}

/** For a note: the quote, and the comment below it. */
export const noteSnippet = (a: Pick<Annotation, 'quote' | 'comment'>) => `#quote(block: true)[${escapeMarkup(a.quote.trim())}]\n${a.comment.trim() ? `\n${escapeMarkup(a.comment.trim())}\n` : ''}`;

// ───────────────────────── notes ─────────────────────────

/**
 * Adds to an exercise's note. An open notes editor for it takes the text itself (it would otherwise overwrite the
 * saved note with what it holds); true if one did.
 */
export function appendToOpenNote(id: string, text: string): boolean {
  const e = new CustomEvent<{ id: string; text: string; taken: boolean }>('wb-note-append', { detail: { id, text, taken: false } });
  window.dispatchEvent(e);
  return e.detail.taken;
}
