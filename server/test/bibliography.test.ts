import { describe, expect, it } from 'vitest';
import { MIN_CONFIDENCE, entryAt, fieldsConfidence, joinLines, linesOf, parseBibliography, splitEntry, workFields, type PageLines } from '@wb/shared';

/** Lines of a page: `[x, text]` pairs placed evenly down the page. */
const page = (rows: [number, string][]): PageLines => rows.map(([x, text], i) => ({ x, text, y: 0.1 + (i * 0.8) / Math.max(1, rows.length) }));
const body = page([[0.1, 'Some ordinary text of the paper.'], [0.1, 'More text follows here and goes on.']]);

describe('references section', () => {
  it('splits numbered entries ([1] style) across a page break and mends hyphenated words', () => {
    const p1 = page([
      [0.1, 'References'],
      [0.1, '[1] A. Colmerauer. Prolog and infinite trees. In Logic Programming, pages 231-251. Aca-'],
      [0.13, 'demic Press, 1982.'],
      [0.1, '[2] J. A. Robinson. A machine-oriented logic based on the resolution principle. J. ACM, 12(1):23-41, 1965.'],
    ]);
    const p2 = page([
      [0.1, '[3] R. Kowalski. Predicate logic as programming language. IFIP Congress, 1974. doi:10.1000/xyz123.'],
      [0.13, '42'],
    ]);
    const e = parseBibliography([body, p1, p2]);
    expect(e.map((x) => x.marker)).toEqual(['[1]', '[2]', '[3]']);
    expect(e[0]!.text).toContain('Academic Press, 1982.');
    expect(e[2]!.pageIndex).toBe(2);
    expect(e[1]!.pageIndex).toBe(1);
  });

  it('splits author-year entries by hanging indent', () => {
    const p = page([
      [0.1, 'Literatur'],
      [0.1, 'Bratko, I. (2012). Prolog Programming for Artificial Intelligence. Pearson, 4th edition.'],
      [0.1, 'Hutton, G. (2016). Programming in Haskell. Cambridge University Press, 2nd edition.'],
      [0.1, 'Thompson, S. (2011). Haskell: The Craft of Functional Programming. Addison-Wesley.'],
    ]);
    // No indentation at all: falls back to the "Surname, I." start.
    expect(parseBibliography([body, p]).map((x) => x.text.slice(0, 6))).toEqual(['Bratko', 'Hutton', 'Thomps']);
    const hanging = page([
      [0.1, 'Bibliography'],
      [0.1, 'Bratko, I. (2012). Prolog Programming for'],
      [0.13, 'Artificial Intelligence. Pearson.'],
      [0.1, 'hutton g (2016). Programming in Haskell.'],
      [0.13, 'Cambridge University Press.'],
      [0.1, 'Thompson, S. (2011). Haskell: The Craft of'],
      [0.13, 'Functional Programming. Addison-Wesley.'],
    ]);
    const e = parseBibliography([body, hanging]);
    expect(e).toHaveLength(3);
    expect(e[1]!.text).toBe('hutton g (2016). Programming in Haskell. Cambridge University Press.');
  });

  it('stops at an appendix and finds nothing in a paper without references', () => {
    const p = page([
      [0.1, 'References'],
      [0.1, '[1] First, A. Title one. Venue, 2001.'],
      [0.1, '[2] Second, B. Title two. Venue, 2002.'],
      [0.1, 'A Appendix'],
      [0.1, '[3] Not an entry of the list. Venue, 2003.'],
    ]);
    expect(parseBibliography([p]).map((x) => x.marker)).toEqual(['[1]', '[2]']);
    expect(parseBibliography([body])).toEqual([]);
  });

  it('is not fooled by a running header that says "References" on every page', () => {
    const header = (t: string): PageLines => page([[0.1, 'References'], [0.1, t]]);
    expect(parseBibliography([header('text'), header('more')])).toEqual([]);
  });
});

describe('reading an entry', () => {
  it('reads author-year, DOI and URL', () => {
    const f = workFields('Hutton, G. (2016). Programming in Haskell. Cambridge University Press. https://doi.org/10.1017/CBO9781316784099');
    expect(f).toMatchObject({ authors: 'Hutton, G', year: 2016, title: 'Programming in Haskell', doi: '10.1017/CBO9781316784099', url: '' });
  });

  it('reads a numeric-style entry and does not take digits of a DOI for a year', () => {
    const f = workFields('A. Colmerauer. Prolog and infinite trees. In Logic Programming, pages 231-251, 1982. doi:10.1234/2005.99');
    expect(f.year).toBe(1982);
    expect(f.authors).toBe('A. Colmerauer');
    expect(f.title).toBe('Prolog and infinite trees');
    expect(f.doi).toBe('10.1234/2005.99');
  });

  it('keeps initials inside the author list', () => {
    const f = workFields('J. A. Robinson and K. Clark. A machine-oriented logic. J. ACM, 1965.');
    expect(f.authors).toBe('J. A. Robinson and K. Clark');
    expect(f.title).toBe('A machine-oriented logic');
  });

  it('keeps a plain URL', () => {
    expect(workFields('Foo, B. Bar baz. Online. http://example.org/x/y, 2020.').url).toBe('http://example.org/x/y');
  });
});

