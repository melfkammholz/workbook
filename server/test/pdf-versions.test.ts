import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageFingerprint, pageText, quoteAt, reanchor, textItems, type PageText, type Reanchored, type StaleItems } from '@wb/shared';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB } from './helpers.js';

/** A small PDF: one page per entry, every line of text set in Helvetica 12 from the top. */
function makePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((lines, i) => {
    const content = `BT /F1 12 Tf 14 TL 50 740 Td ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const at: number[] = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((a) => `${String(a).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function read(pdf: Buffer): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 }).promise;
  const out: PageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    out.push(pageText(textItems((await page.getTextContent()).items, page.getViewport({ scale: 1 }))));
  }
  return out;
}

const v1 = [
  ['Einführung in die Logik', 'Aussagen sind wahr oder falsch.', 'Eine Formel ist erfüllbar, wenn es eine Belegung gibt.'],
  ['Resolution', 'Die Resolutionsregel erzeugt aus zwei Klauseln eine neue Klausel.', 'Sie ist korrekt und widerlegungsvollständig.'],
  ['Unifikation', 'Zwei Terme sind unifizierbar, wenn eine Substitution sie gleich macht.', 'Der allgemeinste Unifikator ist bis auf Umbenennung eindeutig.'],
];
// The second version has a new page in front, one rewritten page, and the first page untouched.
const v2 = [
  ['Vorwort', 'Dieses Skript wurde überarbeitet und erweitert.', 'Die Kapitel folgen der Vorlesung.'],
  v1[0]!,
  ['Resolution', 'Die Resolutionsregel erzeugt aus zwei Klauseln eine neue Klausel.', 'Sie ist korrekt und widerlegungsvollständig. Neu: Beispiele.'],
  ['Substitutionen', 'Etwas ganz anderes steht jetzt hier auf der Seite.', 'Der allgemeinste Unifikator ist bis auf Umbenennung eindeutig.'],
];

describe('placing items on a new version of a PDF', () => {
  it('finds highlights by quote and context, with new rectangles', async () => {
    const [old, next] = [await read(makePdf(v1)), await read(makePdf(v2))];
    const text = old[2]!.text;
    const start = text.indexOf('Zwei Terme sind unifizierbar');
    const q = quoteAt(text, start, start + 'Zwei Terme sind unifizierbar'.length)!;
    const stale: StaleItems = { version: 'v'.repeat(64), highlights: [{ id: 'h', pageIndex: 2, ...q }, { id: 'gone', pageIndex: 2, quote: 'Zwei Terme sind unifizierbar, wenn', prefix: '', suffix: '' }], pages: [], toc: [], questions: [] };
    const found = reanchor(stale, next);
    // The sentence was rewritten on the last page: only the one that is still there is found.
    expect(found.highlights[0]!.place).toBeNull();
    const kept = quoteAt(old[1]!.text, old[1]!.text.indexOf('Sie ist korrekt'), old[1]!.text.indexOf('Sie ist korrekt') + 'Sie ist korrekt'.length)!;
    const f2 = reanchor({ ...stale, highlights: [{ id: 'k', pageIndex: 1, ...kept }] }, next);
    const place = f2.highlights[0]!.place!;
    expect(place.pageIndex).toBe(2);
    expect(place.rects.length).toBeGreaterThan(0);
    // Third line of the page: baseline 712 of 792, so its top is a little under 0.09.
    expect(place.rects[0]!.y).toBeGreaterThan(0.07);
    expect(place.rects[0]!.y).toBeLessThan(0.12);
    expect(place.rects[0]!.x).toBeCloseTo(50 / 612, 2);
  });

  it('matches page items by fingerprint, else by similar text, and leaves the rest', async () => {
    const [old, next] = [await read(makePdf(v1)), await read(makePdf(v2))];
    const fp = (i: number) => pageFingerprint(old[i]!.text, i);
    const stale: StaleItems = {
      version: 'v'.repeat(64),
      highlights: [],
      pages: [
        { id: 'logic', pageIndex: 0, fingerprint: fp(0) },
        { id: 'resolution', pageIndex: 1, fingerprint: fp(1) },
        { id: 'unif', pageIndex: 2, fingerprint: fp(2) },
        { id: 'scan', pageIndex: 5, fingerprint: 'index:5' },
      ],
      toc: [{ id: 't', pageIndex: 0, fingerprint: fp(0) }],
      questions: [
        { id: 'q-sel', pageIndex: 1, fingerprint: fp(1), ...quoteAt(old[1]!.text, old[1]!.text.indexOf('Sie ist korrekt'), old[1]!.text.indexOf('Sie ist korrekt') + 'Sie ist korrekt'.length)! },
        { id: 'q-page', pageIndex: 0, fingerprint: fp(0), quote: '', prefix: '', suffix: '' },
        { id: 'q-lost', pageIndex: 2, fingerprint: fp(2), quote: '', prefix: '', suffix: '' },
      ],
    };
    const found = reanchor(stale, next);
    const at = (r: Reanchored, id: string) => r.pages.find((p) => p.id === id)!.pageIndex;
    expect(at(found, 'logic')).toBe(1);
    expect(at(found, 'resolution')).toBe(2);
    // The last page only shares one of its two lines (similarity far below 0.8).
    expect(at(found, 'unif')).toBeNull();
    expect(at(found, 'scan')).toBeNull();
    expect(found.toc[0]!.pageIndex).toBe(1);
    // A question follows its selection, else its page; one whose page is gone is left to the student.
    expect(found.questions.map((q) => q.pageIndex)).toEqual([2, 1, null]);
  });
});

