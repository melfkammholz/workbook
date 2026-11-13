// The bibliography of a PDF: finds the references section in the text lines of its pages, splits it into entries,
// reads what can be read from an entry (year, DOI, URL, authors, title) and maps a link target to the entry. Pure.

/** A line of text on a page as the browser reads it from pdf.js. `x` and `y` are fractions of the page from the top left. */
export interface TextLine {
  text: string;
  x: number;
  y: number;
}
export type PageLines = TextLine[];

/** Lines from the text items of a page (`textItems` of pdfReanchor): items on one baseline, left to right, in reading order. */
export function linesOf(items: readonly { str: string; x: number; y: number; w: number; h: number }[]): PageLines {
  const rows: { y: number; h: number; items: typeof items[number][] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const mid = it.y + it.h / 2;
    const row = rows.find((r) => Math.abs(r.y - mid) < Math.max(0.004, Math.min(r.h, it.h) * 0.4));
    if (row) row.items.push(it);
    else rows.push({ y: mid, h: it.h, items: [it] });
  }
  rows.sort((a, b) => a.y - b.y);
  return rows.map((r) => {
    const sorted = r.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = 0;
    for (const it of sorted) {
      // A gap wider than a space between two pieces is a space; touching pieces are one word.
      if (text && it.x - end > it.h * 0.15) text += ' ';
      text += it.str;
      end = it.x + it.w;
    }
    return { text, x: sorted[0]!.x, y: r.y - r.h / 2 };
  });
}

/** What the parser makes of one entry: where it starts, its text, and the fields that could be read. */
export interface ParsedEntry {
  /** 0-based page and height (0-1) of the entry's first line. */
  pageIndex: number;
  y: number;
  /** Marker such as "[12]" or "12." when the entry has one, else null. */
  marker: string | null;
  text: string;
}

export interface WorkFields {
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doi: string;
  url: string;
}

export const MAX_BIB_ENTRIES = 3000;
export const MAX_ENTRY_TEXT = 2000;

