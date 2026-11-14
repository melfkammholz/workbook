import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/db/store.js';
import { Resources } from '../src/resources/service.js';
import { crossrefByDoi, doiOf, matchesEntry, type FetchFn } from '../src/resources/crossref.js';

const RAW = 'Wadler, P. Theorems for free! FPCA 1989, 347 359';
const item = { DOI: '10.1145/99370.99404', title: ['Theorems for free!'], author: [{ given: 'Philip', family: 'Wadler' }], issued: { 'date-parts': [[1989]] }, 'container-title': ['FPCA'] };

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function setup(items: unknown[], on: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-xref-'));
  dirs.push(dir);
  const store = new Store(path.join(dir, 'workbook.db'));
  if (on) store.saveSettings({ lookupReferences: true });
  const calls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ message: { items } }) };
  };
  const res = new Resources(store, dir, () => [], Date.now, fetchFn, 0);
  const add = (id: string, raw: string) => store.sql.run("INSERT INTO works (id, title, raw, created_at, updated_at) VALUES (?, '', ?, 1, 1)", id, raw);
  const work = (id: string) => store.sql.get('SELECT * FROM works WHERE id = ?', id)!;
  return { store, res, calls, add, work };
}

describe('matchesEntry', () => {
  it('needs the title in the text and a year the text names', () => {
    expect(matchesEntry(RAW, item)).toBe(true);
    expect(matchesEntry(RAW, { ...item, issued: { 'date-parts': [[2001]] } })).toBe(false);
    expect(matchesEntry(RAW, { ...item, title: ['Something else entirely'] })).toBe(false);
    expect(matchesEntry('Wadler Theorems for free', item)).toBe(false);
  });
});

describe('reference lookup', () => {
  it('fills a work the parser could not read and asks once', async () => {
    const { res, calls, add, work } = setup([item], true);
    add('w1', RAW);
    await res.startLookups();
    expect(work('w1')).toMatchObject({ title: 'Theorems for free!', authors: 'Philip Wadler', year: 1989, doi: '10.1145/99370.99404', source: 'crossref', confidence: 1 });
    await res.startLookups();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('query.bibliographic=');
  });

  it('keeps the entry raw without a matching hit and does not ask again', async () => {
    const { res, calls, add, work } = setup([{ ...item, title: ['Another paper about lambda'] }], true);
    add('w1', RAW);
    await res.startLookups();
    await res.startLookups();
    expect(work('w1')).toMatchObject({ title: '', source: '' });
    expect(calls).toHaveLength(1);
  });

  it('sends nothing while the setting is off', async () => {
    const { res, calls, add, work } = setup([item], false);
    add('w1', RAW);
    await res.startLookups();
    expect(calls).toHaveLength(0);
    expect(work('w1').source).toBe('');
  });

  it('stays silent when Crossref cannot be reached, and tries again later', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-xref-'));
    dirs.push(dir);
    const store = new Store(path.join(dir, 'workbook.db'));
    store.saveSettings({ lookupReferences: true });
    store.sql.run("INSERT INTO works (id, title, raw, created_at, updated_at) VALUES ('w1', '', ?, 1, 1)", RAW);
    let down = true;
    const fetchFn: FetchFn = async () => {
      if (down) throw new Error('offline');
      return { ok: true, json: async () => ({ message: { items: [item] } }) };
    };
    const res = new Resources(store, dir, () => [], Date.now, fetchFn, 0);
    await res.startLookups();
    expect(store.sql.get("SELECT source FROM works WHERE id = 'w1'")!.source).toBe('');
    down = false;
    await res.startLookups();
    expect(store.sql.get("SELECT source FROM works WHERE id = 'w1'")!.source).toBe('crossref');
  });

  it('turns arXiv ids and links into their DOI', () => {
    expect(doiOf('arXiv:2001.01234v2')).toBe('10.48550/arXiv.2001.01234');
    expect(doiOf('https://arxiv.org/abs/2001.01234')).toBe('10.48550/arXiv.2001.01234');
    expect(doiOf('https://doi.org/10.1145/99370.99404')).toBe('10.1145/99370.99404');
  });

  it('looks a DOI up directly, only with the setting on', async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ message: item }) };
    };
    expect(await crossrefByDoi('doi:10.1145/99370.99404', fetchFn)).toMatchObject({ title: 'Theorems for free!', year: 1989, doi: '10.1145/99370.99404' });
    expect(urls[0]).toBe('https://api.crossref.org/works/10.1145/99370.99404');
    expect(await crossrefByDoi('not a doi', fetchFn)).toBeNull();
    const off = setup([], false);
    await expect(off.res.lookupDoi('10.1145/99370.99404')).rejects.toBeTruthy();
    const on = setup([], true);
    expect(on.res.createWork({ title: 'By hand', authors: 'Me', year: 2024, venue: '', doi: '', url: '', volume: '', pages: '', arxiv: '' })).toMatchObject({ edited: true, state: null });
    expect(on.res.worksByIds(['nope'])).toEqual([]);
  });
});
