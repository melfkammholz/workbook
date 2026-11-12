import { describe, expect, it } from 'vitest';
import { pageFingerprint, pageQuote, slideGroups, slideOfPage } from '@wb/shared';

describe('page fingerprints', () => {
  it('ignores whitespace differences and tells different pages apart', () => {
    const a = pageFingerprint('Die  Resolution\n ist ein Kalkül.', 3);
    expect(pageFingerprint('Die Resolution ist ein Kalkül. ', 9)).toBe(a);
    expect(pageFingerprint('Die Resolution ist ein anderer Kalkül.', 3)).not.toBe(a);
  });

  it('keeps the start readable and hashes the whole text, so a change late on the page shows', () => {
    const head = 'x'.repeat(300);
    const one = pageFingerprint(`${head} eins`, 0);
    const two = pageFingerprint(`${head} zwei`, 0);
    expect(one.startsWith(head)).toBe(true);
    expect(one).not.toBe(two);
    expect(one.length).toBeLessThan(330);
  });

  it('uses the index for a page without text (a scan)', () => {
    expect(pageFingerprint('', 4)).toBe('index:4');
    expect(pageFingerprint(' \n ', 4)).toBe('index:4');
    expect(pageFingerprint('', 5)).not.toBe(pageFingerprint('', 4));
  });

  it('cuts the quote at a word', () => {
    expect(pageQuote('Kurz')).toBe('Kurz');
    const q = pageQuote('Unifikation und Resolution sind die Grundlage der logischen Programmierung in Prolog', 40);
    expect(q.endsWith('…')).toBe(true);
    expect(q.length).toBeLessThanOrEqual(41);
    expect(q).toBe('Unifikation und Resolution sind die…');
  });
});

describe('slides from overlays', () => {
  it('makes every page a slide without labels or with empty ones', () => {
    expect(slideGroups(null, 3)).toEqual([{ first: 1, last: 1 }, { first: 2, last: 2 }, { first: 3, last: 3 }]);
    expect(slideGroups(['', '', ''], 3)).toHaveLength(3);
  });

  it('joins consecutive pages with the same label, and only consecutive ones', () => {
    const s = slideGroups(['1', '1', '1', '2', '3', '3', '1'], 7);
    expect(s).toEqual([{ first: 1, last: 3 }, { first: 4, last: 4 }, { first: 5, last: 6 }, { first: 7, last: 7 }]);
  });

  it('finds the slide a page is on', () => {
    const s = slideGroups(['a', 'a', 'b', 'c', 'c'], 5);
    expect([1, 2, 3, 4, 5].map((p) => slideOfPage(s, p))).toEqual([0, 0, 1, 2, 2]);
    expect(slideOfPage([], 1)).toBe(0);
  });
});