const HEADING = /^(?:\d+\.?\s+|[A-Z]\.\s+)?(references|bibliography|literature|literatur|literaturverzeichnis|quellen|quellenverzeichnis|referenzen|works cited)\s*:?$/i;
/** A heading that ends the references (an appendix after them). */
const END_HEADING = /^(?:[A-Z]\.?\s+|\d+\.?\s+)?(appendix|appendices|anhang|anh[äa]nge|supplementary material|acknowledg(?:e)?ments?|danksagung)\b/i;
const MARKER = /^(\[\s*\d{1,4}\s*\]|\d{1,4}\s*\.(?=\s)|\(\d{1,4}\))\s*/;
// "J. Comp. Phys." continues a title's venue; initials only start an entry when a surname is followed by a comma, "and", "&" or "et al".
const SURNAME_START = /^(?:[A-ZÄÖÜ][\p{L}'’-]+(?:\s+(?:van|von|de|der|den|du|di|la|le))?,\s+(?:[A-Z]\.|[A-ZÄÖÜ][\p{L}]+)|[A-Z]\.\s?(?:[A-Z]\.\s?)*[A-ZÄÖÜ][\p{L}'’-]+(?:\s[A-ZÄÖÜ][\p{L}'’-]+)?(?=\s*(?:,|&|and\b|et al\b)))/u;
const ENDS_ENTRY = /(?:[.?!)\]"”]|\d)\s*$/;

/** The index (page, line) of the last line that is the heading of a references section, looking back from the end. */
export function findReferencesHeading(pages: readonly PageLines[]): { page: number; line: number } | null {
  for (let p = pages.length - 1; p >= 0; p--) {
    const lines = pages[p]!;
    for (let i = lines.length - 1; i >= 0; i--) {
      const t = lines[i]!.text.trim();
      if (t.length > 40 || !HEADING.test(t)) continue;
      // A heading is followed by text; a page's running header repeats on every page and is followed by nothing useful.
      const rest = lines.slice(i + 1).length + (pages[p + 1]?.length ?? 0);
      if (rest >= 2) return { page: p, line: i };
    }
  }
  return null;
}

interface Flat extends TextLine {
  page: number;
}

/** Page numbers and the like that stand alone between entries. */
function isNoise(t: string): boolean {
  return /^\d{1,4}$/.test(t) || /^(page|seite|s\.)\s*\d+/i.test(t) || t.length < 2;
}

/** The entries of the references section, or an empty list if the PDF has none. */
export function parseBibliography(pages: readonly PageLines[]): ParsedEntry[] {
  const at = findReferencesHeading(pages);
  if (!at) return [];
  const flat: Flat[] = [];
  for (let p = at.page; p < pages.length; p++) {
    const lines = pages[p]!;
    for (let i = p === at.page ? at.line + 1 : 0; i < lines.length; i++) {
      const l = lines[i]!;
      const t = l.text.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (END_HEADING.test(t) && t.length < 60) {
        p = pages.length;
        break;
      }
      if (isNoise(t)) continue;
      flat.push({ ...l, text: t, page: p });
    }
  }
  if (flat.length === 0) return [];

  // Left margin of the section; a hanging indent (first lines out, the rest in) tells entries apart.
  const xs = flat.map((l) => l.x).sort((a, b) => a - b);
  const left = xs[Math.floor(xs.length * 0.1)]!;
  const tol = 0.012;
  const indented = flat.filter((l) => l.x > left + tol).length / flat.length;
  const hanging = indented > 0.3;
  const markers = flat.filter((l) => MARKER.test(l.text)).length;
  const numbered = markers >= Math.max(2, flat.length * 0.15);

  const entries: ParsedEntry[] = [];
  let cur: { start: Flat; marker: string | null; parts: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = joinLines(cur.parts).slice(0, MAX_ENTRY_TEXT);
    if (text.length >= 12) entries.push({ pageIndex: cur.start.page, y: clamp01(cur.start.y), marker: cur.marker, text });
    cur = null;
  };
  let prev: Flat | null = null;
  for (const l of flat) {
    const m = MARKER.exec(l.text);
    let starts: boolean;
    if (!cur || !prev) starts = true;
    else if (numbered) starts = !!m;
    else if (hanging) starts = l.x <= left + tol && ENDS_ENTRY.test(prev.text);
    else starts = ENDS_ENTRY.test(prev.text) && SURNAME_START.test(l.text);
    if (starts) {
      flush();
      cur = { start: l, marker: m ? m[1]!.replace(/\s+/g, '') : null, parts: [m ? l.text.slice(m[0].length) : l.text] };
    } else cur!.parts.push(l.text);
    prev = l;
  }
  flush();
  // A section with a single entry is more likely a false hit (a heading in the text) than a bibliography.
  return entries.length >= 2 ? entries.slice(0, MAX_BIB_ENTRIES) : [];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Joins the lines of an entry, mending words broken with a hyphen at the end of a line (but not in "well-known" style compounds at a break). */
export function joinLines(lines: readonly string[]): string {
  let out = '';
  for (const l of lines) {
    if (!out) out = l;
    else if (/[a-zäöü]-$/.test(out) && /^[a-zäöü]/.test(l)) out = out.slice(0, -1) + l;
    else out += ' ' + l;
  }
  return out.trim();
}

const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
const URL_RE = /\bhttps?:\/\/[^\s"<>]+/i;
const trimEnd = (s: string) => s.replace(/[.,;:)\]}'’”]+$/, '');

/** What can be read from an entry's text; whatever is unsure stays empty, the raw text is always kept. */
export function workFields(text: string): WorkFields {
  const doi = trimEnd(DOI.exec(text)?.[1] ?? '');
  const urlRaw = URL_RE.exec(text)?.[0] ?? '';
  const url = urlRaw && !/doi\.org\//i.test(urlRaw) ? trimEnd(urlRaw) : '';
  // Without the addresses, so digits in a DOI are not taken for a year.
  const bare = text.replace(URL_RE, ' ').replace(DOI, ' ');
  const years = [...bare.matchAll(/(?<![\d/])((?:19|20)\d{2})[a-z]?(?![\d])/g)];
  const yearMatch = years.find((m) => /\(\s*$/.test(bare.slice(Math.max(0, m.index! - 3), m.index)) || /[.,]\s*$/.test(bare.slice(Math.max(0, m.index! - 2), m.index))) ?? years[years.length - 1];
  const year = yearMatch ? Number(yearMatch[1]) : null;

  // Authors up to the first sentence end that is not an initial ("J."), or up to "(year)".
  const sentences = splitSentences(bare);
  let authors = '';
  let rest = sentences;
  // IEEE style: Authors, "Title," Venue, year.
  const quoted = /^(.*?),?\s*[“"„]([^”"“]{8,300}?)[,.]?[”"“]\s*,?\s*(.*)$/s.exec(bare);
  if (quoted && quoted[1]!.length < 250) {
    return {
      title: quoted[2]!.trim().slice(0, 300),
      authors: quoted[1]!.trim().replace(/[,.:]$/, '').slice(0, 400),
      year,
      venue: quoted[3]!.replace(/\b(?:19|20)\d{2}[a-z]?\.?\s*$/, '').replace(/^(in|published in)[:\s]+/i, '').replace(/[\s,.;]+$/, '').slice(0, 300),
      doi,
      url,
    };
  }
  const paren = /^(.*?)\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.?\s*(.*)$/s.exec(bare);
  if (paren && paren[1]!.length < 250) {
    authors = paren[1]!.trim().replace(/[.,:]$/, '');
    rest = splitSentences(paren[2]!);
  } else if (sentences.length >= 2) {
    // IEEE without quotes (books): "G. Hutton, Programming in Haskell. Publisher, 2016": the authors, then the title.
    const person = String.raw`(?:[A-ZÄÖÜ]\.\s?)+[\p{L}'’-]+(?:\s[\p{L}'’-]+)?`;
    const lead = new RegExp(String.raw`^(${person}(?:,\s+(?:and\s+)?${person})*),\s+(?:and\s+${person},\s+)?(\S.*)$`, 'u').exec(sentences[0]!);
    if (lead) {
      authors = lead[1]!;
      rest = [lead[2]!, ...sentences.slice(1)];
    } else {
      authors = sentences[0]!;
      rest = sentences.slice(1);
    }
  }
  const title = (rest[0] ?? '').replace(/^["“„']|["”“']$/g, '').trim();
  const venue = rest
    .slice(1)
    .join(' ')
    .replace(/^(in|published in)[:\s]+/i, '')
    .replace(/[\s,.;]+$/, '')
    .trim();
  return { title: title.slice(0, 300), authors: authors.slice(0, 400), year, venue: venue.slice(0, 300), doi, url };
}

/** Below this, an entry's fields are not trusted and the raw text is shown instead. */
export const MIN_CONFIDENCE = 0.6;

const PERSON_LIKE = /^(?:[A-ZÄÖÜ][\p{L}'’-]+,\s+(?:[A-Z]\.\s?)+|(?:[A-Z]\.\s?)+[A-ZÄÖÜ][\p{L}'’-]+)(?:\s*(?:,|&|and\b|;)|$)/u;

/** How far the fields read from an entry can be trusted (0-1): 0 for a title that is a number, a page range, authors. */
export function fieldsConfidence(f: WorkFields): number {
  const title = f.title.trim();
  const letters = (title.match(/\p{L}/gu) ?? []).length;
  if (letters < 3) return 0;
  let c = 1;
  if (/^[\s,;:.\d–-]/.test(title) || /^\p{Ll}/u.test(title)) c -= 0.5;
  if (/^(vol|no|nr|pages?|pp?|issue|band|heft)\b\.?/i.test(title) || /\b\d+\s*,\s*(no|vol)\.?$/i.test(title)) c -= 0.6;
  if (PERSON_LIKE.test(title)) c -= 0.5;
  if (letters < 8) c -= 0.3;
  if (!f.authors) c -= 0.2;
  else if (f.authors === title) c -= 0.5;
  if (f.year === null) c -= 0.15;
  if (!f.venue && !f.doi && !f.url) c -= 0.1;
  if (/^(?:\d+|vol\.?|no\.?|pp?\.?)$/i.test(f.venue)) c -= 0.2;
  return Math.max(0, Math.round(c * 100) / 100);
}

/** Sentences, where a period after a single capital letter ("J.") or an abbreviation does not end one. */
function splitSentences(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /([.?!])["”]?\s+(?=[A-ZÄÖÜ"“„\d])/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const before = s.slice(start, m.index);
    const lastWord = /(\S+)$/.exec(before)?.[1] ?? '';
    if (m[1] === '.' && (/^[A-ZÄÖÜ]$/.test(lastWord) || /^(et|al|vol|no|pp|ed|eds|Proc|Int|J|Trans|Conf|St|Dr|Comp|Phys|Rev|Lett|Appl|Math|Sci|Soc|Res|Eng|Syst|Anal|Inf|Technol|Vol|No|Pp)$/.test(lastWord))) continue;
    out.push(s.slice(start, m.index + 1).trim());
    start = m.index + m[0].length;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out.map((x) => x.replace(/[.]$/, '').trim()).filter(Boolean);
}

/** Lower case, letters and digits only: the key two spellings of one title share. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** The entry a link target (page index, height 0-1) points into: the last entry that starts at or above it. */
export function entryAt(entries: readonly { pageIndex: number; y: number }[], pageIndex: number, y: number | null): number {
  let found = -1;
  const tolerance = 0.02;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.pageIndex < pageIndex || (e.pageIndex === pageIndex && (y === null ? true : e.y <= y + tolerance))) found = i;
    else break;
  }
  if (found < 0) return -1;
  // A target on a page before the entries began (or far above the first one) is no entry.
  const first = entries[0]!;
  if (pageIndex < first.pageIndex) return -1;
  return found;
}

/** Splits an entry's text in two at a character offset; both halves must have text. */
export function splitEntry(text: string, at: number): [string, string] | null {
  const a = text.slice(0, at).trim();
  const b = text.slice(at).trim();
  return a && b ? [a, b] : null;
}

/** The key two spellings of one DOI share. */
export function normalizeDoi(s: string): string {
  return s.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').trim();
}

/**
 * The keys under which a work may be the same as another: its DOI, or its title together with its year (a title of
 * at least 8 letters and digits, and a year). Two works sharing a key look like one work.
 */
export function workKeys(w: Pick<WorkFields, 'title' | 'year' | 'doi'>): string[] {
  const keys: string[] = [];
  const doi = normalizeDoi(w.doi);
  if (doi) keys.push(`doi:${doi}`);
  const title = normalizeTitle(w.title);
  if (title.length >= 8 && w.year !== null) keys.push(`title:${title}:${w.year}`);
  return keys;
}

/** A work another one looks like, with what the student needs to decide. */
export interface SimilarWork {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  /** How many PDFs cite it. */
  cited: number;
}

/** An entry as stored and shown (one per citing PDF and reference). */
export interface BibEntry {
  id: string;
  resource: string;
  version: string;
  position: number;
  text: string;
  pageIndex: number;
  y: number;
  /** Where the PDF cites it: page index and height of the link. */
  citedAt: { pageIndex: number; y: number }[];
  work: Work;
  /** Works in the library that look like this one (same DOI, or same title and year) and were not kept separate. */
  similar: SimilarWork[];
}

/** A work in the student's library; one per distinct reference, shared by the PDFs that cite it. */
export interface Work extends WorkFields {
  id: string;
  raw: string;
  wantToRead: boolean;
  /** A material of the student's that is this work, once linked. */
  resource: string | null;
  createdAt: number;
  updatedAt: number;
  /** How far the fields can be trusted (0-1); below `MIN_CONFIDENCE` show `raw` only. Entries imported from BibTeX are 1. */
  confidence: number;
  /** Where the fields came from: '' read from the entry's text, 'crossref' looked up online. */
  source: '' | 'crossref';
}

/** What the client sends when it (re)stores the entries of a PDF: ids are kept for entries that stay. */
export interface BibEntryInput {
  id?: string | undefined;
  text: string;
  pageIndex: number;
  y: number;
  citedAt: { pageIndex: number; y: number }[];
}

/** A work of the library page: who cites it, and what it looks like. */
export interface LibraryWork extends Work {
  citedBy: { resource: string; title: string; count: number }[];
  similar: SimilarWork[];
}

/** A work read from a pasted or uploaded BibTeX/Hayagriva text, with the library's works it looks like. */
export interface ImportCandidate extends WorkFields {
  raw: string;
  similar: SimilarWork[];
}

export interface ImportPreview {
  format: 'bibtex' | 'hayagriva' | null;
  items: ImportCandidate[];
}

/** What the student decided for one candidate: add it, or (`into`) fill the library's work with it. Skipped ones are not sent. */
export interface ImportChoice extends WorkFields {
  raw: string;
  into?: string | null | undefined;
}
