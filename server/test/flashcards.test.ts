import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeckDoc, DeckPreview, DeckSaved, FlashcardsResponse, ReviewNext } from '@wb/shared';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { Store } from '../src/db/store.js';
import { Flashcards, plainCardText } from '../src/flashcards/service.js';
import { GAP_CLOSE, appendCard, applyEdits, assignIds, balanced, cardText, deckWarnings, dedent, fieldsOf, gapOpen, gapsIn, insertAfter, moveCard, removeCard, replaceCard, scanCards, toTypst, unitsOf } from '../src/flashcards/source.js';
import type { TypstRenderer } from '../src/content/typst.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB, hasBinary } from './helpers.js';

const typstBin = process.env.TYPST_BIN ?? 'typst';
const haveTypst = hasBinary(typstBin);
const DAY = 86_400_000;

describe('finding cards in a deck', () => {
  it('finds both kinds, with their arguments and content', () => {
    const src = '= Haskell\n\n#flashcard[What is `map`?][It applies a function to every element.]\n\n#flashcard(id: "k3f9", from: "c/side-effects", both: true)[A][B]\n#cloze[`map` applies {{a function}} to {{every element}}.]\n';
    const cards = scanCards(src);
    expect(cards.map((c) => c.kind)).toEqual(['basic', 'both', 'cloze']);
    expect(cards[0]!.bodies.map((b) => src.slice(b.from, b.to))).toEqual(['What is `map`?', 'It applies a function to every element.']);
    expect(cards[1]).toMatchObject({ id: 'k3f9', from: 'c/side-effects', line: 5, column: 1 });
    expect(src.slice(cards[1]!.idSpan!.from, cards[1]!.idSpan!.to)).toBe('k3f9');
    expect(gapsIn(src, cards[2]!.bodies[0]!).map((g) => src.slice(g.from, g.to))).toEqual(['{{a function}}', '{{every element}}']);
  });

  it('is not fooled by brackets in code, math, strings, escapes or comments', () => {
    const src = [
      '#flashcard[A list `[1, 2]` and ```hs xs !! 0 ] ``` and $[0, 1)$ and \\] and #link("a]b")[x]][back // a comment ]\n still the back]',
      '// #flashcard[commented out][no]',
      '/* #cloze[{{no}}] */',
      '\\#flashcard[escaped][no]',
      'https://example.org/#flashcard',
    ].join('\n');
    const cards = scanCards(src);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.bodies).toHaveLength(2);
    expect(src.slice(cards[0]!.bodies[1]!.from, cards[0]!.bodies[1]!.to)).toBe('back // a comment ]\n still the back');
  });

  it('only counts content that follows without a space', () => {
    const cards = scanCards('#flashcard[front] [not the back]');
    expect(cards[0]!.bodies).toHaveLength(1);
  });

  it('does not see gaps inside math', () => {
    const src = '#cloze[$ {{x}} $ but {{y}}]';
    const [c] = scanCards(src);
    expect(gapsIn(src, c!.bodies[0]!).map((g) => src.slice(g.from, g.to))).toEqual(['{{y}}']);
  });

  it('gives one review per direction and per gap', () => {
    const src = '#flashcard(id: "a")[x][y]\n#flashcard(id: "b", both: true)[x][y]\n#cloze(id: "c")[{{1}} {{2}} {{3}}]\n#flashcard[no id][y]';
    expect(scanCards(src).flatMap((c) => unitsOf(src, c).map((u) => u.key))).toEqual(['a', 'b', 'b:back', 'c:1', 'c:2', 'c:3']);
  });
});

