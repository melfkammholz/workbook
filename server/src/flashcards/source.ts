import crypto from 'node:crypto';
import { scanCards, type CardCall, type CardKind, type DeckWarning, type Span, type TextEdit } from '@wb/shared';

/** The scanner lives in `@wb/shared`, so the browser finds the same cards. */
export { scanCards, type CardCall, type Span };

// ───────────────────────── gaps ─────────────────────────

const GAP = /\{\{([\s\S]*?)\}\}/g;

/**
 * The gaps of a cloze, in order. Math is skipped: there braces are Typst's own.
 * Returns the spans of the whole `{{…}}`.
 */
export function gapsIn(source: string, body: Span): Span[] {
  const text = source.slice(body.from, body.to);
  const out: Span[] = [];
  // Outside math only: split at unescaped `$`.
  let inMath = false;
  let segStart = 0;
  const flush = (end: number) => {
    if (inMath) return;
    const seg = text.slice(segStart, end);
    for (const m of seg.matchAll(GAP)) out.push({ from: body.from + segStart + m.index, to: body.from + segStart + m.index + m[0].length });
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '$') {
      flush(i);
      inMath = !inMath;
      segStart = i + 1;
    }
  }
  flush(text.length);
  return out;
}

/** Marks for the browser: a gap opens with U+E100 + its number and closes with U+E0FF. Typst passes both through untouched, also in code. */
export const GAP_CLOSE = '\uE0FF';
export const gapOpen = (n: number) => String.fromCharCode(0xe100 + Math.min(n, 254));

// ───────────────────────── review units ─────────────────────────

export interface Unit {
  /** What the schedule belongs to: the card id, plus `:back` or `:<gap>`. */
  key: string;
  cardId: string;
  /** For `both`: which way round. For cloze: which gap is hidden. */
  side: 'front' | 'back' | null;
  gap: number | null;
}

/** One schedule per direction and per gap. */
export function unitsOf(source: string, card: CardCall): Unit[] {
  if (!card.id) return [];
  const id = card.id;
  if (card.kind === 'basic' || card.kind === 'quiz') return [{ key: id, cardId: id, side: 'front', gap: null }];
  if (card.kind === 'both')
    return [
      { key: id, cardId: id, side: 'front', gap: null },
      { key: `${id}:back`, cardId: id, side: 'back', gap: null },
    ];
  const body = card.bodies[0];
  const n = body ? gapsIn(source, body).length : 0;
  return Array.from({ length: n }, (_, i) => ({ key: `${id}:${i + 1}`, cardId: id, side: null, gap: i + 1 }));
}

// ───────────────────────── ids ─────────────────────────

export function applyEdits(source: string, edits: TextEdit[]): string {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l, o, 0, 1: easy to tell apart

export function newCardId(taken: (id: string) => boolean): string {
  for (let length = 4; ; length++) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const bytes = crypto.randomBytes(length);
      const id = Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
      if (!taken(id)) return id;
    }
  }
}

export const VALID_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Gives every card without an id (or with one used before it, or elsewhere) a new one.
 * Only insertions and replacements of the id itself, so the editor can apply them
 * without moving the cursor.
 */
export function assignIds(source: string, inOtherDeck: (id: string) => boolean, usedBefore: (id: string) => boolean = () => false): { source: string; edits: TextEdit[] } {
  const cards = scanCards(source);
  const seen = new Set<string>();
  const fresh = new Set<string>();
  // A new id is one never seen anywhere: not even a deleted card's history may come back with it.
  const taken = (id: string) => seen.has(id) || fresh.has(id) || inOtherDeck(id) || usedBefore(id) || cards.some((c) => c.id === id);
  const edits: TextEdit[] = [];
  for (const c of cards) {
    if (c.id && VALID_ID.test(c.id) && !seen.has(c.id) && !inOtherDeck(c.id)) {
      seen.add(c.id);
      continue;
    }
    const id = newCardId(taken);
    fresh.add(id);
    if (c.idSpan) edits.push({ from: c.idSpan.from, to: c.idSpan.to, insert: id });
    else if (c.args) {
      const empty = source.slice(c.args.from + 1, c.args.to).trim() === '';
      edits.push({ from: c.args.from + 1, to: c.args.from + 1, insert: empty ? `id: "${id}"` : `id: "${id}", ` });
    } else edits.push({ from: c.nameEnd, to: c.nameEnd, insert: `(id: "${id}")` });
  }
  return { source: applyEdits(source, edits), edits };
}

