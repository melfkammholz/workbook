import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../src/content/loader.js';
import { TypstRenderer } from '../src/content/typst.js';
import { EXAMPLE_CONTENT, hasBinary } from './helpers.js';

// Set TYPST_BIN to run these against a specific Typst CLI; skipped when none is installed.
const bin = process.env.TYPST_BIN ?? 'typst';
const have = hasBinary(bin);

describe.skipIf(!have)('TypstRenderer', () => {
  const content = loadContent(EXAMPLE_CONTENT);
  let r: TypstRenderer;
  beforeAll(() => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-data-'));
    r = new TypstRenderer({
      bin,
      contentDir: EXAMPLE_CONTENT,
      dataDir,
      assetsDir: path.resolve(import.meta.dirname, '../assets/typst'),
      language: 'de',
    });
    r.titles = (id) => content.get(id)?.meta.title;
  });

  it('cite-work shows the author\'s words and names the work; an unknown key is an error naming it', async () => {
    const ok = await r.renderNote('#cite-work("hutton2016")[Kapitel 1]');
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(ok.html).toContain('data-work="hutton2016"');
    expect(ok.html).toContain('Kapitel 1');
    const bad = await r.renderNote('#cite-work("nope")[x]');
    expect(bad.diagnostics.some((d) => d.severity === 'error' && d.message.includes('nope'))).toBe(true);
  });

  it('renders a question to semantic HTML', async () => {
    const out = await r.renderItem(content.get('mutual-recursion')!);
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(out.task).toContain('<pre><code data-lang="hs">');
    expect(out.task).toContain('even :: Int -> Bool');
    expect(out.task).toContain('<ul>');
    expect(out.task).not.toContain('style="color'); // no baked-in light-theme colours
  });

  it('splits remarks and hints out of the task', async () => {
    const side = await r.renderItem(content.get('side-effects')!);
    expect(side.remarks).toHaveLength(1);
    expect(side.remarks[0]).toContain('xkcd.com/1312');
    expect(side.task).not.toContain('xkcd');

    const ad = await r.renderItem(content.get('automatic-differentiation')!);
    expect(ad.hints).toHaveLength(3);
    expect(ad.hints[1]).toContain('<math');
    expect(ad.task).not.toContain('Produktregel: ');
  });

  it('keeps horizontal space inside math, in one equation', async () => {
    // `quad` is an `h`. As an HTML element it would tear the equation apart.
    const out = await r.renderNote('$ x = cases(1 & quad "falls" y = 0, 2 & quad "sonst") quad "oder" quad z $');
    expect(out.html.match(/<math/g)).toHaveLength(1);
    expect(out.html).toMatch(/<math[^>]*>(?:(?!<\/math>)[\s\S])*oder(?:(?!<\/math>)[\s\S])*<\/math>/);
    expect(out.html).not.toMatch(/<span[^>]*inline-block/);
  });

  it('still keeps a horizontal space outside math', async () => {
    const out = await r.renderNote('a #h(2em) b');
    expect(out.html).toContain('display:inline-block');
  });

  it('gives code without a language the language of what it belongs to', async () => {
    const out = await r.renderItem({ typst: '`f x` and ```text A.hs``` and ```python y```\n\n```\nmain = 1\n```', chapterRel: '', codeLanguage: 'haskell' });
    expect(out.task).toContain('<code data-lang="haskell">f x</code>');
    expect(out.task).toContain('<code data-lang="text">A.hs</code>');
    expect(out.task).toContain('<code data-lang="python">y</code>');
    expect(out.task).toContain('<pre><code data-lang="haskell">main = 1</code></pre>');
    expect((await r.renderItem({ typst: '`f x`', chapterRel: '', codeLanguage: null })).task).toContain('<code>f x</code>');
  });

  it('renders math as MathML', async () => {
    const out = await r.renderItem(content.get('binary-exponentiation')!);
    expect(out.task).toContain('<math display="block">');
    expect(out.css).toContain('mtable');
  });

  it('keeps the code in columns instead of dropping it', async () => {
    const out = await r.renderItem(content.get('imperative-variables')!);
    expect(out.task).toContain('class="wb-columns"');
    expect(out.task).toContain('def clz(n):');
    expect(out.task).toContain('def popcnt(n):');
  });

  it('re-implements layout the HTML export would silently drop', async () => {
    const note = await r.renderNote(
      [
        '#pad(left: 1em)[padded text]',
        '#stack(dir: ltr, spacing: 1em, [first], [second])',
        '#grid(columns: 2, [cell a], [cell b], [cell c], [cell d])',
        '#rect(inset: 4pt)[boxed text]',
        '#rotate(10deg)[turned]',
        'a#h(1em)b #text(fill: red)[red words]',
        '#diagram(circle(radius: 5pt))',
      ].join('\n\n'),
    );
    expect(note.diagnostics).toEqual([]);
    expect(note.html).toContain('padded text');
    expect(note.html).toContain('first');
    expect(note.html).toContain('class="wb-grid"');
    expect(note.html).toContain('cell d');
    expect(note.html).toContain('<svg'); // rect, rotate and the diagram are embedded as pictures
    expect(note.html).toContain('class="wb-diagram"');
    expect(note.html).toContain('color:#ff4136');
  });

  it('writes widgets as hosts with their parts, for the app to bring to life', async () => {
    const note = await r.renderNote(
      [
        '#quiz([Was ergibt `1 + 1`?], choice[`3`][Fast.], choice(correct: true)[`2`][Genau.])',
        '#tabs(tab("Maybe a")[#steps(step(label: "Eins")[first], step[second])])',
        '#fold-signature("data Maybe a = Nothing | Just a", given: true)',
      ].join('\n\n'),
    );
    expect(note.diagnostics).toEqual([]);
    expect(note.html).toContain('data-widget="quiz"');
    expect(note.html).toContain('<div data-part="choice" data-correct="true"><div data-part="label"><code');
    expect(note.html).toContain('<div data-part="why">Genau.</div>');
    expect(note.html).toContain('data-part="tab" data-label="Maybe a"><div class="wb-widget" data-widget="steps">');
    expect(note.html).toContain('data-decl="data Maybe a = Nothing | Just a" data-given="true"');
    // Without the app, the declaration is still there to read.
    expect(note.html).toContain('<pre><code');
  });

  it('writes a recipe as steps with one result per step for each example', async () => {
    const note = await r.renderNote('#recipe(step(label: "Erst")[eins], step(label: "Dann")[zwei], example("Maybe a", [A1], [A2]))');
    expect(note.diagnostics).toEqual([]);
    expect(note.html).toContain('data-widget="recipe"');
    expect(note.html).toContain('<div data-part="step" data-label="Dann">zwei</div>');
    expect(note.html).toContain('<div data-part="example" data-label="Maybe a"><div data-part="result">A1</div><div data-part="result">A2</div></div>');
  });

  it('keeps the marks of compared code for the app, and the notes as parts', async () => {
    const note = await r.renderNote('#compare(pairs: (nil: "Leer"), notes: (nil: [Wird zu fnil.]), [```haskell\nf [] = [[nil|0]]\n```], [```haskell\nfnil = [[nil|0]]\n```])');
    expect(note.diagnostics).toEqual([]);
    expect(note.html).toContain('data-widget="compare"');
    expect(note.html).toContain('f [] = [[nil|0]]');
    expect(note.html).toContain('<div data-part="note" data-id="nil">Wird zu fnil.</div>');
  });

  it('passes the configuration of the computing widgets as JSON', async () => {
    const note = await r.renderNote('#fold-tree("data Maybe a = Nothing | Just a", "Just 3", functions: (Nothing: "Nothing", Just: "Just"))');
    expect(note.diagnostics).toEqual([]);
    const config = /data-config="([^"]*)"/.exec(note.html)?.[1]?.replace(/&quot;/g, '"');
    expect(JSON.parse(config ?? '{}')).toEqual({ value: 'Just 3', functions: { Nothing: 'Nothing', Just: 'Just' }, type: null, fold: null });
  });

  const svgCount = (html: string) => (html.match(/<svg/g) ?? []).length;

  it('draws a sized block as one picture, the way a cetz canvas arrives', async () => {
    const out = await r.renderNote('#block(width: 2cm, height: 1cm, align(top, { place(top + left, rect(width: 5pt, height: 5pt)); place(top + left, move(dx: 1cm, [Beschriftung])) }))');
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(svgCount(out.html)).toBe(1);
  });

  it('leaves the layout alone inside #diagram', async () => {
    const out = await r.renderNote('#diagram(block(width: 2cm, height: 1cm, { place(top + left, [a]); place(bottom + right, pad(1pt, stack(dir: ltr, spacing: 2pt, [b], [c]))) }))');
    expect(svgCount(out.html)).toBe(1);
    expect(out.html).not.toContain('display:flex');
    expect(out.html).not.toContain('wb-grid');
  });

  it('keeps plain boxes and blocks as selectable text', async () => {
    const out = await r.renderNote('Vor #box[im Text] nach.\n\n#block[Ein Absatz]');
    expect(svgCount(out.html)).toBe(0);
    expect(out.html).toContain('im Text');
    expect(out.html).toContain('Ein Absatz');
  });

  it('turns a box with a look into a picture instead of losing the look', async () => {
    expect(svgCount((await r.renderNote('#box(fill: red, [x])')).html)).toBe(1);
  });

  const cetzCache = path.join(os.homedir(), '.cache/typst/packages');
  it.skipIf(!fs.existsSync(path.join(cetzCache, 'preview/cetz/0.5.3')))('draws a real cetz canvas as one picture', async () => {
    const before = process.env.TYPST_PACKAGE_CACHE_PATH;
    process.env.TYPST_PACKAGE_CACHE_PATH = cetzCache;
    try {
      const out = await r.renderNote(
        '#import "@preview/cetz:0.5.3"\n#align(center, pad(y: 1em, cetz.canvas({\n  import cetz.draw: *\n  content((0, 0), [A])\n  content((2, 0), [B])\n  line((0.3, 0), (1.7, 0), mark: (end: ">"))\n})))',
      );
      expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(svgCount(out.html)).toBe(1);
      expect(out.html).toContain('text-align: center');
    } finally {
      if (before === undefined) delete process.env.TYPST_PACKAGE_CACHE_PATH;
      else process.env.TYPST_PACKAGE_CACHE_PATH = before;
    }
  });

  it('turns xref into a link carrying the target title', async () => {
    const out = await r.renderItem(content.get('slot-machine')!);
    expect(out.task).toMatch(/<a [^>]*data-xref="imperative-variables"[^>]*>Imperative Variablen in funktionalen Programmiersprachen<\/a>/);
    expect(out.remarks).toHaveLength(1);
  });

  it('writes a PDF reference as title and page, or keeps the quote when it is gone', async () => {
    r.pdfRefs = (res, target) => (res === 'r-1' ? { title: 'Skript', page: target ? 42 : null } : undefined);
    try {
      const out = await r.renderNote('#pdf-ref("r-1", "h-9", quote: "ein Satz") und #pdf-ref("r-1") und #pdf-ref("r-2", "h-1", quote: "weg")');
      expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(out.html).toMatch(/<a [^>]*data-pdf-ref="r-1\/h-9"[^>]*href="#\/resources\/r-1\/h-9"[^>]*title="ein Satz"[^>]*>Skript, S\. 42<\/a>/);
      expect(out.html).toMatch(/data-pdf-ref="r-1"[^>]*>Skript<\/a>/);
      expect(out.html).toMatch(/wb-pdf-ref-broken[^>]*>weg<\/a>/);
      const deck = await r.renderDeck('#flashcard(id: "a")[Q][A #pdf-ref("r-1", "h-9", quote: "ein Satz")]');
      expect(deck.html).toContain('>Skript, S. 42</a>');
    } finally {
      r.pdfRefs = () => undefined;
    }
  });

  it('maps compile errors back to lines of the author file', async () => {
    const item = { ...content.get('strong-typing')!, typst: 'fine line\n\n#nonexistent(1)\n' };
    const out = await r.renderItem(item);
    const err = out.diagnostics.find((d) => d.severity === 'error');
    expect(err).toBeDefined();
    expect(out.task).toBe('');
  });

  it('leaves ordinary text as text', async () => {
    const plain = await r.renderNote('Just *text* and $x^2$.');
    expect(plain.asPicture).toBeUndefined();
  });

  it('lays out as a page what HTML export would lose, the way typst-preview shows it', async () => {
    const out = await r.renderNote('Before\n\n#grid(columns: 2, grid.header[A][B], [1], [2])');
    expect(out.asPicture).toBe(true);
    expect(out.html).toMatch(/^<div class="wb-as-picture"><svg/);
    expect(out.diagnostics).toEqual([]);
    // It looks like the app: the theme's text colour instead of black, and the app's font (no warning about a missing one).
    expect(out.html).toContain('fill="currentColor"');
    expect(out.html).not.toContain('fill="#000000"');

    // Laid out at the width it is shown at, not scaled: the page is as wide as asked.
    const wide = await r.renderNote('#grid(columns: 2, grid.header[A][B], [1], [2])', 400);
    expect(wide.html).toMatch(/viewBox="0 0 400 /);
  });

  it('draws the sides of a deck\'s cards as pictures when part of it would be lost, and keeps clozes as text', async () => {
    const out = await r.renderDeck('#flashcard(id: "a")[#grid(columns: 2, grid.header[A][B], [1], [2])][back]\n#cloze(id: "b")[x \u{E101}gap\u{E0FF}]');
    expect(out.asPicture).toBe(true);
    expect(out.html).toMatch(/data-side="front"><svg/);
    expect(out.html).toMatch(/data-side="text">x \u{E101}gap\u{E0FF}/u);
  });

  it('strips scripts and event handlers from student notes', async () => {
    const out = await r.renderNote('Hello #html.elem("script")[alert(1)] #html.elem("img", attrs: (src: "x", onerror: "alert(2)"))[]');
    expect(out.html).not.toContain('<script');
    expect(out.html).not.toContain('onerror');
  });

  it('renders student notes with the prelude available', async () => {
    const out = await r.renderNote('= Notes\nSee #xref("slot-machine"). $a^2$');
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(out.html).toContain('>Einarmiger Bandit');
    expect(out.html).toContain('<math>');
  });

  it('keeps lists and cases intact through the prelude and the sanitiser', async () => {
    const out = await r.renderNote('- eins\n  - tief\n+ erstens\n\n$ f(x) = cases(1 & "falls" x > 0, 0 & "sonst") $');
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(out.html).toContain('<ul><li><p>eins</p><ul><li>tief');
    expect(out.html).toContain('<ol><li>erstens');
    expect(out.html).toContain('<mtable class="cases">');
    expect(out.html.match(/<mtr>/g)).toHaveLength(2);
    expect(out.css).toContain('mtable.cases');
  });
});

