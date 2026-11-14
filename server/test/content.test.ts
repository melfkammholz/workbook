import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveTitle } from '../src/content/ids.js';
import { loadContent } from '../src/content/loader.js';
import { EXAMPLE_CONTENT } from './helpers.js';

describe('example content', () => {
  const content = loadContent(EXAMPLE_CONTENT);

  it('loads without problems', () => {
    expect(content.outline.problems).toEqual([]);
    expect(content.outline.chapters.map((c) => c.id)).toEqual(['haskell-grundlagen', 'typklassen', 'prolog-grundlagen']);
  });

  it('numbers exercises per chapter and leaves pages unnumbered', () => {
    const [ch1] = content.outline.chapters;
    const first = ch1!.items[1]!;
    expect(first.type === 'exercise' && first.number).toBe('1.1');
    expect(ch1!.items[0]!.type).toBe('page');
  });

  it('derives starter and solution from one CPP-style file', () => {
    const ad = content.exercise('automatic-differentiation')!;
    expect(ad.code!.studentPath).toBe('Playground/AutomaticDifferentiation.hs');
    expect(ad.code!.starter).not.toContain('D x1 d1 + D x2 d2');
    expect(ad.code!.solution).toContain('D x1 d1 + D x2 d2');
    expect(ad.meta.code!.hasSolution).toBe(true);
  });

  it('computes reverse dependencies and implicit mentions', () => {
    expect(content.exercise('imperative-variables')!.meta.next).toContain('slot-machine');
    expect(content.exercise('slot-machine')!.meta.mentions).toEqual(['imperative-variables']);
    expect(content.exercise('symbolic-differentiation')!.meta.next).toContain('automatic-differentiation');
  });

  it('gives start-here exercises a stable emoji', () => {
    const a = content.exercise('slot-machine')!.meta;
    expect(a.startHere).toBe(true);
    expect(a.emoji).toBeTruthy();
    expect(loadContent(EXAMPLE_CONTENT).exercise('slot-machine')!.meta.emoji).toBe(a.emoji);
    expect(content.exercise('strong-typing')!.meta.emoji).toBeNull();
  });

  it('derives readable titles from the text', () => {
    expect(content.exercise('strong-typing')!.meta.title).toBe('Haskell ist eine streng getypte Programmiersprache');
  });
});