// ───────────────────────── compiling ─────────────────────────

/**
 * What is compiled: the deck as written, with each card told the language of the
 * exercise it came from, and cloze gaps turned into marks. Lines stay where they
 * are, so Typst's messages point at the right line.
 */
export function toTypst(source: string, languageOf: (from: string) => string | null): string {
  const edits: TextEdit[] = [];
  for (const c of scanCards(source)) {
    const lang = c.from ? languageOf(c.from) : null;
    if (lang && c.args) edits.push({ from: c.args.from + 1, to: c.args.from + 1, insert: `_lang: "${lang}", ` });
    if (c.kind === 'cloze' && c.bodies[0]) {
      gapsIn(source, c.bodies[0]).forEach((g, i) => {
        edits.push({ from: g.from, to: g.from + 2, insert: gapOpen(i + 1) });
        edits.push({ from: g.to - 2, to: g.to, insert: GAP_CLOSE });
      });
    }
  }
  return applyEdits(source, edits);
}

// ───────────────────────── warnings ─────────────────────────

export function deckWarnings(source: string, knows: (from: string) => boolean): DeckWarning[] {
  const out: DeckWarning[] = [];
  for (const c of scanCards(source)) {
    const at = { line: c.line, column: c.column };
    const argText = c.args ? source.slice(c.args.from + 1, c.args.to) : '';
    // Content given inside the parentheses is not looked at.
    const positional = /(^|,)\s*\[/.test(argText);
    if (!positional) {
      const blank = (b: Span | undefined) => !b || source.slice(b.from, b.to).trim() === '';
      if (c.kind !== 'cloze') {
        if (blank(c.bodies[0])) out.push({ code: 'empty-front', ...at });
        if (blank(c.bodies[1])) out.push({ code: 'no-back', ...at });
      } else if (!c.bodies[0] || gapsIn(source, c.bodies[0]).length === 0) out.push({ code: 'no-gap', ...at });
    }
    if (c.from !== null && !knows(c.from)) out.push({ code: 'unknown-from', ...at, detail: c.from });
  }
  return out;
}

/** Appends a card on a line of its own, keeping one blank line before it. */
export function appendCard(source: string, card: string): string {
  const trimmed = source.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${card}\n` : `${card}\n`;
}

const indent = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => (l.trim() ? `  ${l}` : ''))
    .join('\n');

/**
 * The text of a card, written as a student would: front and back on lines of their own,
 *
 *     #flashcard[
 *       front
 *     ][
 *       back
 *     ]
 */
export function cardText(kind: CardKind, front: string, back: string, from: string | null, id: string | null = null, tags: string[] = []): string {
  const args: string[] = [];
  if (id) args.push(`id: ${JSON.stringify(id)}`);
  if (from) args.push(`from: ${JSON.stringify(from)}`);
  if (kind === 'both') args.push('both: true');
  // A one-element array needs its trailing comma in Typst.
  if (tags.length) args.push(`tags: (${tags.map((t) => JSON.stringify(t)).join(', ')}${tags.length === 1 ? ',' : ''})`);
  // A quiz is all arguments: the question and its choices follow the named ones.
  if (kind === 'quiz') return `#quiz(${args.map((a) => `${a}, `).join('')}\n${indent(front)}\n)`;
  const head = `#${kind === 'cloze' ? 'cloze' : 'flashcard'}${args.length ? `(${args.join(', ')})` : ''}`;
  return kind === 'cloze' ? `${head}[\n${indent(front)}\n]` : `${head}[\n${indent(front)}\n][\n${indent(back)}\n]`;
}

/** What is written inside a content block, without the layout `cardText` adds. */
export function dedent(text: string): string {
  const lines = text.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '').split('\n');
  const widths = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = widths.length ? Math.min(...widths) : 0;
  return lines
    .map((l) => l.slice(Math.min(cut, /^[ \t]*/.exec(l)![0].length)))
    .join('\n')
    .trim();
}

