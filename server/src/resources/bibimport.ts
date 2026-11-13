// Reading BibTeX and Hayagriva (Typst's YAML bibliography format) into the fields of a work. Pure; no clipboard, no files.

import YAML from 'yaml';
import type { WorkFields } from '@wb/shared';

export interface ImportedWork extends WorkFields {
  /** The reference as one line of text, in the shape the PDF parser would have read. */
  raw: string;
}

export const MAX_IMPORT = 2000;

const ACCENTS: Record<string, string> = { '`': '̀', "'": '́', '^': '̂', '~': '̃', '"': '̈', '=': '̄', '.': '̇', u: '̆', v: '̌', H: '̋', c: '̧', k: '̨' };
const LETTERS: Record<string, string> = { ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ' };

/** LaTeX in a BibTeX value as plain text: accents, ligatures, protective braces, a few escapes. */
export function unLatex(s: string): string {
  let t = s;
  // \"{u}, \"u, {\"u}, \c{c}, \v{s}
  t = t.replace(/\\([`'^~"=.])\s*\{?\\?([A-Za-z])\}?/g, (_m, a: string, c: string) => (c === 'i' ? 'i' : c === 'j' ? 'j' : c) + ACCENTS[a]!);
  t = t.replace(/\\([uvHck])\s*\{([A-Za-z])\}/g, (_m, a: string, c: string) => c + ACCENTS[a]!);
  t = t.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])\s*/g, (_m, l: string) => LETTERS[l]!);
  t = t.replace(/\\([&%$#_{}])/g, '$1').replace(/\\textemdash|---/g, '—').replace(/\\textendash|--/g, '–').replace(/\\(?:emph|textit|textbf|textsc|mathrm)\s*\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\(?:url|href)\s*\{([^{}]*)\}/g, '$1').replace(/~/g, ' ').replace(/\$([^$]*)\$/g, '$1');
  t = t.replace(/[{}]/g, '').replace(/\\\s/g, ' ');
  return t.normalize('NFC').replace(/\s+/g, ' ').trim();
}

interface RawEntry {
  type: string;
  key: string;
  fields: Map<string, string>;
}

/** The entries of a BibTeX text. Unknown or broken pieces are skipped, never thrown on. */
export function parseBibtexEntries(text: string): RawEntry[] {
  const out: RawEntry[] = [];
  const macros = new Map<string, string>([
    ['jan', 'January'], ['feb', 'February'], ['mar', 'March'], ['apr', 'April'], ['may', 'May'], ['jun', 'June'],
    ['jul', 'July'], ['aug', 'August'], ['sep', 'September'], ['oct', 'October'], ['nov', 'November'], ['dec', 'December'],
  ]);
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };
  /** A balanced `{...}` starting at i (text[i] is `{`); returns the inside. */
  const braced = (): string => {
    let depth = 0;
    const start = i + 1;
    for (; i < n; i++) {
      const c = text[i]!;
      if (c === '\\') i++;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return text.slice(start, i++);
    }
    return text.slice(start);
  };
  const quoted = (): string => {
    const start = ++i;
    let depth = 0;
    for (; i < n; i++) {
      const c = text[i]!;
      if (c === '\\') i++;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '"' && depth === 0) return text.slice(start, i++);
    }
    return text.slice(start);
  };
  /** A value: pieces joined with `#`; numbers and macro names stand for themselves. */
  const value = (): string => {
    let v = '';
    for (;;) {
      ws();
      const c = text[i];
      if (c === '{') v += braced();
      else if (c === '"') v += quoted();
      else {
        const m = /^[^\s,#{}()="]+/.exec(text.slice(i, i + 100));
        if (!m) break;
        i += m[0].length;
        v += macros.get(m[0].toLowerCase()) ?? m[0];
      }
      ws();
      if (text[i] === '#') i++;
      else break;
    }
    return v;
  };
  for (;;) {
    const at = text.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    const head = /^([A-Za-z]+)\s*([{(])/.exec(text.slice(i, i + 40));
    if (!head) continue;
    i += head[0].length;
    const type = head[1]!.toLowerCase();
    const close = head[2] === '{' ? '}' : ')';
    if (type === 'comment' || type === 'preamble') {
      // Skip to the end of the group so a `@` inside it is not an entry.
      i--;
      if (text[i] === '{') braced();
      else {
        const end = text.indexOf(')', i);
        i = end < 0 ? n : end + 1;
      }
      continue;
    }
    if (type === 'string') {
      ws();
      const name = /^[^\s=]+/.exec(text.slice(i, i + 100))?.[0];
      if (name) {
        i += name.length;
        ws();
        if (text[i] === '=') {
          i++;
          macros.set(name.toLowerCase(), value());
        }
      }
      continue;
    }
    ws();
    const key = /^[^\s,{}]*/.exec(text.slice(i, i + 200))![0];
    i += key.length;
    const fields = new Map<string, string>();
    for (;;) {
      ws();
      while (text[i] === ',') {
        i++;
        ws();
      }
      if (i >= n || text[i] === close) {
        i++;
        break;
      }
      const name = /^[A-Za-z][\w:.-]*/.exec(text.slice(i, i + 60))?.[0];
      if (!name) {
        // Not a field: lost; read on from the next `@`.
        break;
      }
      i += name.length;
      ws();
      if (text[i] !== '=') continue;
      i++;
      fields.set(name.toLowerCase(), value());
    }
    out.push({ type, key, fields });
    if (out.length >= MAX_IMPORT) break;
  }
  return out;
}

/** "Last, First and Last2, First2" (or "First Last and ...") as "First Last, First2 Last2". */
export function bibtexAuthors(s: string): string {
  const people = s.split(/\s+and\s+/i).map((p) => unLatex(p)).filter(Boolean);
  const names = people.map((p) => {
    if (/^others$/i.test(p)) return 'et al.';
    const parts = p.split(',').map((x) => x.trim());
    return parts.length >= 2 ? [parts.slice(1).join(' '), parts[0]].filter(Boolean).join(' ') : p;
  });
  return names.join(', ').replace(/, et al\.$/, ' et al.');
}

const DOI_PREFIX = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i;
const cleanDoi = (s: string) => unLatex(s).replace(DOI_PREFIX, '').trim();

/** One line the way a reference list would print it, for the raw text and for search. */
export function rawLine(w: WorkFields): string {
  const parts = [w.authors, w.year ? `(${w.year})` : '', w.title ? `${w.title}.` : '', w.venue ? `${w.venue}.` : '', w.doi ? `doi:${w.doi}` : w.url];
  return parts.filter(Boolean).join(' ').replace(/\.\.$/, '.').slice(0, 2000);
}

const yearOf = (s: string): number | null => {
  const m = /(?<!\d)(1[5-9]\d\d|20\d\d)(?!\d)/.exec(s);
  return m ? Number(m[1]) : null;
};

export function fromBibtex(text: string): ImportedWork[] {
  const works: ImportedWork[] = [];
  for (const e of parseBibtexEntries(text)) {
    const f = e.fields;
    const get = (k: string) => unLatex(f.get(k) ?? '');
    const title = get('title');
    if (!title) continue;
    const venue = get('journal') || get('journaltitle') || get('booktitle') || get('series') || get('publisher') || get('school') || get('institution') || get('howpublished');
    const w: WorkFields = {
      title: title.slice(0, 300),
      authors: bibtexAuthors(f.get('author') ?? f.get('editor') ?? '').slice(0, 400),
      year: yearOf(get('year') || get('date')),
      venue: venue.slice(0, 300),
      doi: cleanDoi(f.get('doi') ?? ''),
      url: /^https?:/i.test(get('url')) ? get('url').split(/\s/)[0]! : '',
    };
    works.push({ ...w, raw: rawLine(w) });
  }
  return works;
}

/** A Hayagriva value that is a string, a number or `{value: ...}`. */
function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) return str((v as { value: unknown }).value);
  return '';
}

/** "Last, First" or "First Last" or a map {name, given-name}, as "First Last". */
function hayaPerson(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return [str(o['given-name']), str(o['prefix']), str(o['name'])].filter(Boolean).join(' ');
  }
  const s = str(v);
  const parts = s.split(',').map((x) => x.trim());
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : s;
}

const hayaPeople = (v: unknown): string => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(hayaPerson).filter(Boolean).join(', ');

export function fromHayagriva(text: string): ImportedWork[] {
  let doc: unknown;
  try {
    doc = YAML.parse(text, { maxAliasCount: 20 });
  } catch {
    return [];
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
  const works: ImportedWork[] = [];
  for (const entry of Object.values(doc as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const title = str(e['title']);
    if (!title) continue;
    const parents = (Array.isArray(e['parent']) ? e['parent'] : e['parent'] ? [e['parent']] : []).filter((p): p is Record<string, unknown> => !!p && typeof p === 'object');
    const parentTitle = parents.map((p) => str(p['title'])).find(Boolean) ?? '';
    const publisher = str(e['publisher'] && typeof e['publisher'] === 'object' ? (e['publisher'] as Record<string, unknown>)['name'] : e['publisher']);
    const serial = e['serial-number'] && typeof e['serial-number'] === 'object' ? (e['serial-number'] as Record<string, unknown>) : {};
    const date = str(e['date']) || parents.map((p) => str(p['date'])).find(Boolean) || '';
    const w: WorkFields = {
      title: title.slice(0, 300),
      authors: (hayaPeople(e['author']) || hayaPeople(e['editor'])).slice(0, 400),
      year: yearOf(date),
      venue: (parentTitle || publisher).slice(0, 300),
      doi: cleanDoi(str(serial['doi']) || str(e['doi'])),
      url: str(e['url']).split(/\s/)[0]!,
    };
    works.push({ ...w, raw: rawLine(w) });
    if (works.length >= MAX_IMPORT) break;
  }
  return works;
}

/** Which format a text is, by what it has to offer; the one with works wins. */
export function parseBibText(text: string): { format: 'bibtex' | 'hayagriva' | null; works: ImportedWork[] } {
  const body = text.replace(/^﻿/, '');
  if (/^\s*(?:%[^\n]*\n\s*)*@[A-Za-z]+\s*[{(]/.test(body) || /\n\s*@[A-Za-z]+\s*[{(]/.test(body)) {
    const works = fromBibtex(body);
    if (works.length) return { format: 'bibtex', works };
  }
  const works = fromHayagriva(body);
  return works.length ? { format: 'hayagriva', works } : { format: null, works: [] };
}
