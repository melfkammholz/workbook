import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db/migrations.js';
import { itemOfTarget, locateQuote, quoteAt, targetHref } from '@wb/shared';
import { htmlOfPart, isPart, textOfHtml } from '../src/annotations.js';
import { Store } from '../src/db/store.js';

describe('finding a quote again', () => {
  const text = 'Ein Typ ist eine Menge. Ein Typ ist auch ein Versprechen.';

  it('finds the same place it was taken from, also among repeats', () => {
    const second = text.lastIndexOf('Ein Typ');
    const q = quoteAt(text, second, second + 7)!;
    expect(q.quote).toBe('Ein Typ');
    expect(locateQuote(text, q)).toEqual({ start: second, end: second + 7 });
    const first = quoteAt(text, 0, 7)!;
    expect(locateQuote(text, first)).toEqual({ start: 0, end: 7 });
  });

  it('ignores how whitespace is laid out', () => {
    const laid = 'Ein   Typ\n ist eine\tMenge.';
    const q = quoteAt('Ein Typ ist eine Menge.', 4, 16)!;
    expect(q.quote).toBe('Typ ist eine');
    const at = locateQuote(laid, q)!;
    expect(laid.slice(at.start, at.end)).toBe('Typ\n ist eine');
  });

  it('still finds a quote whose surroundings changed, and nothing once it is gone', () => {
    const q = quoteAt(text, 12, 22)!;
    expect(locateQuote('Ganz anders: eine Menge.', q)).not.toBeNull();
    expect(locateQuote('Ganz anders.', q)).toBeNull();
    expect(quoteAt(text, 3, 4)).toBeNull();
  });
});

describe('the text that can be highlighted', () => {
  it('leaves out code blocks, math, widgets and buttons, like the browser', () => {
    const html = '<p>Erst <code>map</code> &amp; dann</p><pre><code>f x = x</code><button>c</button></pre><math><mi>x</mi></math><div data-widget="quiz"><p>Frage</p></div><p>Ende</p>';
    expect(textOfHtml(html)).toBe('Erst map & dannEnde');
  });

  it('knows the parts of a rendered text', () => {
    const r = { task: 't', remarks: ['r0'], hints: ['h0', 'h1'] };
    expect(htmlOfPart(r, 'task')).toBe('t');
    expect(htmlOfPart(r, 'hint-1')).toBe('h1');
    expect(htmlOfPart(r, 'remark-3')).toBeNull();
    expect(isPart('remark-0')).toBe(true);
    expect(isPart('solution')).toBe(false);
  });

  it('links a target to where it is read', () => {
    expect(targetHref('chapter/typen')).toBe('/chapter/typen');
    expect(targetHref('thread/ableitungen')).toBe('/adventure/ableitungen');
    expect(targetHref('landing')).toBe('/welcome');
    expect(itemOfTarget('strong-typing')).toBe('strong-typing');
    expect(itemOfTarget('chapter/typen')).toBeNull();
  });
});

describe('"come back to" is a question', () => {
  it('opens, resolves, reopens and clears an empty question; the question outlives the highlight', () => {
    const s = new Store(':memory:');
    const a = s.addAnnotation({ target: 'x', part: 'task', quote: 'Typklasse', prefix: 'die ', suffix: ' ist', color: 'pink' });
    expect(a.review).toBeNull();
    expect(s.listQuestions()).toEqual([]);
    expect(s.updateAnnotation(a.id, { review: 'open' })!.review).toBe('open');
    expect(s.listQuestions()).toEqual([expect.objectContaining({ text: '', status: 'open', highlightId: a.id, anchor: expect.objectContaining({ kind: 'text', target: 'x', quote: 'Typklasse' }) })]);
    expect(s.updateAnnotation(a.id, { review: 'resolved' })!.review).toBe('resolved');
    expect(s.listQuestions()[0]).toMatchObject({ status: 'done' });
    expect(s.resolvedMarkCount()).toBe(1);
    // Resolving it as a question shows on the highlight.
    s.updateQuestion(s.listQuestions()[0]!.id, { status: 'open' });
    expect(s.getAnnotation(a.id)!.review).toBe('open');
    expect(s.updateAnnotation(a.id, { review: null })!.review).toBeNull();
    expect(s.listQuestions()).toEqual([]);
    s.updateAnnotation(a.id, { review: 'open' });
    s.deleteAnnotation(a.id);
    expect(s.listQuestions()).toHaveLength(1);
    s.close();
  });
});

describe('migration 19', () => {
  it('turns review marks of highlights and pages into questions and drops the columns', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mig-')), 'workbook.db');
    const db = new DatabaseSync(file);
    for (const step of MIGRATIONS.slice(0, 18)) typeof step === 'string' ? db.exec(step) : step(db);
    db.exec(`PRAGMA user_version = 18;
      INSERT INTO annotations (course, id, target, part, quote, prefix, suffix, color, comment, review, created_at, updated_at) VALUES ('c','a1','x','task','q','','','pink','','open',1,2), ('c','a2','x','task','r','','','pink','','resolved',1,2), ('c','a3','x','task','s','','','pink','','',1,2);
      INSERT INTO resources (id, title, type, created_at, updated_at) VALUES ('r1','T','notes',1,1);
      INSERT INTO pdf_annotations (id, resource, version, page_index, rects, quote, color, review, created_at, updated_at) VALUES ('h1','r1','v',3,'[]','zitat','pink','open',1,2);
      INSERT INTO pdf_pages (id, resource, version, page_index, fingerprint, review, created_at, updated_at) VALUES ('p1','r1','v',3,'fp','resolved',1,2);`.replace("'a3','x','task','s','','','pink','','',1,2", "'a3','x','task','s','','','pink','',NULL,1,2"));
    db.close();
    const s = new Store(file);
    const qs = s.listQuestions();
    expect(qs).toHaveLength(4);
    expect(qs.every((q) => q.text === '')).toBe(true);
    const by = (id: string) => qs.find((q) => q.highlightId === id);
    expect(by('a1')).toMatchObject({ status: 'open', course: 'c', anchor: { kind: 'text', course: 'c', quote: 'q' } });
    expect(by('a2')).toMatchObject({ status: 'done' });
    expect(by('h1')).toMatchObject({ status: 'open', anchor: { kind: 'page', resource: 'r1', pageIndex: 3, fingerprint: 'fp', quote: 'zitat' } });
    expect(by('p1')).toMatchObject({ status: 'done', anchor: { kind: 'page', fingerprint: 'fp' } });
    for (const t of ['annotations', 'pdf_annotations', 'pdf_pages']) expect((s.sql.all(`PRAGMA table_info(${t})`) as { name: string }[]).map((c) => c.name)).not.toContain('review');
    s.close();
  });
});

describe('stored annotations', () => {
  it('are kept, changed and searched, and a reset of the course keeps them', () => {
    const s = new Store(':memory:');
    const a = s.addAnnotation({ target: 'x', part: 'task', quote: 'Typklasse', prefix: '', suffix: '', color: 'pink', comment: 'Wie bei Interfaces?' });
    expect(s.updateAnnotation(a.id, { review: 'open' })).toMatchObject({ review: 'open', comment: 'Wie bei Interfaces?' });
    expect(s.search('interfaces')).toEqual([expect.objectContaining({ exerciseId: 'x', source: 'annotation' })]);
    s.resetWork();
    expect(s.listAnnotations()).toHaveLength(1);
    expect(s.search('interfaces')).toHaveLength(1);
    s.resetHighlights();
    expect(s.listAnnotations()).toEqual([]);
    expect(s.search('interfaces')).toEqual([]);
    s.close();
  });
});