export interface CardFields {
  id: string | null;
  kind: CardKind;
  from: string | null;
  tags: string[];
  front: string;
  back: string;
  line: number;
}

/** A quiz's arguments without the ones the deck keeps (`id`, `from`, `tags`): the question and its choices. */
export function quizBody(args: string): string {
  // Up to the line break, so the indentation of what follows stays as it is.
  return args.replace(/^[ \t]*(?:(?:id|from|tags|_lang)\s*:\s*(?:"(?:[^"\\]|\\.)*"|\([^)]*\))\s*,[ \t]*)*/, '');
}

export function fieldsOf(source: string, c: CardCall): CardFields {
  if (c.kind === 'quiz') {
    const front = c.args ? dedent(quizBody(source.slice(c.args.from + 1, c.args.to))) : '';
    return { id: c.id, kind: c.kind, from: c.from, tags: c.tags, front, back: '', line: c.line };
  }
  const body = (i: number) => (c.bodies[i] ? dedent(source.slice(c.bodies[i]!.from, c.bodies[i]!.to)) : '');
  return { id: c.id, kind: c.kind, from: c.from, tags: c.tags, front: body(0), back: c.kind === 'cloze' ? '' : body(1), line: c.line };
}

/** Rewrites one card, keeping its id and where it came from. Anything else in its arguments is written anew. */
export function replaceCard(source: string, id: string, kind: CardKind, front: string, back: string, tags: string[]): string | null {
  const c = scanCards(source).find((x) => x.id === id);
  if (!c) return null;
  return source.slice(0, c.start) + cardText(kind, front, back, c.from, c.id, tags) + source.slice(c.end);
}

/** Removes a card and the blank line it leaves. */
export function removeCard(source: string, id: string): string | null {
  const c = scanCards(source).find((x) => x.id === id);
  if (!c) return null;
  const before = source.slice(0, c.start).replace(/\s+$/, '');
  const after = source.slice(c.end).replace(/^\s+/, '');
  if (!before) return after;
  if (!after) return `${before}\n`;
  return `${before}\n\n${after}`;
}

/** Swaps a card with the one before or after it. Text between them stays where it is. */
export function moveCard(source: string, id: string, direction: -1 | 1): string | null {
  const cards = scanCards(source);
  const i = cards.findIndex((x) => x.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= cards.length) return null;
  const [a, b] = i < j ? [cards[i]!, cards[j]!] : [cards[j]!, cards[i]!];
  const text = (c: CardCall) => source.slice(c.start, c.end);
  return source.slice(0, a.start) + text(b) + source.slice(a.end, b.start) + text(a) + source.slice(b.end);
}

/** Moves a card to a position among the cards, one neighbour at a time, so text between cards stays where it is. */
export function moveCardTo(source: string, id: string, to: number): string | null {
  const from = scanCards(source).findIndex((x) => x.id === id);
  if (from < 0) return null;
  const target = Math.max(0, Math.min(to, scanCards(source).length - 1));
  let out = source;
  for (let i = from; i !== target; i += target > i ? 1 : -1) out = moveCard(out, id, target > i ? 1 : -1) ?? out;
  return out;
}

/** Puts a card right after another one, e.g. the second half of a split. */
export function insertAfter(source: string, id: string, card: string): string | null {
  const c = scanCards(source).find((x) => x.id === id);
  if (!c) return null;
  return `${source.slice(0, c.end)}\n\n${card}${source.slice(c.end)}`;
}

/** Whether a piece of a card closes all its brackets, so appending it cannot break the deck. */
export function balanced(text: string): boolean {
  const probe = `#flashcard[${text}]`;
  const [card] = scanCards(probe);
  return !!card && card.bodies.length === 1 && card.bodies[0]!.to === probe.length - 1;
}
