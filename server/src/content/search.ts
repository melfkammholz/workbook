/** Removes `#name[…]` with its whole, possibly nested, body. */
function dropBodies(source: string, names: string[]): string {
  let out = source;
  for (const name of names) {
    const open = `#${name}[`;
    for (let at = out.indexOf(open); at >= 0; at = out.indexOf(open, at)) {
      let depth = 0;
      let end = at + open.length - 1;
      for (; end < out.length; end++) {
        if (out[end] === '[') depth++;
        else if (out[end] === ']' && --depth === 0) break;
      }
      out = out.slice(0, at) + out.slice(end + 1);
    }
  }
  return out;
}

/**
 * The words of a text, for searching. Hints, sample answers and author notes are left out, so a
 * search can neither give an answer away nor show a student what the author kept to themselves.
 */
export function plainText(typst: string): string {
  return dropBodies(typst, ['hint', 'sample', 'draft-note'])
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*#(import|let|set|show)\b.*$/gm, ' ')
    .replace(/#link\(\s*"[^"]*"\s*\)/g, ' ')
    .replace(/#xref\(\s*"[^"]*"[^)]*\)/g, ' ')
    .replace(/#[a-zA-Z][\w-]*/g, ' ')
    // Formulas are source code here, which nobody searches for and nobody can read in a result.
    .replace(/(?<!\\)\$[^$]*\$/g, ' … ')
    .replace(/```\w*/g, ' ')
    .replace(/[*_`\[\]$=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase, without accents: "Rückgabe" is found by "ruckgabe" too. Keeps every character's position. */
export const fold = (s: string): string =>
  Array.from(s, (c) => {
    const f = c.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
    return f.length === c.length ? f : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
  }).join('');

const CONTEXT = 48;

/** The place a word was found, with the word marked as «this», as in the search of the student's own work. */
export function snippetOf(text: string, terms: string[]): string | null {
  const folded = fold(text);
  const hits = terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0);
  if (hits.length === 0) return null;
  const first = Math.min(...hits);
  const start = Math.max(0, first - CONTEXT);
  const end = Math.min(text.length, first + CONTEXT * 2);
  const term = terms.find((t) => folded.indexOf(t) === first)!;
  return `${start > 0 ? '…' : ''}${text.slice(start, first)}«${text.slice(first, first + term.length)}»${text.slice(first + term.length, end)}${end < text.length ? '…' : ''}`;
}