let app: Awaited<ReturnType<typeof buildApp>>;
let courses: CourseManager;
let dataDir: string;
beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ver-'));
  const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
  courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
  app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
});
afterAll(async () => {
  await app.close();
  courses.close();
});

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const post = (url: string, body: Buffer) => app.inject({ method: 'POST', url, headers: { 'content-type': 'application/octet-stream' }, payload: body });

describe('new versions of a file', () => {
  it('replaces the file, moves what could be placed, lists the rest and lets the student fix or drop it', async () => {
    const a = makePdf(v1);
    const b = makePdf(v2);
    const created = (await post(`/api/resources/upload?${new URLSearchParams({ filename: 'Skript.pdf', title: 'Skript', type: 'notes' })}`, a)).json() as { id: string };
    const id = created.id;
    const old = await read(a);
    const next = await read(b);
    const put = (url: string, body: unknown) => app.inject({ method: 'PUT', url, payload: body as object });
    // A highlight on a sentence that stays, one on a sentence that goes; a note on a page that stays, one on a page that changes.
    const quote = (p: number, s: string) => quoteAt(old[p]!.text, old[p]!.text.indexOf(s), old[p]!.text.indexOf(s) + s.length)!;
    const rect = [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }];
    const add = (pageIndex: number, q: ReturnType<typeof quote>) => app.inject({ method: 'POST', url: `/api/resources/${id}/annotations`, payload: { version: sha(a), pageIndex, rects: rect, ...q, color: 'yellow' } });
    const stays = (await add(1, quote(1, 'Sie ist korrekt'))).json() as { id: string };
    const goes = (await add(2, quote(2, 'Zwei Terme sind unifizierbar'))).json() as { id: string };
    await put(`/api/resources/${id}/pages/0`, { version: sha(a), fingerprint: pageFingerprint(old[0]!.text, 0), note: 'Logik' });
    await put(`/api/resources/${id}/pages/2`, { version: sha(a), fingerprint: pageFingerprint(old[2]!.text, 2), note: 'Unifikation' });

    // Questions on pages: one with a selection that stays, one on a page that moves, one on a page that changes.
    const ask = (pageIndex: number, text: string, q?: ReturnType<typeof quote>) =>
      app.inject({ method: 'POST', url: '/api/questions', payload: { text, page: { resource: id, pageIndex, fingerprint: pageFingerprint(old[pageIndex]!.text, pageIndex), ...q } } });
    const qSel = (await ask(1, 'Warum korrekt?', quote(1, 'Sie ist korrekt'))).json() as { id: string; anchor: { version: string } };
    const qPage = (await ask(0, 'Was ist Logik?')).json() as { id: string };
    const qLost = (await ask(2, 'Was heißt eindeutig?')).json() as { id: string };
    expect(qSel.anchor.version).toBe(sha(a));
    expect(((await app.inject({ url: '/api/resources' })).json() as { resources: { stale: number; versions: number }[] }).resources[0]).toMatchObject({ stale: 0, versions: 1 });
    expect((await post(`/api/resources/${id}/version?filename=Skript.pdf`, a)).statusCode).toBe(409);
    const replaced = (await post(`/api/resources/${id}/version?filename=Skript2.pdf`, b)).json() as { file: { sha256: string; filename: string }; versions: number; stale: number };
    expect(replaced).toMatchObject({ file: { sha256: sha(b), filename: 'Skript2.pdf' }, versions: 2, stale: 7 });
    expect(fs.existsSync(path.join(dataDir, 'files', sha(a)))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'files', sha(b)))).toBe(true);

    const stale = (await app.inject({ url: `/api/resources/${id}/stale` })).json() as StaleItems;
    expect(stale.highlights).toHaveLength(2);
    expect(stale.questions).toHaveLength(3);
    const left = (await app.inject({ method: 'POST', url: `/api/resources/${id}/reanchor`, payload: reanchor(stale, next) })).json() as { highlights: { id: string }[]; pages: { id: string; note: string }[]; questions: { id: string }[] };
    expect(left.highlights.map((h) => h.id)).toEqual([goes.id]);
    expect(left.pages.map((p) => p.note)).toEqual(['Unifikation']);
    expect(left.questions.map((q) => q.id)).toEqual([qLost.id]);
    const placed = (await app.inject({ url: `/api/questions?resource=${id}` })).json() as { id: string; unplaced: boolean; anchor: { version: string; pageIndex: number } }[];
    expect(placed.map((q) => [q.id, q.anchor.pageIndex, q.anchor.version === sha(b), q.unplaced])).toEqual([
      [qSel.id, 2, true, false],
      [qPage.id, 1, true, false],
      [qLost.id, 2, true, true],
    ]);

    const list = (await app.inject({ url: `/api/resources/${id}/annotations` })).json() as { id: string; pageIndex: number; version: string }[];
    expect(list.map((x) => [x.id, x.pageIndex, x.version])).toEqual([[stays.id, 2, sha(b)]]);
    const pages = (await app.inject({ url: `/api/resources/${id}/pages` })).json() as { note: string; pageIndex: number }[];
    expect(pages.map((p) => [p.note, p.pageIndex])).toEqual([['Logik', 1]]);
    expect(((await app.inject({ url: '/api/resources' })).json() as { resources: { stale: number; unplaced: number }[] }).resources[0]).toMatchObject({ stale: 0, unplaced: 3 });

    // Fix: put the note on page 4 (a page that has none), and the highlight on a place of the student's choosing; then drop nothing left.
    const item = left.pages[0]! as { id: string };
    expect((await put(`/api/resources/${id}/unplaced/page/${item.id}`, { pageIndex: 1 })).statusCode).toBe(409);
    expect((await put(`/api/resources/${id}/unplaced/page/${item.id}`, { pageIndex: 3, fingerprint: 'x' })).statusCode).toBe(200);
    expect((await put(`/api/resources/${id}/unplaced/question/${qLost.id}`, { pageIndex: 3 })).statusCode).toBe(200);
    const fixed = (await put(`/api/resources/${id}/unplaced/highlight/${goes.id}`, { pageIndex: 3, rects: rect })).json() as { highlights: unknown[]; pages: unknown[]; questions: unknown[] };
    expect(fixed).toMatchObject({ highlights: [], pages: [], questions: [] });
    expect((await app.inject({ method: 'DELETE', url: `/api/resources/${id}/unplaced/question/${qLost.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/resources/${id}/unplaced/highlight/${goes.id}` })).statusCode).toBe(404);
    expect(((await app.inject({ url: `/api/resources/${id}/pages` })).json() as unknown[]).length).toBe(2);
  });
});