function tmpContent(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-content-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

describe('validation', () => {
  it('reports unknown ids, cycles, missing files and typos without crashing', () => {
    const dir = tmpContent({
      'chapters/01-x/chapter.yml': `
title: X
items:
  - id: a
    after: [b, ghost]
  - id: b
    after: [a]
  - id: c
    levle: 2
  - id: d
  - id: a
`,
      'chapters/01-x/a.typ': 'A #xref("nowhere")',
      'chapters/01-x/b.typ': 'B',
      'chapters/01-x/c.typ': 'C',
    });
    const { problems, chapters } = loadContent(dir).outline;
    const msgs = problems.map((p) => p.message);
    expect(msgs.some((m) => m.includes('unknown id "ghost"'))).toBe(true);
    expect(msgs.some((m) => m.includes('dependency cycle'))).toBe(true);
    expect(msgs.some((m) => m.includes('xref: unknown id "nowhere"'))).toBe(true);
    expect(msgs.some((m) => m.includes('items[2]') && m.includes('levle'))).toBe(true);
    expect(msgs.some((m) => m.includes('text file not found'))).toBe(true);
    expect(msgs.some((m) => m.includes('duplicate id "a"'))).toBe(true);
    // The valid exercises are still there.
    expect(chapters[0]!.items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('deriveTitle', () => {
  it('strips markup', () => {
    expect(deriveTitle('Wie können wir #emph[Ausdrücke] bedingt auswerten? Mehr Text.')).toBe('Wie können wir Ausdrücke bedingt auswerten?');
    expect(deriveTitle('')).toBe('Untitled');
  });
});

describe('outline structure', () => {
  it('groups chapters into parts and items into sections', () => {
    const { parts, chapters } = loadContent(EXAMPLE_CONTENT).outline;
    expect(parts.map((p) => p.title)).toEqual(['Funktionale Programmierung', 'Logische Programmierung']);
    expect(chapters.map((c) => c.partId)).toEqual(['part-1', 'part-1', 'part-2']);
    const [prolog] = chapters.slice(2);
    expect(prolog!.sections.map((s) => s.title)).toEqual(['Fakten und Anfragen', 'Listen', 'SLD-Bäume']);
    expect(prolog!.items.map((i) => i.sectionId)).toEqual([prolog!.sections[0]!.id, prolog!.sections[1]!.id, prolog!.sections[2]!.id]);
    // Sections do not take part in the numbering.
    expect(prolog!.items.map((i) => (i.type === 'exercise' ? i.number : ''))).toEqual(['3.1', '3.2', '3.3']);
  });

  it('still shows a chapter that no part lists, and says so', () => {
    const dir = tmpContent({
      'workbook.yml': 'parts:\n  - title: Eins\n    chapters: [02-b]\n',
      'chapters/01-a/chapter.yml': 'title: A\nitems: []\n',
      'chapters/02-b/chapter.yml': 'title: B\nitems: []\n',
    });
    const { chapters, problems } = loadContent(dir).outline;
    expect(chapters.map((c) => [c.id, c.partId])).toEqual([['b', 'part-1'], ['a', null]]);
    expect(problems.map((p) => p.message).join()).toContain('"01-a" is not in any part');
  });

  it('leaves the chapters of an unnumbered part out of the numbering', () => {
    const dir = tmpContent({
      'workbook.yml': 'parts:\n  - title: Eins\n    chapters: [01-a, 03-c]\n  - title: Woche\n    numbered: false\n    chapters: [02-w]\n',
      'chapters/01-a/chapter.yml': 'title: A\nitems: []\n',
      'chapters/02-w/chapter.yml': 'title: W\nitems:\n  - id: w1\n  - id: w2\n',
      'chapters/02-w/w1.typ': 'W1',
      'chapters/02-w/w2.typ': 'W2',
      'chapters/03-c/chapter.yml': 'title: C\nitems: []\n',
    });
    const { chapters } = loadContent(dir).outline;
    expect(chapters.map((c) => [c.id, c.number])).toEqual([['a', 1], ['c', 2], ['w', null]]);
    expect(chapters[2]!.items.map((i) => (i.type === 'exercise' ? i.number : ''))).toEqual(['1', '2']);
  });

  it('keeps working without parts or sections', () => {
    const dir = tmpContent({
      'chapters/01-a/chapter.yml': 'title: A\nitems:\n  - id: x\n',
      'chapters/01-a/x.typ': 'X',
    });
    const { parts, chapters, problems } = loadContent(dir).outline;
    expect(problems).toEqual([]);
    expect(parts).toEqual([]);
    expect(chapters[0]).toMatchObject({ partId: null, sections: [] });
    expect(chapters[0]!.items[0]!.sectionId).toBeNull();
  });
});

describe('focus', () => {
  const course = (a: string, b: string) =>
    loadContent(
      tmpContent({
        'chapters/01-a/chapter.yml': `title: A\nitems:\n  - id: x\n${a}\n`,
        'chapters/01-a/x.typ': 'X',
        'chapters/02-b/chapter.yml': `title: B\nitems:\n  - id: y\n${b}\n`,
        'chapters/02-b/y.typ': 'Y',
      }),
    ).outline;

  it('reads extra material', () => {
    const { chapters, problems } = course('    start-here: true', '    extra: true');
    expect(chapters[1]!.items[0]).toMatchObject({ startHere: false, extra: true });
    expect(chapters[0]!.items[0]).toMatchObject({ startHere: true, extra: false });
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('does not take an exercise as both start-here and extra', () => {
    const { chapters, problems } = course('    start-here: true\n    extra: true', '    start-here: true');
    expect(problems.map((p) => p.message).join()).toContain('both start-here and extra');
    expect(chapters[0]!.items[0]).toMatchObject({ startHere: true, extra: false });
  });

  it('warns about a chapter with nothing for "essentials", once the course marks start-here at all', () => {
    expect(course('    start-here: true', '    extra: false').problems.map((p) => p.message)).toEqual([
      'chapter "b" has no start-here exercise, so the focus "essentials" shows none of its exercises',
    ]);
    expect(course('    extra: false', '    extra: false').problems).toEqual([]);
  });
});

describe('tags', () => {
  it('tells topics from signals, and defaults to topic', () => {
    const { tags } = loadContent(EXAMPLE_CONTENT).outline;
    expect(tags.find((t) => t.id === 'diff')?.type).toBe('topic');
    expect(tags.find((t) => t.id === 'deep-dive')?.type).toBe('signal');
    const dir = tmpContent({ 'tags.yml': 'plain: Plain\n' });
    expect(loadContent(dir).outline.tags[0]).toMatchObject({ id: 'plain', type: 'topic' });
  });
});

describe('programming exercises without files', () => {
  const dir = tmpContent({
    'chapters/01-a/chapter.yml': `title: A
items:
  - id: hs
    code: { language: haskell }
  - id: py
    help-after: 45
    code: { language: python }
  - id: pl
    code: { language: prolog }
`,
    'chapters/01-a/hs.typ': 'H',
    'chapters/01-a/py.typ': 'P',
    'chapters/01-a/pl.typ': 'L',
  });
  const content = loadContent(dir);

  it('need neither a template nor tests', () => {
    expect(content.outline.problems).toEqual([]);
    const code = (id: string) => content.exercise(id)!.code!;
    expect(code('hs')).toMatchObject({ studentPath: 'Answer.hs', check: null, solution: null, runnable: true });
    expect(code('hs').starter).toContain('module Answer');
    expect(code('py')).toMatchObject({ studentPath: 'answer.py', starter: '', runnable: true });
    expect(code('pl')).toMatchObject({ studentPath: 'answer.pl', starter: '', runnable: true });
  });

  it('carry a per-exercise help time', () => {
    expect(content.exercise('py')!.meta.helpAfterMinutes).toBe(45);
    expect(content.exercise('hs')!.meta.helpAfterMinutes).toBeNull();
  });

  it('warns that tests for a language without a runner are ignored', () => {
    const d = tmpContent({
      'chapters/01-a/chapter.yml': 'title: A\nitems:\n  - id: rb\n    code: { language: ruby, check: t.rb }\n  - id: py\n    code: { language: python, check: t.py }\n',
      'chapters/01-a/rb.typ': 'R',
      'chapters/01-a/py.typ': 'P',
    });
    const content = loadContent(d);
    const { problems } = content.outline;
    expect(problems.map((p) => p.severity)).toEqual(['warning', 'warning']);
    expect(problems[0]!.message).toContain('cannot run ruby');
    expect(problems[1]!.message).toContain('cannot run tests in python');
    expect(content.exercise('py')!.code!.check).toBeNull();
  });

  it('asks for the program of an sld exercise, which is the only thing its tests are', () => {
    const d = tmpContent({
      'chapters/01-a/chapter.yml': [
        'title: A',
        'items:',
        '  - id: ok',
        '    code: { language: sld, program: code/p.pl }',
        '  - id: none',
        '    code: { language: sld }',
        '  - id: missing',
        '    code: { language: sld, program: code/q.pl }',
        '  - id: extra',
        '    code: { language: sld, program: code/p.pl, check: t.pl }',
        '  - id: elsewhere',
        '    code: { language: prolog, program: code/p.pl }',
        '',
      ].join('\n'),
      ...Object.fromEntries(['ok', 'none', 'missing', 'extra', 'elsewhere'].map((id) => [`chapters/01-a/${id}.typ`, 'T'])),
      'chapters/01-a/code/p.pl': 'p(a).\n',
    });
    const content = loadContent(d);
    const problems = content.outline.problems.map((p) => `${p.severity}: ${p.message}`);
    expect(problems).toEqual([
      expect.stringContaining('error: exercise "none": language sld needs "program"'),
      expect.stringContaining('error: program file not found (exercise "missing")'),
      expect.stringContaining('warning: exercise "extra": an sld tree is checked by sldcheck against its program, so "check" is ignored'),
      expect.stringContaining('warning: exercise "elsewhere": "program" only goes with language sld'),
    ]);
    expect(content.exercise('ok')!.code).toMatchObject({ language: 'sld', program: 'p.pl', studentPath: 'answer.sld', starter: '', check: null, support: { 'p.pl': 'p(a).\n' } });
    expect(content.exercise('ok')!.meta.code).toMatchObject({ runnable: true, hasCheck: true });
    expect(content.exercise('elsewhere')!.code!.program).toBeNull();
  });
});

describe('pages', () => {
  it('can be extra material with tags, like lessons', () => {
    const dir = tmpContent({
      'chapters/01-x/chapter.yml': `
title: X
items:
  - page: deep
    title: Tiefer
    extra: true
    tags: [deep-dive]
  - page: plain
    title: Einfach
`,
      'chapters/01-x/deep.typ': 'Tief',
      'chapters/01-x/plain.typ': 'Flach',
    });
    const { outline } = loadContent(dir);
    const [deep, plain] = outline.chapters[0]!.items;
    expect(deep).toMatchObject({ type: 'page', extra: true, tags: ['deep-dive'] });
    expect(plain).toMatchObject({ type: 'page', extra: false, tags: [] });
    expect(outline.tags.some((t) => t.id === 'deep-dive')).toBe(true);
  });
});

describe('references', () => {
  it('reads references.bib and references.yml side by side', () => {
    const { works } = loadContent(EXAMPLE_CONTENT);
    expect(works.map((w) => w.key).sort()).toEqual(['hutton2016', 'wadler1989']);
    expect(works.find((w) => w.key === 'wadler1989')).toMatchObject({ year: 1989, doi: '10.1145/99370.99404', file: 'references.yml' });
  });

  it('lints unknown and duplicate keys, missing title or year, unused and repeated works', () => {
    const dir = tmpContent({
      'chapters/01-x/chapter.yml': 'title: X\nitems:\n  - id: a\n',
      'chapters/01-x/a.typ': 'A #cite-work("nope")[x] #cite-work("one")[y]',
      'references.bib': '@book{one, title={T}, year={2000}, doi={10.1/x}}\n@book{one, title={U}, year={2001}}\n@book{two, title={T}, year={2000}, doi={10.1/x}}\n@book{three, author={A}}\n',
      'references.yml': 'one:\n  type: book\n  title: V\n  date: 1999\n',
    });
    const msgs = loadContent(dir).outline.problems.map((p) => `${p.severity}: ${p.message}`);
    const has = (s: string) => expect(msgs.some((m) => m.includes(s)), s + '\n' + msgs.join('\n')).toBe(true);
    has('error: cite-work: unknown key "nope"');
    has('duplicate key "one"');
    has('"three" has no title');
    has('"three" has no year');
    has('"two" is the same work as "one"');
    has('"two" is not cited anywhere');
  });
});