describe('link targets and fixes', () => {
  const entries = [{ pageIndex: 5, y: 0.2 }, { pageIndex: 5, y: 0.5 }, { pageIndex: 6, y: 0.1 }];
  it('finds the entry a destination points into', () => {
    expect(entryAt(entries, 5, 0.5)).toBe(1);
    expect(entryAt(entries, 5, 0.3)).toBe(0);
    expect(entryAt(entries, 6, 0.9)).toBe(2);
    expect(entryAt(entries, 4, 0.9)).toBe(-1);
  });
  it('splits at an offset, never into an empty half', () => {
    expect(splitEntry('Alpha. Beta.', 7)).toEqual(['Alpha.', 'Beta.']);
    expect(splitEntry('Alpha.', 0)).toBeNull();
    expect(joinLines(['a-', 'b', 'c'])).toBe('ab c');
    expect(joinLines(['dis-', 'tance'])).toBe('distance');
  });
});

describe('lines from text items', () => {
  it('joins the pieces of a baseline and keeps reading order', () => {
    const it = (str: string, x: number, y: number, w = 0.05) => ({ str, x, y, w, h: 0.01 });
    const lines = linesOf([it('world', 0.2, 0.1), it('second', 0.1, 0.2), it('Hello', 0.1, 0.1), it('!', 0.25, 0.101, 0.01)]);
    expect(lines.map((l) => l.text)).toEqual(['Hello world!', 'second']);
    expect(lines[0]!.x).toBe(0.1);
  });
});

describe('stored bibliography', () => {
  it('keeps works across a re-read, merges and splits, and drops the ones nobody needs', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { buildApp } = await import('../src/api/app.js');
    const { makeDeps } = await import('../src/api/deps.js');
    const { loadConfig } = await import('../src/config.js');
    const { CourseManager } = await import('../src/courses/manager.js');
    const { SessionPool } = await import('../src/runners/pool.js');
    const { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB } = await import('./helpers.js');
    const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-bib-')) } as NodeJS.ProcessEnv), port: 0 };
    const courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    const app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
    try {
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
      const up = await app.inject({ method: 'POST', url: `/api/resources/upload?${new URLSearchParams({ filename: 'P.pdf', title: 'P', type: 'paper' })}`, headers: { 'content-type': 'application/octet-stream' }, payload: pdf });
      const id = (up.json() as { id: string }).id;
      const version = 'a'.repeat(64);
      const put = async (entries: unknown[]) => (await app.inject({ method: 'PUT', url: `/api/resources/${id}/bibliography`, payload: { version, entries } })).json() as { id: string; text: string; work: { id: string; title: string; year: number | null; wantToRead: boolean } }[];
      const e = (text: string, i: number, extra: object = {}) => ({ text, pageIndex: 3, y: 0.1 * (i + 1), citedAt: [{ pageIndex: 1, y: 0.4 }], ...extra });
      const first = await put([e('Hutton, G. (2016). Programming in Haskell. CUP.', 0), e('Bratko, I. (2012). Prolog Programming. Pearson.', 1)]);
      expect(first.map((x) => [x.work.title, x.work.year])).toEqual([['Programming in Haskell', 2016], ['Prolog Programming', 2012]]);
      await app.inject({ method: 'PUT', url: `/api/works/${first[0]!.work.id}/want`, payload: { want: true } });
      // Tags on a work show in the library and go when the work does.
      const tag = (await app.inject({ method: 'POST', url: '/api/tags', payload: { name: 'Reading list' } })).json() as { id: string };
      expect((await app.inject({ method: 'PUT', url: `/api/tags/on/work/${first[1]!.work.id}`, payload: { ids: [tag.id] } })).statusCode).toBe(200);
      const lib = (await app.inject({ method: 'GET', url: '/api/works' })).json() as { id: string; tags: string[] }[];
      expect(lib.find((w) => w.id === first[1]!.work.id)!.tags).toEqual([tag.id]);
      expect(lib.find((w) => w.id === first[0]!.work.id)!.tags).toEqual([]);
      // A re-read with the same texts (a new version of the file): same works. A fixed text under a known id keeps the work too.
      const again = await put([e('Bratko, I. (2012). Prolog Programming. Pearson.', 0), e('Hutton, G. (2017). Programming in Haskell. CUP.', 1, { id: first[0]!.id })]);
      expect(again[0]!.work.id).toBe(first[1]!.work.id);
      expect(again[1]!.work).toMatchObject({ id: first[0]!.work.id, year: 2017, wantToRead: true });
      // Dropping an entry takes its work along, unless the student wants to read it.
      const fewer = await put([e('Hutton, G. (2017). Programming in Haskell. CUP.', 0, { id: again[1]!.id })]);
      expect(fewer).toHaveLength(1);
      const none = await put([]);
      expect(none).toEqual([]);
      const wanted = (await app.inject({ method: 'PUT', url: `/api/works/${first[0]!.work.id}/want`, payload: { want: false } })).statusCode;
      expect(wanted).toBe(200);
      expect((await app.inject({ method: 'PUT', url: '/api/works/nope/want', payload: { want: true } })).statusCode).toBe(404);
    } finally {
      await app.close();
      courses.close();
    }
  });
});