describe('ids', () => {
  it('writes an id into every card that lacks one, by inserting text only', () => {
    const src = '#flashcard[a][b]\n#flashcard(from: "x/y")[a][b]\n#cloze()[{{x}}]\n#flashcard(id: "keep")[a][b]';
    const { source, edits } = assignIds(src, () => false);
    expect(edits.every((e) => e.from === e.to)).toBe(true);
    const cards = scanCards(source);
    expect(cards.every((c) => c.id && /^[a-z0-9]{4}$|^keep$/.test(c.id))).toBe(true);
    expect(cards[3]!.id).toBe('keep');
    expect(source).toMatch(/^#flashcard\(id: "[a-z0-9]{4}"\)\[a\]\[b\]\n#flashcard\(id: "[a-z0-9]{4}", from: "x\/y"\)/);
    expect(source).toMatch(/#cloze\(id: "[a-z0-9]{4}"\)\[\{\{x\}\}\]/);
    expect(applyEdits(src, edits)).toBe(source);
    // Saving again changes nothing.
    expect(assignIds(source, () => false).edits).toEqual([]);
  });

  it('gives a pasted duplicate, or an id another deck has, a new one', () => {
    const src = '#flashcard(id: "same")[a][b]\n#flashcard(id: "same")[c][d]\n#flashcard(id: "other")[e][f]';
    const { source } = assignIds(src, (id) => id === 'other');
    const ids = scanCards(source).map((c) => c.id);
    expect(ids[0]).toBe('same');
    expect(ids[1]).not.toBe('same');
    expect(ids[2]).not.toBe('other');
    expect(new Set(ids).size).toBe(3);
  });

  it('never hands out an id used before', () => {
    const used = new Set(Array.from({ length: 2000 }, (_, i) => i.toString(36).padStart(4, 'a')));
    const { source } = assignIds('#flashcard[a][b]', () => false, (id) => used.has(id));
    expect(used.has(scanCards(source)[0]!.id!)).toBe(false);
  });
});

describe('compiling a deck', () => {
  it('tells cards the language of their exercise and marks gaps, keeping the lines', () => {
    const src = '#flashcard(from: "c/ex")[a][b]\n#cloze[x {{y}}\nz {{w}}]';
    const out = toTypst(src, (ref) => (ref === 'c/ex' ? 'haskell' : null));
    expect(out).toBe(`#flashcard(_lang: "haskell", from: "c/ex")[a][b]\n#cloze[x ${gapOpen(1)}y${GAP_CLOSE}\nz ${gapOpen(2)}w${GAP_CLOSE}]`);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
  });
});

describe('warnings', () => {
  it('names cards without a back, clozes without a gap, and unknown exercises', () => {
    const src = '#flashcard[front]\n#flashcard[][b]\n#cloze[no gap]\n#flashcard(from: "x/nope")[a][b]\n#flashcard(from: "x/yes")[a][b]';
    expect(deckWarnings(src, (ref) => ref === 'x/yes')).toEqual([
      { code: 'no-back', line: 1, column: 1 },
      { code: 'empty-front', line: 2, column: 1 },
      { code: 'no-gap', line: 3, column: 1 },
      { code: 'unknown-from', line: 4, column: 1, detail: 'x/nope' },
    ]);
  });
});

describe('making a card', () => {
  it('writes the text a student would', () => {
    expect(cardText('basic', ' Front ', 'Back\n\nmore', 'c/ex')).toBe('#flashcard(from: "c/ex")[\n  Front\n][\n  Back\n\n  more\n]');
    expect(cardText('both', 'A', 'B', null, 'k3f9', ['lists'])).toBe('#flashcard(id: "k3f9", both: true, tags: ("lists",))[\n  A\n][\n  B\n]');
    expect(cardText('cloze', 'x {{y}}', '', null)).toBe('#cloze[\n  x {{y}}\n]');
    const text = cardText('basic', 'A', 'B', 'c/ex', 'k3f9', [], 'c/a1b2');
    expect(text).toBe('#flashcard(id: "k3f9", from: "c/ex", highlight: "c/a1b2")[\n  A\n][\n  B\n]');
    expect(scanCards(text)[0]).toMatchObject({ from: 'c/ex', highlight: 'c/a1b2' });
    // Editing a card keeps the highlight it came from.
    expect(replaceCard(text, 'k3f9', 'basic', 'A2', 'B2', [])).toContain('highlight: "c/a1b2"');
    expect(appendCard('= Deck\n\n', '#flashcard[a][b]')).toBe('= Deck\n\n#flashcard[a][b]\n');
    expect(appendCard('', '#flashcard[a][b]')).toBe('#flashcard[a][b]\n');
  });

  it('refuses text that would break the deck', () => {
    expect(balanced('a [b] `]` $[0,1)$')).toBe(true);
    expect(balanced('a ] b')).toBe(false);
    expect(balanced('a [ b')).toBe(false);
    expect(balanced('```unclosed')).toBe(false);
  });
});

describe('editing one card in the text', () => {
  const deck = '= Lists\n\n#flashcard(id: "a", from: "c/x")[\n  A front\n][\n  A back\n]\n\nSome words.\n\n#flashcard(id: "b")[B][B back]\n';

  it('reads a card as fields, without its layout', () => {
    expect(dedent('\n    one\n      two\n  ')).toBe('one\n  two');
    const [a] = scanCards(deck);
    expect(fieldsOf(deck, a!)).toMatchObject({ id: 'a', kind: 'basic', from: 'c/x', tags: [], front: 'A front', back: 'A back', line: 3 });
  });

  it('reads tags, as a list or a single one', () => {
    const [x, y] = scanCards('#flashcard(tags: ("lists", "recursion"))[a][b]\n#cloze(tags: "lists")[{{a}}]');
    expect(x!.tags).toEqual(['lists', 'recursion']);
    expect(y!.tags).toEqual(['lists']);
  });

  it('rewrites a card, keeping its id and exercise', () => {
    const out = replaceCard(deck, 'a', 'both', 'New', 'Back', ['t'])!;
    expect(scanCards(out)[0]).toMatchObject({ id: 'a', from: 'c/x', kind: 'both', tags: ['t'] });
    expect(out).toContain('Some words.');
    expect(replaceCard(deck, 'nope', 'basic', 'x', 'y', [])).toBeNull();
  });

  it('removes a card and the gap it leaves, and moves cards around text between them', () => {
    expect(removeCard(deck, 'a')).toBe('= Lists\n\nSome words.\n\n#flashcard(id: "b")[B][B back]\n');
    const moved = moveCard(deck, 'b', -1)!;
    expect(scanCards(moved).map((c) => c.id)).toEqual(['b', 'a']);
    expect(moved).toContain('Some words.');
    expect(moveCard(deck, 'a', -1)).toBeNull();
    expect(scanCards(insertAfter(deck, 'a', '#flashcard[new][card]')!).map((c) => c.id)).toEqual(['a', null, 'b']);
  });
});

/** Renders the deck's cards as the prelude would, without Typst. */
const fakeRenderer = {
  language: 'en',
  async renderDeck(source: string) {
    const html = scanCards(source)
      .map((c) => {
        const side = (n: number) => source.slice(c.bodies[n]?.from ?? 0, c.bodies[n]?.to ?? 0);
        const inner = c.kind === 'cloze' ? `<div data-side="text">${side(0)}</div>` : `<div data-side="front">${side(0)}</div><div data-side="back">${side(1)}</div>`;
        return `<aside data-wb="card" data-kind="${c.kind}" data-id="${c.id ?? ''}" data-from="${c.from ?? ''}">${inner}</aside>`;
      })
      .join('');
    return { html, css: '', diagnostics: [] };
  },
} as unknown as TypstRenderer;

describe('scheduling', () => {
  let now = Date.UTC(2026, 10, 2, 9);
  const today = () => now - (now % DAY);
  const make = () => {
    const store = new Store(':memory:');
    return { store, f: new Flashcards(store, () => fakeRenderer, { find: () => null, language: () => 'en', courses: () => [] }, () => now) };
  };

  it('asks new cards, then brings them back after the interval it showed', async () => {
    const { f } = make();
    const deck = f.create('Haskell');
    f.saveSource(deck.id, '#flashcard[What is `map`?][A function]\n#flashcard[Q2][A2]');
    let next = await f.next([deck.id], today(), false);
    expect(next).toMatchObject({ due: 0, fresh: 2, card: { isNew: true, front: 'What is `map`?', back: 'A function', kind: 'basic' } });
    const good = next.card!.intervals[3];
    expect(next.card!.intervals[1]).toBeLessThan(good);
    f.rate(next.card!.key, 3);
    next = await f.next([deck.id], today(), false);
    expect(next.fresh).toBe(1);
    expect(next.card!.front).toBe('Q2');
    f.rate(next.card!.key, 4);
    // Good on a new card is a short learning step: it comes back soon, within the session.
    next = await f.next([deck.id], today(), false);
    expect(next.card?.front).toBe('What is `map`?');
    now += good + 1000;
    next = await f.next([deck.id], today(), false);
    expect(next.card?.front).toBe('What is `map`?');
    expect(next.card?.isNew).toBe(false);
  });

  it('keeps to the cap on new cards a day', async () => {
    const { f } = make();
    const deck = f.create('Many');
    f.update(deck.id, { settings: { newPerDay: 2 } });
    f.saveSource(deck.id, Array.from({ length: 5 }, (_, i) => `#flashcard[Q${i}][A${i}]`).join('\n'));
    expect(f.list(today()).decks[0]).toMatchObject({ cards: 5, fresh: 2, due: 0 });
    f.rate((await f.next([deck.id], today(), false)).card!.key, 4);
    expect(f.list(today()).decks[0]!.fresh).toBe(1);
    f.rate((await f.next([deck.id], today(), false)).card!.key, 4);
    expect(f.list(today()).decks[0]!.fresh).toBe(0);
    now += DAY;
    expect(f.list(today()).decks[0]!.fresh).toBe(2);
  });

  it('asks one gap or direction of a card a day', async () => {
    const { f } = make();
    const deck = f.create('Gaps');
    f.saveSource(deck.id, '#cloze[{{one}} {{two}}]\n#flashcard(both: true)[A][B]');
    const first = await f.next([deck.id], today(), false);
    expect(first).toMatchObject({ fresh: 2, card: { kind: 'cloze', gap: 1 } });
    f.rate(first.card!.key, 4);
    const second = await f.next([deck.id], today(), false);
    expect(second.card).toMatchObject({ kind: 'both', reversed: false, front: 'A' });
    now += DAY;
    const later = await f.next([deck.id], today(), false);
    expect(later.fresh).toBe(2);
    expect(later.card).toMatchObject({ kind: 'cloze', gap: 2 });
  });

  it('keeps the history when a card is reworded or moved to another deck', async () => {
    const { f } = make();
    const a = f.create('A');
    const b = f.create('B');
    const saved = f.saveSource(a.id, '#flashcard[Q][A]');
    const id = scanCards(saved.source)[0]!.id!;
    f.rate((await f.next([a.id], today(), false)).card!.key, 4);
    f.saveSource(a.id, '');
    const moved = f.saveSource(b.id, `#flashcard(id: "${id}")[Q, reworded][A]`);
    expect(moved.edits).toEqual([]);
    expect(f.list(today()).decks.find((d) => d.id === b.id)).toMatchObject({ cards: 1, fresh: 0 });
  });

  it('"not today" puts a card off until tomorrow, and a new one stays new', async () => {
    const { f } = make();
    const deck = f.create('A');
    f.saveSource(deck.id, '#flashcard[Q][A]');
    const next = await f.next([deck.id], today(), false);
    f.bury(next.card!.key, today());
    expect((await f.next([deck.id], today(), false)).card).toBeNull();
    now += DAY;
    expect((await f.next([deck.id], today(), false)).card?.isNew).toBe(true);
  });

  it('offers early review of what comes up in the next days', async () => {
    const { f } = make();
    const deck = f.create('A');
    f.saveSource(deck.id, '#flashcard[Q][A]');
    const key = (await f.next([deck.id], today(), false)).card!.key;
    f.rate(key, 4); // Easy: straight to review, days away
    now += DAY;
    const next = await f.next([deck.id], today(), false);
    expect(next.card).toBeNull();
    if (next.ahead) expect((await f.next([deck.id], today(), true)).card?.key).toBe(key);
  });

  it('schedules nothing after the exam', async () => {
    const { f } = make();
    const deck = f.create('A');
    const exam = new Date(now + 5 * DAY).toISOString().slice(0, 10);
    f.update(deck.id, { settings: { readyBy: exam } });
    f.saveSource(deck.id, '#flashcard[Q][A]');
    const next = await f.next([deck.id], today(), false);
    expect(next.card!.intervals[4]).toBeLessThanOrEqual(6 * DAY);
  });
});

describe('cards that keep slipping, and how well cards are known', () => {
  let now = Date.UTC(2026, 10, 2, 9);
  const today = () => now - (now % DAY);
  const make = () => {
    const store = new Store(':memory:');
    return new Flashcards(store, () => fakeRenderer, { find: () => null, language: () => 'en', courses: () => [] }, () => now);
  };
  /** Reviews a card once a day, with the given ratings. */
  const reviewDaily = async (f: Flashcards, deck: string, ratings: (1 | 2 | 3 | 4)[]) => {
    for (const r of ratings) {
      const next = await f.next([deck], today(), true);
      if (next.card) f.rate(next.card.key, r);
      now += 2 * DAY;
    }
  };

  it('counts new, learning, unsure and solid cards: the levels of a student\'s own ratings', async () => {
    const f = make();
    const deck = f.create('A');
    f.saveSource(deck.id, '#flashcard[Q1][A1]\n#flashcard[Q2][A2]');
    expect(f.list(today()).decks[0]!.confidence).toEqual({ solid: 0, learning: 0, shaky: 0, fresh: 2 });
    f.rate((await f.next([deck.id], today(), false)).card!.key, 4);
    expect(f.list(today()).decks[0]!.confidence).toEqual({ solid: 1, learning: 0, shaky: 0, fresh: 1 });
    // Forgotten on its first go: still being learned, not yet unsure.
    f.rate((await f.next([deck.id], today(), false)).card!.key, 1);
    expect(f.list(today()).decks[0]!.confidence).toEqual({ solid: 1, learning: 1, shaky: 0, fresh: 0 });
    now += 400 * DAY;
    expect(f.list(today()).decks[0]!.confidence.shaky).toBeGreaterThanOrEqual(1);
  });

  it('offers a card forgotten again and again, until it is kept as it is', async () => {
    const f = make();
    const deck = f.create('A');
    f.saveSource(deck.id, '#flashcard[Hard][card]');
    await reviewDaily(f, deck.id, [2, 1, 2]);
    expect(await f.strugglingCards(null)).toEqual([]);
    const key = (await f.next([deck.id], today(), true)).card!.key;
    expect(f.rate(key, 1)).toEqual({ struggling: true });
    const [s] = await f.strugglingCards(deck.id);
    expect(s).toMatchObject({ deckId: deck.id, card: { front: 'Hard', back: 'card' }, ratings: [{ rating: 2 }, { rating: 1 }, { rating: 2 }, { rating: 1 }] });
    expect(f.list(today()).decks[0]!.struggling).toBe(1);
    f.keep(s!.card.id);
    expect(await f.strugglingCards(null)).toEqual([]);
    now += DAY;
    await reviewDaily(f, deck.id, [1]);
    expect(await f.strugglingCards(null)).toHaveLength(1);
  });

  it('gives a deck made in a course to that course', () => {
    const f = make();
    expect(f.create('A', ['deklprog']).settings.courses).toEqual(['deklprog']);
  });
});

describe('flashcards API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base: string;
  let courses: CourseManager;
  const api = async <T = unknown>(method: string, url: string, body?: unknown) => {
    const res = await fetch(`http://${base}${url}`, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
  };

  const start = async (contentDir: string) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cards-'));
    const config = { ...loadConfig({ CONTENT_DIR: contentDir, DATA_DIR: dataDir, TYPST_BIN: typstBin } as NodeJS.ProcessEnv), port: 0 };
    courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 1000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  };
  const stop = async () => {
    await app.close();
    courses.close();
  };

  describe('without a course', () => {
    beforeAll(() => start(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-nocourse-'))));
    afterAll(stop);

    it('works before any course is added', async () => {
      expect((await api('GET', '/api/outline')).status).toBe(409);
      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'Mine' })).json;
      const saved = (await api<DeckSaved>('PUT', `/api/flashcards/decks/${deck.id}/source`, { source: '#flashcard[Q][A]' })).json;
      expect(saved.edits).toHaveLength(1);
      expect(saved.source).toMatch(/^#flashcard\(id: "[a-z0-9]{4}"\)\[Q\]\[A\]$/);
      const list = (await api<FlashcardsResponse>('GET', `/api/flashcards?today=${Date.now() - 3600_000}`)).json;
      expect(list).toMatchObject({ lastDeckId: deck.id, decks: [{ id: deck.id, title: 'Mine', cards: 1, fresh: 1 }] });
    });

    it('rejects a card whose brackets do not close', async () => {
      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'X' })).json;
      expect((await api('POST', `/api/flashcards/decks/${deck.id}/cards`, { kind: 'basic', front: 'a ]', back: 'b' })).status).toBe(400);
    });
  });

  describe('with a course', () => {
    beforeAll(() => start(EXAMPLE_CONTENT));
    afterAll(stop);

    it('makes a card from an exercise, which points back to it', async () => {
      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'Deklprog' })).json;
      const made = (await api<DeckSaved & { cardId: string }>('POST', `/api/flashcards/decks/${deck.id}/cards`, { kind: 'basic', front: 'What are side effects?', back: 'Effects beyond the result.', exercise: 'side-effects' })).json;
      expect(made.source).toBe(`#flashcard(id: "${made.cardId}", from: "deklarative-programmierung/side-effects")[\n  What are side effects?\n][\n  Effects beyond the result.\n]\n`);
      expect(made.warnings).toEqual([]);
      const unknown = (await api<DeckSaved>('PUT', `/api/flashcards/decks/${deck.id}/source`, { source: made.source + '#flashcard(from: "deklarative-programmierung/nope")[a][b]\n' })).json;
      expect(unknown.warnings).toEqual([{ code: 'unknown-from', line: 6, column: 1, detail: 'deklarative-programmierung/nope' }]);
    });

    it.skipIf(!haveTypst)('renders cards, with code in the language of their exercise and gaps marked', async () => {
      const source = '#flashcard(from: "deklarative-programmierung/prolog-laenge")[What does this do?][```\nlaenge([], 0).\n```]\n#cloze[`map` applies {{a function}} to {{every element}}.]';
      const p = (await api<DeckPreview>('POST', '/api/flashcards/preview', { source })).json;
      expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(p.html).toContain('data-wb="card"');
      expect(p.html).toMatch(/<code data-lang="prolog">/);
      expect(p.html).toContain('class="wb-card-from"');
      expect(p.html).toContain(`${gapOpen(1)}a function${GAP_CLOSE}`);

      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'Render' })).json;
      await api('PUT', `/api/flashcards/decks/${deck.id}/source`, { source });
      const next = (await api<ReviewNext>('GET', `/api/flashcards/review?decks=${deck.id}&today=${Date.now() - 3600_000}`)).json;
      expect(next.card).toMatchObject({ kind: 'basic', origin: { title: expect.any(String), href: '#/item/prolog-laenge' } });
      expect(next.card!.back).toContain('laenge');
      expect((await api('POST', '/api/flashcards/review', { key: next.card!.key, rating: 3 })).status).toBe(200);
    });

    it('counts cards on the course review page, by chapter and by tag', async () => {
      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'Course', forCourse: true })).json;
      expect(deck.settings.courses).toEqual(['deklarative-programmierung']);
      await api('POST', `/api/flashcards/decks/${deck.id}/cards`, { kind: 'basic', front: 'Q', back: 'A', exercise: 'side-effects', tags: ['own-tag'] });
      const { json } = await api<{ chapters: Record<string, unknown>; tags: Record<string, unknown>; struggling: unknown[] }>('GET', '/api/flashcards/course');
      expect(Object.values(json.chapters).some((c) => (c as { fresh: number }).fresh >= 1)).toBe(true);
      expect(json.tags['own-tag']).toEqual({ solid: 0, learning: 0, shaky: 0, fresh: 1 });
    });

    it('counts a card toward a course tag named by its label', async () => {
      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'Labels' })).json;
      await api('POST', `/api/flashcards/decks/${deck.id}/cards`, { kind: 'basic', front: 'Q', back: 'A', exercise: 'side-effects', tags: ['Typklassen'] });
      const { json } = await api<{ tags: Record<string, unknown> }>('GET', '/api/flashcards/course');
      expect(json.tags['typklassen']).toBeDefined();
      expect(json.tags['Typklassen']).toBeUndefined();
    });

    it('deletes all of the student\'s data, but keeps the courses', async () => {
      await api('PUT', '/api/settings', { displayName: 'Ada' });
      expect((await api('POST', '/api/reset-all', {})).status).toBe(400);
      expect((await api('POST', '/api/reset-all', { confirm: 'reset' })).status).toBe(200);
      expect((await api<FlashcardsResponse>('GET', '/api/flashcards')).json.decks).toEqual([]);
      expect((await api<{ displayName: string }>('GET', '/api/settings')).json.displayName).toBe('');
      expect((await api<{ courses: unknown[] }>('GET', '/api/courses')).json.courses).toHaveLength(1);
    });

    it('suggests every upcoming examination period of the courses its cards come from', async () => {
      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'Exams' })).json;
      await api('POST', `/api/flashcards/decks/${deck.id}/cards`, { kind: 'basic', front: 'Q', back: 'A', exercise: 'side-effects' });
      const doc = (await api<DeckDoc>('GET', `/api/flashcards/decks/${deck.id}`)).json;
      expect(doc.exams).toEqual([
        { title: 'Erster Prüfungszeitraum', date: '2099-02-12', courseTitle: 'Deklarative Programmierung' },
        { title: 'Zweiter Prüfungszeitraum', date: '2099-04-01', courseTitle: 'Deklarative Programmierung' },
      ]);
      expect(doc.suggestedCourses).toEqual(['deklarative-programmierung']);
    });

    it('edits, moves and deletes single cards', async () => {
      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'Edit' })).json;
      await api('PUT', `/api/flashcards/decks/${deck.id}/source`, { source: '#flashcard[One][1]\n\n#flashcard[Two][2]' });
      const [one, two] = (await api<DeckDoc>('GET', `/api/flashcards/decks/${deck.id}`)).json.cards;
      const edited = (await api<DeckSaved>('PUT', `/api/flashcards/decks/${deck.id}/cards/${one!.id}`, { kind: 'cloze', front: 'Uno {{1}}', tags: [] })).json;
      expect(edited.cards[0]).toMatchObject({ id: one!.id, kind: 'cloze', front: 'Uno {{1}}' });
      expect((await api<DeckSaved>('POST', `/api/flashcards/decks/${deck.id}/cards/${two!.id}/move`, { direction: -1 })).json.cards.map((c) => c.id)).toEqual([two!.id, one!.id]);
      expect((await api<DeckSaved>('DELETE', `/api/flashcards/decks/${deck.id}/cards/${one!.id}`)).json.cards.map((c) => c.id)).toEqual([two!.id]);
      expect((await api('PUT', `/api/flashcards/decks/${deck.id}/cards/${one!.id}`, { kind: 'basic', front: 'x', back: 'y' })).status).toBe(404);
    });

    it('builds a prompt that checks the deck and never asks for new cards', async () => {
      const deck = (await api<DeckDoc>('POST', '/api/flashcards/decks', { title: 'P' })).json;
      await api('PUT', `/api/flashcards/decks/${deck.id}/source`, { source: '#flashcard[{title} Q][A]' });
      const { json } = await api<{ text: string }>('POST', `/api/flashcards/decks/${deck.id}/prompt`, { lang: 'en' });
      expect(json.text).toContain('Do not write new cards');
      expect(json.text).toContain('[{title} Q][A]');
    });
  });
});

describe('plainCardText', () => {
  it('turns a quiz into its words', () => {
    expect(plainCardText('[Welchen Typ hat `f`?],\nchoice[`Maybe r`][Falsch.],\nchoice(correct: true)[`r`][Richtig.],')).toBe('Welchen Typ hat f? Maybe r – Falsch. r – Richtig.');
  });
});
