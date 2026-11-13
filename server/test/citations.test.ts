import { describe, expect, it } from 'vitest';
import { findCitations, firstSurname } from '@wb/shared';

const item = (str: string, y = 0.3) => ({ str, x: 0.1, y, w: 0.01 * str.length, h: 0.012 });

describe('citations without links', () => {
  it('reads the first author’s family name in both orders', () => {
    expect(firstSurname('Smith, J. and Jones, K.')).toBe('smith');
    expect(firstSurname('J. A. Robinson, K. Clark')).toBe('robinson');
    expect(firstSurname('G. Hutton')).toBe('hutton');
  });

  it('links numbers, each number of a list, but not an index', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ text: `Entry number ${i}, 200${i}.` }));
    const found = findCitations([item('as shown in [2, 4] and a[1] but not [9]')], entries);
    expect(found.map((c) => c.entry)).toEqual([1, 3]);
    expect(found[0]!.x).toBeGreaterThan(0.1);
  });

  it('links author-year citations and leaves out a year shared by two entries', () => {
    const entries = [
      { text: 'Smith, J., and Jones, K. (2020). A paper about trees. Journal of Trees.' },
      { text: 'Miller, A. (2019a). One. Venue.' },
      { text: 'Miller, A. (2019b). Two. Venue.' },
    ];
    const found = findCitations([item('Trees were studied (Smith and Jones, 2020) and by Miller 2019 earlier.')], entries);
    expect(found.map((c) => c.entry)).toEqual([0]);
  });
});
