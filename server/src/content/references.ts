// A workbook's own literature: `references.bib` and/or `references.yml` (Hayagriva) at its root, read with the same
// parsers as the bibliography import. Keys are what `#cite-work("key")` names.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { WorkFields } from '@wb/shared';
import { fromBibtex, fromHayagriva } from '../resources/bibimport.js';

export interface CourseWork extends WorkFields {
  /** The key authors write in `#cite-work`. */
  key: string;
  /** The file it comes from, relative to the workbook. */
  file: string;
}

export const REFERENCE_FILES = ['references.bib', 'references.yml'] as const;

export interface References {
  works: CourseWork[];
  /** Messages for lint: errors and warnings about the files themselves. */
  problems: { severity: 'error' | 'warning'; file: string; message: string }[];
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function loadReferences(dir: string): References {
  const works: CourseWork[] = [];
  const problems: References['problems'] = [];
  const err = (file: string, message: string) => problems.push({ severity: 'error', file, message });
  const warn = (file: string, message: string) => problems.push({ severity: 'warning', file, message });
  const seen = new Map<string, string>();
  for (const file of REFERENCE_FILES) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    let text: string;
    try {
      text = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
    } catch (e) {
      err(file, `cannot read: ${(e as Error).message}`);
      continue;
    }
    let list;
    if (file.endsWith('.bib')) list = fromBibtex(text, true);
    else {
      try {
        YAML.parse(text, { maxAliasCount: 20 });
      } catch (e) {
        err(file, `invalid YAML (duplicate keys count): ${(e as Error).message}`);
        continue;
      }
      list = fromHayagriva(text, true);
    }
    for (const w of list) {
      if (!w.key) {
        err(file, 'an entry has no key');
        continue;
      }
      if (seen.has(w.key)) {
        err(file, `duplicate key "${w.key}" (also in ${seen.get(w.key)})`);
        continue;
      }
      seen.set(w.key, file);
      if (!w.title) err(file, `"${w.key}" has no title`);
      if (w.year === null) warn(file, `"${w.key}" has no year`);
      works.push({ title: w.title, authors: w.authors, year: w.year, venue: w.venue, doi: w.doi, url: w.url, key: w.key, file });
    }
  }
  // The same work under two keys.
  const byDoi = new Map<string, CourseWork>();
  const byTitle = new Map<string, CourseWork>();
  for (const w of works) {
    const doi = w.doi.toLowerCase();
    const tk = w.title && w.year !== null ? `${normTitle(w.title)}|${w.year}` : '';
    const other = (doi && byDoi.get(doi)) || (tk && byTitle.get(tk)) || null;
    if (other) warn(w.file, `"${w.key}" is the same work as "${other.key}" (same ${doi && byDoi.has(doi) ? 'DOI' : 'title and year'})`);
    if (doi && !byDoi.has(doi)) byDoi.set(doi, w);
    if (tk && !byTitle.has(tk)) byTitle.set(tk, w);
  }
  return { works, problems };
}

/** Keys named by `#cite-work("…")` in a text. */
export function citedKeys(typst: string): string[] {
  return [...typst.matchAll(/#?cite-work\s*\(\s*"([^"]*)"/g)].map((m) => m[1]!);
}

/** Typst source for the header: `_works` as a dictionary of what the prelude needs to show a citation. */
export function worksTypst(works: CourseWork[]): string {
  const q = (s: string) => JSON.stringify(s);
  const entries = works.map((w) => `${q(w.key)}: (title: ${q(w.title)}, authors: ${q(w.authors)}, year: ${w.year ?? 'none'}, venue: ${q(w.venue)}, doi: ${q(w.doi)}, url: ${q(w.url)})`);
  return `#let _works = (${entries.length ? entries.join(', ') : ':'})`;
}
