import { describe, expect, it } from 'vitest';
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
