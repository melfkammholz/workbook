// Citations in the running text of a PDF that carries no links for them ("[12]", "Smith et al. 2020"), matched to the
// entries of its bibliography. A trial (V6): heuristic, so it is a setting that is off by default. Pure.
import { workFields } from './bibliography';
import type { PageTextItem } from './pdfReanchor';

/** A citation found on a page, as a box in fractions of the page, and the index of the entry it cites. */
export interface CitationLink {
  x: number;
  y: number;
  w: number;
  h: number;
  entry: number;
}

/** The family name of an entry's first author, lower case: "Smith, J. and Jones, K." and "J. Smith, K. Jones" both give "smith". */
export function firstSurname(authors: string): string {
  const first = authors.split(/\s*(?:;|\band\b|&|\bund\b)\s*/i)[0] ?? '';
  const comma = /^([\p{Lu}][\p{L}'’-]+(?:\s+(?:van|von|de|der|den|du|di|la|le)\s+[\p{Lu}][\p{L}'’-]+)?)\s*,/u.exec(first);
  if (comma) return comma[1]!.split(/\s+/).pop()!.toLowerCase();
  const word = first.split(',')[0]!.trim().split(/\s+/).filter((w) => !/^(?:\p{Lu}\.)+$/u.test(w) && w.length > 1);
  return (word[word.length - 1] ?? '').replace(/[^\p{L}'’-]/gu, '').toLowerCase();
}

/** The page's items as one string, with where each item starts in it. */
function joined(items: readonly PageTextItem[]): { text: string; starts: number[]; used: PageTextItem[] } {
  const used = items.filter((i) => i.str.length > 0);
  const starts: number[] = [];
  let text = '';
  for (const it of used) {
    starts.push(text.length);
    text += it.str + ' ';
  }
  return { text, starts, used };
}

/** The box of the characters [from, to) of the joined text; the first line only when they run over several. */
function boxOf(j: ReturnType<typeof joined>, from: number, to: number): Omit<CitationLink, 'entry'> | null {
  let a = j.starts.length - 1;
  while (a > 0 && j.starts[a]! > from) a--;
  const it = j.used[a]!;
  const len = Math.max(1, it.str.length);
  const x0 = it.x + (it.w * (from - j.starts[a]!)) / len;
  let x1 = it.x + it.w;
  let b = a;
  while (b + 1 < j.starts.length && j.starts[b + 1]! < to) b++;
  const last = j.used[b]!;
  if (b === a) x1 = it.x + (it.w * Math.min(len, to - j.starts[a]!)) / len;
  else if (Math.abs(last.y - it.y) < it.h * 0.5) x1 = last.x + (last.w * Math.min(last.str.length, to - j.starts[b]!)) / Math.max(1, last.str.length);
  const w = x1 - x0;
  return w > 0.002 && it.h > 0 ? { x: x0, y: it.y, w, h: it.h } : null;
}

const NUMBERS = /\[\s*(\d{1,4}(?:\s*[-–,]\s*\d{1,4})*)\s*\]/g;
const YEAR = /(?<![\d/.])((?:19|20)\d{2})([a-z])?(?!\d)/g;

/**
 * Citations on one page: numbered ones ("[12]", "[3, 5]", "[4-6]": each number its own box, the numbers of a range at
 * its ends) lead to the entry of that number, author-year ones ("Smith 2020", "Smith et al., 2020", "(Smith and Jones,
 * 2020)") to the entry of that first author and year; one that fits several entries (2020a and 2020b) is left out.
 */
export function findCitations(items: readonly PageTextItem[], entries: readonly { text: string }[]): CitationLink[] {
  if (!entries.length) return [];
  const j = joined(items);
  const out: CitationLink[] = [];

  for (const m of j.text.matchAll(NUMBERS)) {
    // "a[1]" is an index, not a citation.
    if (m.index! > 0 && /[\p{L}\d)]/u.test(j.text[m.index! - 1]!)) continue;
    const base = m.index! + m[0].indexOf(m[1]!);
    for (const n of m[1]!.matchAll(/\d+/g)) {
      const k = Number(n[0]);
      if (k < 1 || k > entries.length) continue;
      const box = boxOf(j, base + n.index!, base + n.index! + n[0].length);
      if (box) out.push({ ...box, entry: k - 1 });
    }
  }

  const byKey = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const f = workFields(e.text);
    const s = f.year ? firstSurname(f.authors) : '';
    if (s.length < 2) return;
    const key = `${s}|${f.year}`;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  });
  if (byKey.size) {
    for (const m of j.text.matchAll(YEAR)) {
      const at = m.index!;
      const before = j.text.slice(Math.max(0, at - 70), at);
      const names = [...before.matchAll(/\p{Lu}[\p{L}'’-]+/gu)];
      // The nearest name that is the first author of an entry of that year.
      for (let k = names.length - 1; k >= 0; k--) {
        const hit = byKey.get(`${names[k]![0].toLowerCase()}|${m[1]}`);
        if (!hit) continue;
        if (hit.length === 1) {
          const from = Math.max(0, at - 70) + names[k]!.index!;
          const box = boxOf(j, from, at + m[0].length);
          if (box) out.push({ ...box, entry: hit[0]! });
        }
        break;
      }
    }
  }
  return out;
}