describe('IEEE style without quotes', () => {
  it('reads authors, then the title of a book', () => {
    expect(workFields('G. Hutton, Programming in Haskell. Cambridge University Press, 2016.')).toMatchObject({ authors: 'G. Hutton', title: 'Programming in Haskell', year: 2016 });
    expect(workFields('I. Bratko, Prolog Programming for Artificial Intelligence. Pearson, 2012.')).toMatchObject({ authors: 'I. Bratko', title: 'Prolog Programming for Artificial Intelligence' });
    expect(workFields('A. B. Smith, C. Jones, and D. Lee, Logic, Programs and Proofs. MIT Press, 2001.')).toMatchObject({ authors: 'A. B. Smith, C. Jones, and D. Lee', title: 'Logic, Programs and Proofs' });
  });
});

describe('IEEE style', () => {
  it('reads a quoted title', () => {
    const f = workFields('J. A. Robinson, “A machine-oriented logic based on the resolution principle,” Journal of the ACM, vol. 12, 1965.');
    expect(f).toMatchObject({ authors: 'J. A. Robinson', title: 'A machine-oriented logic based on the resolution principle', year: 1965, venue: 'Journal of the ACM, vol. 12' });
  });
});

describe('unsure entries', () => {
  const conf = (t: string) => fieldsConfidence(workFields(t));

  it('trusts well-formed entries', () => {
    expect(conf('Hutton, G. (2016). Programming in Haskell. Cambridge University Press.')).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(conf('A. Colmerauer. Prolog and infinite trees. In Logic Programming, pages 231-251, 1982.')).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(conf('J. A. Robinson and K. Clark. A machine-oriented logic. J. ACM, 1965.')).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });

  it('does not trust a bare year, a page range or a volume as the title', () => {
    expect(conf('2007')).toBeLessThan(MIN_CONFIDENCE);
    expect(conf('Smith, J. 2023')).toBeLessThan(MIN_CONFIDENCE);
    expect(conf('Smith, J. Foo. , 22-43')).toBeLessThan(MIN_CONFIDENCE);
    expect(conf('Miller, A. Something about trees. 45, No. 3. Vol. 12. 2026')).toBeLessThan(MIN_CONFIDENCE);
  });

  it('does not trust authors read as the title', () => {
    expect(conf('Smith, J., Jones, K. 2020. Pages 1-5.')).toBeLessThan(MIN_CONFIDENCE);
  });

  it('keeps a venue line starting with initials inside its entry', () => {
    const line = (text: string, y: number) => ({ text, x: 0.1, y });
    const pages = [[line('References', 0.1), line('K. Lee, M. Park. Droplet coalescence cascades.', 0.2), line('J. Comp. Phys. 12 (2020) 1-9.', 0.22), line('K. Lee. Another paper on things. Nature, 2019.', 0.26), line('J. Doe, K. Roe. Third paper here. Science, 2018.', 0.3)]];
    const entries = parseBibliography(pages);
    expect(entries.some((e) => e.text.includes('cascades. J. Comp. Phys.'))).toBe(true);
  });
});

