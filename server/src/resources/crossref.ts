// Online lookup for references the parser is unsure about (opt-in setting `lookupReferences`). Only the text of the
// entry goes to Crossref; a hit is accepted only when its title and year match the text, else the entry stays raw.

import { normalizeTitle, normalizeDoi, type WorkFields } from '@wb/shared';

/** How much of a candidate title's words must be found in the entry's text to accept the hit (0-1). */
export const TITLE_MATCH = 0.9;
export const CROSSREF_URL = 'https://api.crossref.org/works';
export const LOOKUP_TIMEOUT_MS = 10_000;
/** Pause between two requests: one at a time, gently. */
export const LOOKUP_PAUSE_MS = 1500;

export type FetchFn = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { 'date-parts'?: (number | null)[][] };
  'container-title'?: string[];
}

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/** Does the candidate's title appear in the entry's text, and is its year one the text names? */
export function matchesEntry(text: string, item: CrossrefItem): boolean {
  const title = item.title?.[0]?.trim() ?? '';
  const year = item.issued?.['date-parts']?.[0]?.[0];
  if (normalizeTitle(title).length < 8 || !year) return false;
  const years = [...text.matchAll(/(?<![\d/])((?:19|20)\d{2})[a-z]?(?!\d)/g)].map((m) => Number(m[1]));
  if (!years.some((y) => Math.abs(y - year) <= 1)) return false;
  if (normalizeTitle(text).includes(normalizeTitle(title))) return true;
  const have = new Set(words(text));
  const tw = words(title);
  return tw.length >= 3 && tw.filter((w) => have.has(w)).length / tw.length >= TITLE_MATCH;
}

export function fieldsOf(item: CrossrefItem): WorkFields {
  const people = (item.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
  return {
    title: (item.title?.[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
    authors: (people.length > 8 ? [...people.slice(0, 8), 'et al.'].join(', ').replace(', et al.', ' et al.') : people.join(', ')).slice(0, 400),
    year: item.issued?.['date-parts']?.[0]?.[0] ?? null,
    venue: (item['container-title']?.[0] ?? '').slice(0, 300),
    doi: normalizeDoi(item.DOI ?? ''),
    url: '',
  };
}

/** The matching hit for an entry's text, null when there is none; throws when the service cannot be reached. */
export async function crossrefLookup(text: string, fetchFn: FetchFn): Promise<WorkFields | null> {
  const query = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  const url = `${CROSSREF_URL}?${new URLSearchParams({ 'query.bibliographic': query, rows: '3', select: 'DOI,title,author,issued,container-title' })}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctl.signal, headers: { 'user-agent': 'workbook-local', accept: 'application/json' } });
    if (!res.ok) throw new Error('crossref unavailable');
    const body = (await res.json()) as { message?: { items?: CrossrefItem[] } };
    const hit = (body.message?.items ?? []).find((i) => matchesEntry(text, i));
    return hit ? fieldsOf(hit) : null;
  } finally {
    clearTimeout(timer);
  }
}
