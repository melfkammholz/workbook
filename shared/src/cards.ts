import type { CardKind } from './index';

/**
 * A deck is Typst text, and that text is the deck. This finds the cards in it
 * without compiling: `#flashcard(...)[front][back]` and `#cloze(...)[… {{gap}} …]`.
 * Shared, so the editor in the browser sees the same cards as the server.
 *
 * The scanner knows just enough Typst to find where a call ends: escapes, comments,
 * raw text, math, strings in code, and nested brackets. Cards made by code (a loop
 * that calls `flashcard`) are not seen here; they render, but cannot be scheduled.
 */

export interface Span {
  from: number;
  to: number;
}

export interface CardCall {
  kind: CardKind;
  /** Index of the `#`. */
  start: number;
  /** Index just after the function name. */
  nameEnd: number;
  /** Indices of `(` and `)`, if the call has arguments. */
  args: Span | null;
  id: string | null;
  /** Where the id's text is, without the quotes. */
  idSpan: Span | null;
  from: string | null;
  /** Its own tags, besides those of its exercise. */
  tags: string[];
  /** Content blocks, without their brackets. */
  bodies: Span[];
  end: number;
  /** 1-based. */
  line: number;
  column: number;
}

const IDENT = /[\p{L}\p{N}_-]/u;
const IDENT_START = /[\p{L}_]/u;

class Scanner {
  readonly cards: CardCall[] = [];
  constructor(private readonly s: string) {}

  /** Markup up to the `]` that closes it (or the end). Returns the index of that `]`. */
  markup(i: number, nested: boolean): number {
    const s = this.s;
    let depth = 0;
    while (i < s.length) {
      const c = s[i]!;
      if (c === '\\') {
        i += 2;
      } else if (c === '/' && s[i + 1] === '/' && !/https?:$/.test(s.slice(Math.max(0, i - 6), i))) {
        i = this.lineEnd(i);
      } else if (c === '/' && s[i + 1] === '*') {
        i = this.blockCommentEnd(i);
      } else if (c === '`') {
        i = this.rawEnd(i);
      } else if (c === '$') {
        i = this.mathEnd(i);
      } else if (c === '#') {
        i = this.hash(i);
      } else if (c === '[') {
        depth++;
        i++;
      } else if (c === ']') {
        if (depth === 0 && nested) return i;
        depth = Math.max(0, depth - 1);
        i++;
      } else {
        i++;
      }
    }
    return i;
  }

  /** Code up to the closer that matches the opener at `i`. Returns the index after it. */
  code(i: number): number {
    const s = this.s;
    const close = s[i] === '(' ? ')' : '}';
    i++;
    while (i < s.length) {
      const c = s[i]!;
      if (c === close) return i + 1;
      if (c === '"') i = this.stringEnd(i);
      else if (c === '/' && s[i + 1] === '/') i = this.lineEnd(i);
      else if (c === '/' && s[i + 1] === '*') i = this.blockCommentEnd(i);
      else if (c === '(' || c === '{') i = this.code(i);
      else if (c === '[') i = Math.min(this.markup(i + 1, true) + 1, s.length);
      else if (c === '`') i = this.rawEnd(i);
      else i++;
    }
    return i;
  }

  /** A `#` in markup: an expression, possibly a card. Returns where markup goes on. */
  private hash(i: number): number {
    const s = this.s;
    const start = i;
    i++;
    if (s[i] === '(' || s[i] === '{') return this.code(i);
    if (s[i] === '"') return this.stringEnd(i);
    if (!IDENT_START.test(s[i] ?? '')) return i;
    while (i < s.length && (IDENT.test(s[i]!) || (s[i] === '.' && IDENT_START.test(s[i + 1] ?? '')))) i++;
    const name = s.slice(start + 1, i);
    const nameEnd = i;
    let args: Span | null = null;
    const bodies: Span[] = [];
    // Arguments and trailing content blocks must follow without a space.
    while (s[i] === '(' || s[i] === '[') {
      if (s[i] === '(') {
        const end = this.code(i);
        if (!bodies.length && !args) args = { from: i, to: end - 1 };
        i = end;
      } else {
        const close = this.markup(i + 1, true);
        bodies.push({ from: i + 1, to: close });
        i = Math.min(close + 1, s.length);
      }
    }
    if ((name === 'flashcard' || name === 'cloze') && (args || bodies.length)) {
      const argText = args ? s.slice(args.from + 1, args.to) : '';
      const idMatch = /(?:^|[\s,])id\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(argText);
      const fromMatch = /(?:^|[\s,])from\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(argText);
      const both = /(?:^|[\s,])both\s*:\s*true\b/.test(argText);
      // `tags: ("a", "b")`, or a single `tags: "a"`.
      const tagMatch = /(?:^|[\s,])tags\s*:\s*(\([^)]*\)|"(?:[^"\\]|\\.)*")/.exec(argText);
      const tags = tagMatch ? [...tagMatch[1]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!).filter(Boolean) : [];
      let idSpan: Span | null = null;
      if (idMatch && args) {
        const at = args.from + 1 + idMatch.index + idMatch[0].length - 1 - idMatch[1]!.length;
        idSpan = { from: at, to: at + idMatch[1]!.length };
      }
      const pos = this.position(start);
      this.cards.push({
        kind: name === 'cloze' ? 'cloze' : both ? 'both' : 'basic',
        start,
        nameEnd,
        args,
        id: idMatch ? idMatch[1]! : null,
        idSpan,
        from: fromMatch ? fromMatch[1]! : null,
        tags,
        bodies,
        end: i,
        ...pos,
      });
    }
    return i;
  }

  private stringEnd(i: number): number {
    const s = this.s;
    i++;
    while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1;
    return i + 1;
  }

  private lineEnd(i: number): number {
    const n = this.s.indexOf('\n', i);
    return n < 0 ? this.s.length : n;
  }

  private blockCommentEnd(i: number): number {
    const n = this.s.indexOf('*/', i + 2);
    return n < 0 ? this.s.length : n + 2;
  }

  private rawEnd(i: number): number {
    const s = this.s;
    let n = 0;
    while (s[i + n] === '`') n++;
    if (n === 2) return i + 2; // empty raw
    const fence = '`'.repeat(n);
    const close = s.indexOf(fence, i + n);
    return close < 0 ? s.length : close + n;
  }

  private mathEnd(i: number): number {
    const s = this.s;
    i++;
    while (i < s.length && s[i] !== '$') i += s[i] === '\\' ? 2 : 1;
    return i + 1;
  }

  private lineStarts: number[] | null = null;
  position(at: number): { line: number; column: number } {
    if (!this.lineStarts) {
      this.lineStarts = [0];
      for (let i = 0; i < this.s.length; i++) if (this.s[i] === '\n') this.lineStarts.push(i + 1);
    }
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: at - this.lineStarts[lo]! + 1 };
  }
}

export function scanCards(source: string): CardCall[] {
  const sc = new Scanner(source);
  sc.markup(0, false);
  return sc.cards;
}