describe('two-column pages', () => {
  const item = (str: string, x: number, y: number, w = 0.3) => ({ str, x, y, w, h: 0.012 });
  /** A page whose rows each hold a left and a right column text, as pdf.js reports them. */
  const twoColumns = (rows: [string, string][]) =>
    rows.flatMap(([l, r], i) => [item(l, 0.1, 0.1 + i * 0.02, 0.37), item(r, 0.55, 0.1 + i * 0.02, 0.35)].filter((x) => x.str));

  it('reads the left column, then the right one, instead of joining them on a baseline', () => {
    const rows: [string, string][] = Array.from({ length: 12 }, (_, i) => [`left ${i}`, `right ${i}`]);
    const lines = linesOf(twoColumns(rows));
    expect(lines.map((l) => l.text)).toEqual([...rows.map((r) => r[0]), ...rows.map((r) => r[1])]);
    expect(lines.filter((l) => l.col === 1)).toHaveLength(12);
  });

  it('keeps a line across both columns in place and a one-column page as it was', () => {
    const rows: [string, string][] = Array.from({ length: 10 }, (_, i) => [`left ${i}`, `right ${i}`]);
    const items = [item('A title across the whole page', 0.1, 0.05, 0.8), ...twoColumns(rows)];
    expect(linesOf(items)[0]!.text).toBe('A title across the whole page');
    const single = Array.from({ length: 12 }, (_, i) => item(`line ${i}`, 0.1, 0.1 + i * 0.02, 0.8));
    expect(linesOf(single).map((l) => l.text)).toEqual(single.map((i) => i.str));
  });

  it('parses a numbered bibliography in two columns', () => {
    const col = (text: string, x: number, y: number) => item(text, x, y, 0.35);
    const items = [
      ...Array.from({ length: 8 }, (_, i) => col(`ordinary text ${i} of the left column`, 0.1, 0.1 + i * 0.02)),
      col('References', 0.1, 0.5),
      col('[1] A. First. A very long title that is', 0.1, 0.52),
      col('broken over lines. Venue, 1990.', 0.12, 0.54),
      col('[2] B. Second. A title. Venue, 1995.', 0.1, 0.56),
      col('[3] A. Third. Another work that goes on', 0.55, 0.1),
      col('and ends here. Venue, 1999.', 0.57, 0.12),
      ...Array.from({ length: 7 }, (_, i) => col(`[${i + 4}] C. Other. Title ${i}. Venue, 200${i}.`, 0.55, 0.14 + i * 0.02)),
    ];
    const entries = parseBibliography([linesOf(items)]);
    expect(entries.map((e) => e.marker)).toEqual(['[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]', '[8]', '[9]', '[10]']);
    expect(entries[0]!.text).toBe('A. First. A very long title that is broken over lines. Venue, 1990.');
    expect(entries[2]!.text).toBe('A. Third. Another work that goes on and ends here. Venue, 1999.');
  });

  it('does not take "1992. Publisher" at a line start for the marker of a new entry', () => {
    const p = page([
      [0.1, 'References'],
      [0.1, '[1] First, A. Title one. Venue, October'],
      [0.1, '1992. IEEE CS Press.'],
      [0.1, '[2] Second, B. Title two. Venue, 2002.'],
    ]);
    const e = parseBibliography([p]);
    expect(e).toHaveLength(2);
    expect(e[0]!.text).toContain('October 1992. IEEE CS Press.');
    const bare = page([[0.1, 'References'], [0.1, '1. First, A. Title one. Venue, 2001.'], [0.1, '2. Second, B. Title two. Venue, 2002.']]);
    expect(parseBibliography([bare])).toHaveLength(2);
  });

  it('keeps compound words, page ranges and author lists of several names whole', () => {
    expect(joinLines(['Two-', 'dimensional simulation', 'pages 471–', '483, SIG-', 'GRAPH', 'Introduc-', 'tion'])).toBe('Two-dimensional simulation pages 471–483, SIGGRAPH Introduction');
    const f = workFields('J. X. Chen, N. da Vittoria Lobo, C. E. Hughes, and J. M. Moshell. Real-Time Fluid Simulation. IEEE CG&A, pages 52–61, 1997.');
    expect(f.authors).toBe('J. X. Chen, N. da Vittoria Lobo, C. E. Hughes, and J. M. Moshell');
    expect(f.title).toBe('Real-Time Fluid Simulation');
  });

  it('skips figure captions that follow the references', () => {
    const p = page([
      [0.1, 'References'],
      [0.1, '[1] First, A. Title one. Venue, 2001.'],
      [0.1, '[2] Second, B. Title two. Venue, 2002.'],
      [0.1, '(a) (b) (c)'],
      [0.1, 'Figure 4: Snapshots from our solver.'],
    ]);
    expect(parseBibliography([p])[1]!.text).toBe('Second, B. Title two. Venue, 2002.');
  });

  it('reads the ACM reference format', () => {
    const f = workFields('Daniela Anderl, Simon Bogner, and Antonio Delgado. 2014. Free surface lattice Boltzmann with enhanced bubble model. Computers & Mathematics with Applications 67, 2, 331–339.');
    expect(f.authors).toBe('Daniela Anderl, Simon Bogner, and Antonio Delgado');
    expect(f.title).toBe('Free surface lattice Boltzmann with enhanced bubble model');
    expect(f.year).toBe(2014);
    expect(fieldsConfidence(f)).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });
});
