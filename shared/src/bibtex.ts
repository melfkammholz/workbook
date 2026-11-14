// BibTeX text for works, for pasting into a thesis. Copy only: the library is not exported as a file. The reader is
// `fromBibtex` on the server (it needs no more than this file does, but it comes with the Hayagriva reader).

import { normalizeDoi, type WorkEdit } from './bibliography';

type Fields = Pick<WorkEdit, 'title' | 'authors' | 'year' | 'venue' | 'doi' | 'url' | 'volume' | 'pages' | 'arxiv'>;

const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'la', 'le', 'du', 'ten', 'ter', 'bin', 'al']);

/** "Philip Wadler, Graham Hutton et al." as "Wadler, Philip and Hutton, Graham and others". */
export function bibtexAuthorList(authors: string): string {
  const more = /\bet al\.?$/i.test(authors.trim());
  const people = authors.replace(/\s*\bet al\.?$/i, '').split(/\s*,\s*|\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  const names = people.map((p) => {
    const words = p.split(/\s+/);
    if (words.length < 2) return `{${escapeBibtex(p)}}`;
    // The family name is the last word and the particles in front of it ("van der Berg").
    let at = words.length - 1;
    while (at > 1 && PARTICLES.has(words[at - 1]!.toLowerCase())) at--;
    return `${escapeBibtex(words.slice(at).join(' '))}, ${escapeBibtex(words.slice(0, at).join(' '))}`;
  });
  if (more) names.push('others');
  return names.join(' and ');
}

/** Characters BibTeX would read as markup. Letters with accents stay as they are (biber and bibtex8 take UTF-8). */
export function escapeBibtex(s: string): string {
  return s.replace(/[&%$#_]/g, (c) => `\\${c}`).replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]+/g, '');
const SKIP = new Set(['a', 'an', 'the', 'on', 'of', 'for', 'in', 'to', 'and', 'der', 'die', 'das', 'ein', 'eine', 'von', 'zur', 'zum']);

/** `wadler1989theorems`: the first author's family name, the year and the first word of the title that says something. */
export function bibtexKey(w: Pick<Fields, 'title' | 'authors' | 'year'>): string {
  const first = w.authors.replace(/\s*\bet al\.?$/i, '').split(/\s*,\s*|\s+and\s+/i)[0]?.trim() ?? '';
  const family = ascii(first.split(/\s+/).pop() ?? '');
  const word = w.title.split(/[^\p{L}\p{N}]+/u).map(ascii).find((x) => x.length > 2 && !SKIP.has(x)) ?? '';
  return `${family}${w.year ?? ''}${word}` || 'work';
}

const IN_PROCEEDINGS = /proceedings|conference|workshop|symposium|\bproc\.|\bin:/i;

/** One entry: `@article` with a journal (volume or pages known), `@inproceedings` for a conference, `@misc` otherwise. */
export function toBibtexEntry(w: Fields, key: string): string {
  const type = w.venue ? (IN_PROCEEDINGS.test(w.venue) ? 'inproceedings' : w.volume || w.pages ? 'article' : 'misc') : 'misc';
  const venueField = type === 'inproceedings' ? 'booktitle' : type === 'article' ? 'journal' : 'howpublished';
  const rows: [string, string][] = [
    ['author', w.authors ? bibtexAuthorList(w.authors) : ''],
    ['title', w.title ? `{${escapeBibtex(w.title)}}` : ''],
    [venueField, w.venue ? escapeBibtex(w.venue) : ''],
    ['year', w.year === null ? '' : String(w.year)],
    ['volume', escapeBibtex(w.volume)],
    ['pages', escapeBibtex(w.pages).replace(/\s*[-–—]+\s*/, '--')],
    ['doi', normalizeDoi(w.doi)],
    ['eprint', escapeBibtex(w.arxiv)],
    ['archiveprefix', w.arxiv ? 'arXiv' : ''],
    ['url', w.url.replace(/[{}\s]/g, '')],
  ];
  const body = rows.filter(([, v]) => v !== '').map(([k, v]) => `  ${k.padEnd(14)}= {${k === 'title' ? v.slice(1, -1) : v}},`);
  return `@${type}{${key},\n${body.join('\n')}\n}`;
}

/** BibTeX for several works, blank line between; keys are made unique (`…a`, `…b`). */
export function toBibtex(works: readonly Fields[]): string {
  const used = new Map<string, number>();
  return works
    .map((w) => {
      const base = bibtexKey(w);
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      return toBibtexEntry(w, n === 0 ? base : `${base}${String.fromCharCode(96 + n)}`);
    })
    .join('\n\n');
}
