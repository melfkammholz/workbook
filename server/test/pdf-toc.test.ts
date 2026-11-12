import { describe, expect, it } from 'vitest';
import { chapterOf, embeddedKeys, mergeToc, type EmbeddedTocEntry, type TocEdit } from '@wb/shared';

const emb: EmbeddedTocEntry[] = [
  { title: 'Einführung', pageIndex: 0, level: 0 },
  { title: 'Motivation', pageIndex: 2, level: 1 },
  { title: 'Resolution', pageIndex: 10, level: 0 },
];
const edit = (o: Partial<TocEdit>): TocEdit => ({ id: 'x', resource: 'r', version: 'v', pageIndex: 0, fingerprint: 'f', title: '', level: null, hidden: false, embeddedKey: null, createdAt: 1, updatedAt: 1, ...o });

describe('table of contents', () => {
  it('shows the embedded outline as it is when nothing was changed', () => {
    const t = mergeToc(emb, []);
    expect(t.map((e) => [e.title, e.pageIndex, e.level, e.own])).toEqual([['Einführung', 0, 0, false], ['Motivation', 2, 1, false], ['Resolution', 10, 0, false]]);
  });

  it('is empty without an outline and without edits, and shows own entries without an outline', () => {
    expect(mergeToc(null, [])).toEqual([]);
    expect(mergeToc(null, [edit({ id: 'a', title: 'Kapitel', pageIndex: 4 })]).map((e) => e.title)).toEqual(['Kapitel']);
  });

  it('renames, hides and indents embedded entries by key; empty title and null level keep the file\'s', () => {
    const k = embeddedKeys(emb);
    const t = mergeToc(emb, [
      edit({ id: 'a', embeddedKey: k[0]!, title: 'Intro' }),
      edit({ id: 'b', embeddedKey: k[1]!, hidden: true }),
      edit({ id: 'c', embeddedKey: k[2]!, level: 2 }),
    ]);
    expect(t.map((e) => [e.title, e.hidden, e.level])).toEqual([['Intro', false, 0], ['Motivation', true, 1], ['Resolution', false, 2]]);
    expect(t[0]!.embeddedTitle).toBe('Einführung');
  });

  it('puts own entries in page order, after the file\'s entries on the same page', () => {
    const t = mergeToc(emb, [edit({ id: 'a', title: 'Eigenes', pageIndex: 2, createdAt: 5 }), edit({ id: 'b', title: 'Früh', pageIndex: 1, createdAt: 9 })]);
    expect(t.map((e) => e.title)).toEqual(['Einführung', 'Früh', 'Motivation', 'Eigenes', 'Resolution']);
    expect(t.filter((e) => e.own).map((e) => e.editId)).toEqual(['b', 'a']);
  });

  it('drops edits of entries the file no longer has, and tells equal entries apart', () => {
    const dup: EmbeddedTocEntry[] = [{ title: 'A', pageIndex: 1, level: 0 }, { title: 'A', pageIndex: 1, level: 0 }];
    const k = embeddedKeys(dup);
    expect(k[0]).not.toBe(k[1]);
    const t = mergeToc(dup, [edit({ id: 'a', embeddedKey: k[1]!, hidden: true }), edit({ id: 'g', embeddedKey: '9:gone', title: 'Weg' })]);
    expect(t.map((e) => e.hidden)).toEqual([false, true]);
    expect(t).toHaveLength(2);
  });

  it('cuts deep levels and finds the chapter of a page, skipping hidden entries', () => {
    expect(mergeToc([{ title: 'tief', pageIndex: 0, level: 7 }], [])[0]!.level).toBe(2);
    const k = embeddedKeys(emb);
    const t = mergeToc(emb, [edit({ id: 'b', embeddedKey: k[1]!, hidden: true })]);
    expect(chapterOf(t, 5)?.title).toBe('Einführung');
    expect(chapterOf(t, 10)?.title).toBe('Resolution');
    expect(chapterOf(mergeToc(emb, []), 5)?.title).toBe('Motivation');
    expect(chapterOf(mergeToc([{ title: 'X', pageIndex: 3, level: 0 }], []), 1)).toBeNull();
  });
});
