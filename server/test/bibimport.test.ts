import { describe, expect, it } from 'vitest';
import { fromBibtex, fromHayagriva, parseBibText, unLatex } from '../src/resources/bibimport.js';

// Shapes of real exports: Google Scholar, DBLP, Zotero (Better BibTeX style), Typst docs (Hayagriva).
const scholar = `@article{robinson1965machine,
  title={A machine-oriented logic based on the resolution principle},
  author={Robinson, John Alan},
  journal={Journal of the ACM (JACM)},
  volume={12},
  number={1},
  pages={23--41},
  year={1965},
  publisher={ACM New York, NY, USA}
}
@book{hutton2016programming,
  title={Programming in {H}askell},
  author={Hutton, Graham},
  year={2016},
  publisher={Cambridge University Press}
}`;

const dblp = `@inproceedings{DBLP:conf/popl/Wadler89,
  author       = {Philip Wadler},
  title        = {Theorems for free!},
  booktitle    = {Proceedings of the fourth international conference on Functional programming
                  languages and computer architecture, {FPCA} 1989},
  pages        = {347--359},
  publisher    = {{ACM}},
  year         = {1989},
  url          = {https://doi.org/10.1145/99370.99404},
  doi          = {10.1145/99370.99404},
  timestamp    = {Tue, 06 Nov 2018 00:00:00 +0100}
}`;

const zotero = `@comment{ a comment with an @ sign {and brace} }
@string{jacm = "Journal of the ACM"}
@article{könig_2020,
	title = {K{\\"o}nig's lemma and {Pr}olog --- a note},
	author = {K{\\"o}nig, Dénes and M{\\"u}ller, Anna and others},
	journal = jacm,
	date = {2020-05-01},
	doi = {https://doi.org/10.1000/abc.123},
	url = {https://example.org/paper},
}`;

const hayagriva = `harry:
  type: Book
  title: Harry Potter and the Order of the Phoenix
  author:
    - Rowling, J. K.
  date: 2003-06-21
  publisher:
    name: Bloomsbury
  location: London
wwdc-network:
  type: Video
  title: Advances in Networking, Part 1
  author: Daniel Steffen
  date: 2017-06-05
  url: https://developer.apple.com/videos/play/wwdc2017/707/
  parent:
    title: WWDC 2017
    type: Conference
paper:
  type: Article
  title: "Theorems for free"
  author: ["Wadler, Philip"]
  date: 1989
  serial-number:
    doi: "10.1145/99370.99404"
  parent:
    type: Proceedings
    title: FPCA 1989`;

describe('BibTeX', () => {
  it('reads a Google Scholar export', () => {
    const w = fromBibtex(scholar);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ title: 'A machine-oriented logic based on the resolution principle', authors: 'John Alan Robinson', year: 1965, venue: 'Journal of the ACM (JACM)' });
    expect(w[1]!.title).toBe('Programming in Haskell');
    expect(w[1]!.venue).toBe('Cambridge University Press');
  });
  it('reads a DBLP export with a multi-line value and a doi', () => {
    const [w] = fromBibtex(dblp);
    expect(w!.authors).toBe('Philip Wadler');
    expect(w!.doi).toBe('10.1145/99370.99404');
    expect(w!.venue).toMatch(/^Proceedings of the fourth international conference/);
    expect(w!.year).toBe(1989);
  });
  it('reads a Zotero export: comment, @string macros, accents, date, doi URL, others', () => {
    const w = fromBibtex(zotero);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ title: 'König’s lemma and Prolog — a note'.replace('’', "'"), authors: 'Dénes König, Anna Müller et al.', year: 2020, venue: 'Journal of the ACM', doi: '10.1000/abc.123', url: 'https://example.org/paper' });
  });
  it('does not throw on broken text', () => {
    expect(fromBibtex('@article{x, title = {open')).toEqual([{ title: 'open', authors: '', year: null, venue: '', doi: '', url: '', raw: 'open.', key: 'x' }]);
    expect(fromBibtex('@ @{ , = ')).toEqual([]);
  });
  it('unLatex', () => {
    expect(unLatex("\\'{e}cole \\ss{} na\\\"ive 10\\% {NP}-hard")).toBe('école ß naïve 10% NP-hard');
  });
});

describe('Hayagriva', () => {
  it('reads books, videos with a parent, and doi under serial-number', () => {
    const w = fromHayagriva(hayagriva);
    expect(w).toHaveLength(3);
    expect(w[0]).toMatchObject({ title: 'Harry Potter and the Order of the Phoenix', authors: 'J. K. Rowling', year: 2003, venue: 'Bloomsbury' });
    expect(w[1]).toMatchObject({ authors: 'Daniel Steffen', venue: 'WWDC 2017', year: 2017, url: 'https://developer.apple.com/videos/play/wwdc2017/707/' });
    expect(w[2]).toMatchObject({ authors: 'Philip Wadler', doi: '10.1145/99370.99404', venue: 'FPCA 1989', year: 1989 });
  });
});

describe('format detection', () => {
  it('tells them apart and rejects other text', () => {
    expect(parseBibText(scholar).format).toBe('bibtex');
    expect(parseBibText(hayagriva).format).toBe('hayagriva');
    expect(parseBibText('Just some text, with: colons.\nAnd lines.').format).toBeNull();
    expect(parseBibText('- a\n- b').format).toBeNull();
  });
});