describe.skipIf(!have)('warming the render cache', () => {
  const content = loadContent(EXAMPLE_CONTENT);
  const make = () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-data-'));
    const r = new TypstRenderer({ bin, contentDir: EXAMPLE_CONTENT, dataDir, assetsDir: path.resolve(import.meta.dirname, '../assets/typst'), language: 'de' });
    return { r, cache: path.join(dataDir, 'cache', 'render') };
  };
  const cached = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
  const until = async (ok: () => boolean, ms = 30_000) => {
    for (const end = Date.now() + ms; !ok(); ) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((res) => setTimeout(res, 50));
    }
  };

  it('renders texts in the background, so asking for one needs no compile', async () => {
    const { r, cache } = make();
    const texts = ['mutual-recursion', 'side-effects', 'automatic-differentiation'].map((id) => content.get(id)!);
    r.warm(texts);
    await until(() => cached(cache) === texts.length);
    const t = performance.now();
    const out = await r.renderItem(texts[1]!);
    expect(performance.now() - t).toBeLessThan(50);
    expect(out.remarks[0]).toContain('xkcd.com/1312');
  }, 60_000);

  it('gives way to a real render and finishes afterwards', async () => {
    const { r, cache } = make();
    const texts = content.all().slice(0, 6);
    r.warm(texts);
    // Past the quiet time, so a warming compile is running when the student asks.
    await new Promise((res) => setTimeout(res, 700));
    const out = await r.renderItem(content.get('mutual-recursion')!);
    expect(out.task).toContain('even :: Int -> Bool');
    await until(() => cached(cache) >= texts.length);
  }, 60_000);

  it('forgets what was left when stopped', async () => {
    const { r, cache } = make();
    r.warm(content.all().slice(0, 6));
    r.stopWarming();
    await new Promise((res) => setTimeout(res, 1500));
    expect(cached(cache)).toBe(0);
  });
});
