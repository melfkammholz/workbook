import { describe, expect, it } from 'vitest';
import { toBibtex, bibtexKey, bibtexAuthorList, type WorkEdit } from '@wb/shared';
import { fromBibtex } from '../src/resources/bibimport.js';

const base: WorkEdit = { title: '', authors: '', year: null, venue: '', doi: '', url: '', volume: '', pages: '', arxiv: '' };
const wadler: WorkEdit = { ...base, title: 'Theorems for free!', authors: 'Philip Wadler', year: 1989, venue: 'Proceedings of FPCA 1989', pages: '347-359', doi: 'https://doi.org/10.1145/99370.99404' };
const robinson: WorkEdit = { ...base, title: 'A machine-oriented logic based on the resolution principle', authors: 'John Alan Robinson', year: 1965, venue: 'Journal of the ACM', volume: '12', pages: '23--41' };
const odd: WorkEdit = { ...base, title: 'Types & Programming: 100% {fun}', authors: 'Ludwig van der Berg, Anna Müller, Org, Zed et al.', year: 2020, arxiv: '2001.01234', url: 'https://arxiv.org/abs/2001.01234' };

describe('toBibtex', () => {
  it('picks the entry type and writes the fields', () => {
    const s = toBibtex([wadler, robinson]);
    expect(s).toContain('@inproceedings{wadler1989theorems,');
    expect(s).toContain('booktitle     = {Proceedings of FPCA 1989}');
    expect(s).toContain('pages         = {347--359}');
    expect(s).toContain('doi           = {10.1145/99370.99404}');
    expect(s).toContain('@article{robinson1965machine,');
    expect(s).toContain('journal       = {Journal of the ACM}');
  });
  it('writes authors as Family, Given with particles, braces for single names, and others', () => {
    expect(bibtexAuthorList(odd.authors)).toBe('van der Berg, Ludwig and Müller, Anna and {Org} and {Zed} and others');
  });
  it('escapes markup characters and makes keys unique', () => {
    const s = toBibtex([odd, odd]);
    expect(s).toContain('title         = {Types \\& Programming: 100\\% fun}');
    expect(s).toContain('@misc{berg2020types,');
    expect(s).toContain('@misc{berg2020typesa,');
    expect(s).toContain('eprint');
  });
  it('has a key even when almost nothing is known', () => {
    expect(bibtexKey(base)).toBe('work');
  });
  it('round-trips through the reader', () => {
    for (const w of [wadler, robinson, odd]) {
      const [r] = fromBibtex(toBibtex([w]));
      expect(r).toMatchObject({ title: w.title.replace(/[{}]/g, ''), year: w.year, venue: w.venue });
      expect(r!.authors).toBe(w.authors);
    }
    expect(fromBibtex(toBibtex([wadler]))[0]!.doi).toBe('10.1145/99370.99404');
  });
});
