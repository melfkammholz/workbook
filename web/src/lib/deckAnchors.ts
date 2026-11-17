import { scanCards } from '@wb/shared';

/**
 * A card's `anchor: "…"` is an encoded place, not something to read or write. The text editor shows the deck without
 * it; on saving, each card that has an id gets its anchor back.
 */
const ANCHOR = /(^|[\s,])anchor\s*:\s*"[A-Za-z0-9_-]*"(\s*,)?[ \t]*/;

/** The deck text as the editor shows it. */
export function stripAnchors(source: string): string {
  let out = source;
  // Last card first, so the earlier spans stay valid.
  for (const c of [...scanCards(source)].reverse()) {
    if (!c.args || !c.anchorArg) continue;
    const inner = source.slice(c.args.from + 1, c.args.to);
    const next = inner.replace(ANCHOR, '$1').replace(/,\s*$/, '');
    out = out.slice(0, c.args.from + 1) + next + out.slice(c.args.to);
  }
  return out;
}

/** The anchors of a deck's cards, by card id. */
export function anchorsById(source: string, into: Map<string, string> = new Map()): Map<string, string> {
  for (const c of scanCards(source)) if (c.id && c.anchorArg) into.set(c.id, c.anchorArg);
  return into;
}

/** The text from the editor with the anchors written back in. */
export function restoreAnchors(text: string, anchors: Map<string, string>): string {
  let out = text;
  for (const c of [...scanCards(text)].reverse()) {
    const anchor = c.id ? anchors.get(c.id) : undefined;
    if (!anchor || !c.args) continue;
    const empty = !text.slice(c.args.from + 1, c.args.to).trim();
    out = out.slice(0, c.args.from + 1) + `anchor: "${anchor}"` + (empty ? '' : ', ') + out.slice(c.args.from + 1);
  }
  return out;
}

/** One change that turns `a` into `b`. */
export function diffChange(a: string, b: string): { from: number; to: number; insert: string } {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) };
}
