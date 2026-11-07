import crypto from 'node:crypto';
import {
  DEFAULT_DECK_SETTINGS,
  type CardConfidence,
  type CardKind,
  type CardOrigin,
  type CardRating,
  type CourseCards,
  type DeckCard,
  type DeckDoc,
  type DeckPreview,
  type DeckSaved,
  type DeckSettings,
  type DeckSummary,
  type ExamDate,
  type FlashcardsResponse,
  type RenderedCard,
  type ReviewCard,
  type ReviewNext,
  type StrugglingCard,
} from '@wb/shared';
import { HTMLElement, parse } from 'node-html-parser';
import { createEmptyCard, fsrs, generatorParameters, State, type Card, type CardInput, type Grade } from 'ts-fsrs';
import type { TypstRenderer } from '../content/typst.js';
import { escapeHtml } from '../content/html.js';
import type { Store } from '../db/store.js';
import { appendCard, assignIds, balanced, cardText, deckWarnings, fieldsOf, insertAfter, moveCard, removeCard, replaceCard, scanCards, toTypst, unitsOf, type CardCall, type Unit } from './source.js';

const DAY = 86_400_000;
/** A card being learned that comes up again this soon is shown now rather than making the student wait. */
const LEARN_AHEAD = 20 * 60_000;
/** Reviewing early may reach this far ahead. */
const AHEAD_DAYS = 3;
/** Below this chance of still being remembered, a card counts as shaky. */
const SHAKY_BELOW = 0.8;
/** Forgotten this often after it was known: the card itself may be the problem. */
const STRUGGLING_LAPSES = 3;

export interface Found extends CardOrigin {
  language: string | null;
  /** The course's stable id. */
  course: string;
  chapterId: string | null;
  tags: string[];
  courseTags: { id: string; label: string }[];
  exams: { title: string | null; date: string }[];
}

export interface Resolver {
  /** The exercise behind a `from:`. */
  find(ref: string): Found | null;
  /** Language of the text in decks (hyphenation, quotes). */
  language(): string;
  /** The student's courses, by stable id. */
  courses(): { id: string; title: string }[];
}

interface DeckRow {
  id: string;
  title: string;
  source: string;
  settings: DeckSettings;
  position: number;
}

interface ScheduleRow {
  card: CardInput;
  due: number;
  buriedUntil: number | null;
}

type Row = Record<string, unknown>;
type Grouping = 'solid' | 'shaky' | 'fresh';

export class FlashcardError extends Error {
  constructor(readonly code: 'unknown-deck' | 'unknown-card' | 'unbalanced') {
    super(code);
  }
}

function settingsOf(json: string): DeckSettings {
  try {
    return { ...DEFAULT_DECK_SETTINGS, ...(JSON.parse(json) as Partial<DeckSettings>) };
  } catch {
    return { ...DEFAULT_DECK_SETTINGS };
  }
}

const baseId = (key: string) => key.split(':')[0]!;
/** Never reviewed. A card put off with "not today" before its first review is still new. */
const isNew = (row: ScheduleRow | null | undefined): boolean => !row || row.card.state === State.New;
const plainScheduler = fsrs();

/**
 * Flashcard decks and their schedules. Decks belong to the student, not to a course:
 * they live in the main database and survive a course being removed.
 */
export class Flashcards {
  constructor(
    private readonly store: Store,
    private readonly rendererOf: () => TypstRenderer,
    private readonly resolver: Resolver,
    private readonly now: () => number = Date.now,
  ) {}

  private get sql() {
    return this.store.sql;
  }

  // ───────────────────────── decks ─────────────────────────

  private decks(): DeckRow[] {
    return this.sql
      .all('SELECT id, title, source, settings, position FROM decks ORDER BY position, created_at')
      .map((r) => ({ id: r.id as string, title: r.title as string, source: r.source as string, settings: settingsOf(r.settings as string), position: Number(r.position) }));
  }

  private deck(id: string): DeckRow {
    const d = this.decks().find((x) => x.id === id);
    if (!d) throw new FlashcardError('unknown-deck');
    return d;
  }

  private cardsOf(source: string): DeckCard[] {
    return scanCards(source).map((c) => fieldsOf(source, c));
  }

  /** Upcoming exams of the courses the deck's cards come from. A course may have several examination periods. */
  private exams(d: DeckRow): ExamDate[] {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const seen = new Map<string, ExamDate>();
    for (const c of scanCards(d.source)) {
      const found = c.from ? this.resolver.find(c.from) : null;
      if (!found) continue;
      for (const e of found.exams) if (e.date >= today) seen.set(`${found.course} ${e.date}`, { title: e.title, date: e.date, courseTitle: found.courseTitle });
    }
    return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  get(id: string): DeckDoc {
    const d = this.deck(id);
    const from = new Set(scanCards(d.source).map((c) => (c.from ? this.resolver.find(c.from)?.course : undefined)).filter((x): x is string => !!x));
    const suggestedCourses = [...from].filter((c) => !d.settings.courses.includes(c));
    return { id: d.id, title: d.title, source: d.source, settings: d.settings, cards: this.cardsOf(d.source), exams: this.exams(d), suggestedCourses };
  }

  list(today: number): FlashcardsResponse {
    const decks = this.decks();
    const pool = this.pool(decks, today);
    const knowledge = this.knowledge();
    const summaries: DeckSummary[] = decks.map((d) => {
      const mine = pool.filter((u) => u.deck.id === d.id);
      const cards = scanCards(d.source);
      return {
        id: d.id,
        title: d.title,
        cards: cards.length,
        due: mine.filter((u) => u.bucket === 'due' || u.bucket === 'soon').length,
        fresh: mine.filter((u) => u.bucket === 'fresh').length,
        settings: d.settings,
        confidence: tally(cards.map((c) => knowledge.group(d.source, c))),
        struggling: cards.filter((c) => c.id && knowledge.struggling(c.id)).length,
      };
    });
    const last = this.sql.get('SELECT id FROM decks ORDER BY used_at DESC, position LIMIT 1');
    return { decks: summaries, courses: this.resolver.courses(), lastDeckId: (last?.id as string | undefined) ?? null };
  }

  /** `courses`: e.g. the open course, for a deck made through "Make a card". */
  create(title: string, courses: string[] = []): DeckDoc {
    const id = `d-${crypto.randomBytes(5).toString('hex')}`;
    const now = this.now();
    const position = Number(this.sql.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM decks')!.p);
    this.sql.run('INSERT INTO decks (id, title, source, settings, position, created_at, updated_at, used_at) VALUES (?,?,?,?,?,?,?,?)', id, title, '', JSON.stringify({ courses }), position, now, now, now);
    return this.get(id);
  }

  update(id: string, patch: { title?: string; settings?: Partial<DeckSettings> }): DeckDoc {
    const d = this.deck(id);
    const settings = { ...d.settings, ...patch.settings };
    this.sql.run('UPDATE decks SET title = ?, settings = ?, updated_at = ? WHERE id = ?', patch.title ?? d.title, JSON.stringify(settings), this.now(), id);
    return this.get(id);
  }

  /** The schedules stay: cards pasted into another deck keep their history. */
  remove(id: string): void {
    this.deck(id);
    this.sql.run('DELETE FROM decks WHERE id = ?', id);
  }

  /** Saves the text, with an id written into every card that has none (or a taken one). */
  saveSource(id: string, source: string): DeckSaved {
    this.deck(id);
    const elsewhere = new Set(
      this.decks()
        .filter((d) => d.id !== id)
        .flatMap((d) => scanCards(d.source).map((c) => c.id))
        .filter((x): x is string => !!x),
    );
    const used = new Set(this.sql.all('SELECT key FROM card_schedule').map((r) => baseId(r.key as string)));
    const result = assignIds(source, (x) => elsewhere.has(x), (x) => used.has(x));
    this.sql.run('UPDATE decks SET source = ?, updated_at = ? WHERE id = ?', result.source, this.now(), id);
    return { ...result, warnings: this.warnings(result.source), cards: this.cardsOf(result.source) };
  }

  /** "Make a card", or a card added in the deck's card view: one more card in the text, as if typed there. */
  addCard(id: string, kind: CardKind, front: string, back: string, from: string | null, after: string | null = null, tags: string[] = []): DeckSaved & { cardId: string } {
    const d = this.deck(id);
    check(kind, front, back);
    const before = new Set(scanCards(d.source).map((c) => c.id));
    const text = cardText(kind, front, back, from, null, tags);
    const next = (after && insertAfter(d.source, after, text)) || appendCard(d.source, text);
    const saved = this.saveSource(id, next);
    this.sql.run('UPDATE decks SET used_at = ? WHERE id = ?', this.now(), id);
    const added = scanCards(saved.source).find((c) => c.id && !before.has(c.id));
    return { ...saved, cardId: added?.id ?? '' };
  }

  /** Rewrites one card's text. Its id stays, and with it what was learned. */
  editCard(id: string, cardId: string, kind: CardKind, front: string, back: string, tags: string[]): DeckSaved {
    check(kind, front, back);
    const next = replaceCard(this.deck(id).source, cardId, kind, front, back, tags);
    if (next === null) throw new FlashcardError('unknown-card');
    return this.saveSource(id, next);
  }

  /** Takes a card out of the text. Its history stays, should it be pasted back. */
  deleteCard(id: string, cardId: string): DeckSaved {
    const next = removeCard(this.deck(id).source, cardId);
    if (next === null) throw new FlashcardError('unknown-card');
    this.sql.run('DELETE FROM card_kept WHERE card_id = ?', cardId);
    return this.saveSource(id, next);
  }

  moveCard(id: string, cardId: string, direction: -1 | 1): DeckSaved {
    const d = this.deck(id);
    if (!scanCards(d.source).some((c) => c.id === cardId)) throw new FlashcardError('unknown-card');
    return this.saveSource(id, moveCard(d.source, cardId, direction) ?? d.source);
  }

  private warnings(source: string) {
    return deckWarnings(source, (ref) => this.resolver.find(ref) !== null);
  }

  // ───────────────────────── rendering ─────────────────────────

  private async render(source: string) {
    const renderer = this.rendererOf();
    renderer.language = this.resolver.language();
    const r = await renderer.renderDeck(toTypst(source, (ref) => this.resolver.find(ref)?.language ?? null));
    const root = parse(r.html, { comment: false });
    const cards = new Map<string, RenderedCard>();
    for (const el of root.querySelectorAll('aside[data-wb="card"]')) {
      const id = el.getAttribute('data-id');
      if (!id || cards.has(id)) continue;
      const side = (name: string) => (el.querySelector(`div[data-side="${name}"]`) as HTMLElement | null)?.innerHTML.trim() ?? '';
      const kind = (el.getAttribute('data-kind') ?? 'basic') as CardKind;
      cards.set(id, { id, kind, front: kind === 'cloze' ? side('text') : side('front'), back: kind === 'cloze' ? side('text') : side('back') });
    }
    return { ...r, root, cards };
  }

  /** The deck as the student sees it next to the text, and each card on its own for the card view. */
  async preview(source: string): Promise<DeckPreview> {
    const r = await this.render(source);
    for (const el of r.root.querySelectorAll('aside[data-wb="card"]')) {
      const ref = el.getAttribute('data-from');
      const found = ref ? this.resolver.find(ref) : null;
      if (!found) continue;
      const label = `${escapeHtml(found.title)} <span class="wb-card-course">${escapeHtml(found.courseTitle)}</span>`;
      el.insertAdjacentHTML('beforeend', found.href ? `<a class="wb-card-from" href="${escapeHtml(found.href)}">${label}</a>` : `<p class="wb-card-from">${label}</p>`);
    }
    return { html: r.root.toString(), css: r.css, diagnostics: r.diagnostics, warnings: this.warnings(source), cards: [...r.cards.values()], ...(r.asPicture ? { asPicture: true } : {}) };
  }

  // ───────────────────────── how well cards are known ─────────────────────────

  /** Everything needed to say how a card stands, read once. */
  private knowledge() {
    const now = this.now();
    const sched = this.schedules();
    const history = new Map<string, { rating: CardRating; at: number }[]>();
    for (const r of this.sql.all('SELECT key, rating, reviewed_at FROM card_reviews ORDER BY id')) {
      const id = baseId(r.key as string);
      if (!history.has(id)) history.set(id, []);
      history.get(id)!.push({ rating: Number(r.rating) as CardRating, at: Number(r.reviewed_at) });
    }
    const kept = new Map(this.sql.all('SELECT card_id, kept_at FROM card_kept').map((r) => [r.card_id as string, Number(r.kept_at)]));
    const lapses = (id: string) => [...sched].filter(([k]) => baseId(k) === id).reduce((n, [, row]) => n + (row.card.lapses ?? 0), 0);

    /**
     * Forgotten again and again: three lapses, or three of the last four ratings Again or Hard.
     * After "keep as is" only a new lapse brings it back.
     */
    const struggling = (id: string): boolean => {
      const rs = history.get(id) ?? [];
      const keptAt = kept.get(id);
      if (keptAt !== undefined) return rs.some((r) => r.at > keptAt && r.rating === 1);
      const last = rs.slice(-4);
      return lapses(id) >= STRUGGLING_LAPSES || (last.length === 4 && last.filter((r) => r.rating <= 2).length >= 3);
    };

    const group = (source: string, card: CardCall): Grouping => {
      const rows = unitsOf(source, card).map((u) => sched.get(u.key));
      const reviewed = rows.filter((r): r is ScheduleRow => !isNew(r));
      if (!reviewed.length) return 'fresh';
      if (card.id && struggling(card.id)) return 'shaky';
      const weak = reviewed.some((r) => r.card.state !== State.Review || plainScheduler.get_retrievability(r.card, now, false) < SHAKY_BELOW);
      return weak ? 'shaky' : 'solid';
    };
    return { struggling, group, history, lapses };
  }

  /** Cards that keep being forgotten, in one deck or all. */
  async strugglingCards(deckId: string | null, belongs: (card: CardCall) => boolean = () => true): Promise<StrugglingCard[]> {
    const k = this.knowledge();
    const out: StrugglingCard[] = [];
    for (const d of deckId ? [this.deck(deckId)] : this.decks()) {
      const cards = scanCards(d.source).filter((c) => c.id && belongs(c) && k.struggling(c.id));
      if (!cards.length) continue;
      const r = await this.render(d.source);
      for (const c of cards) {
        const id = c.id!;
        const found = c.from ? this.resolver.find(c.from) : null;
        out.push({
          deckId: d.id,
          deckTitle: d.title,
          card: { ...fieldsOf(d.source, c), id },
          rendered: r.cards.get(id) ?? null,
          css: r.css,
          origin: found ? origin(found) : null,
          lapses: k.lapses(id),
          ratings: (k.history.get(id) ?? []).slice(-12),
        });
      }
    }
    return out;
  }

  /** Every deck and all that was learned with them. */
  reset(): void {
    this.sql.tx(() => {
      for (const table of ['decks', 'card_schedule', 'card_reviews', 'card_kept']) this.sql.run(`DELETE FROM ${table}`);
    });
  }

  /** "Keep as is": the card is fine; it is offered again only after it is forgotten once more. */
  keep(cardId: string): void {
    this.sql.run('INSERT INTO card_kept (card_id, kept_at) VALUES (?, ?) ON CONFLICT(card_id) DO UPDATE SET kept_at = excluded.kept_at', cardId, this.now());
  }

  /** For a course's review page: the cards made from its exercises, by chapter. */
  async courseCards(course: string): Promise<CourseCards> {
    const k = this.knowledge();
    const chapters = new Map<string, Grouping[]>();
    const tags = new Map<string, Grouping[]>();
    const add = (m: Map<string, Grouping[]>, key: string, g: Grouping) => {
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(g);
    };
    const fromCourse = (c: CardCall) => !!c.from && c.from.startsWith(`${course}/`);
    for (const d of this.decks()) {
      for (const c of scanCards(d.source).filter(fromCourse)) {
        const found = this.resolver.find(c.from!);
        if (!found) continue;
        const g = k.group(d.source, c);
        if (found.chapterId) add(chapters, found.chapterId, g);
        // A card may name a course's tag by its id or its label.
        const own = c.tags.map((tag) => found.courseTags.find((t) => t.id === tag || t.label.toLowerCase() === tag.toLowerCase())?.id ?? tag);
        for (const tag of new Set([...found.tags, ...own])) add(tags, tag, g);
      }
    }
    const tallied = (m: Map<string, Grouping[]>) => Object.fromEntries([...m].map(([key, gs]) => [key, tally(gs)]));
    return { chapters: tallied(chapters), tags: tallied(tags), struggling: await this.strugglingCards(null, fromCourse) };
  }

  // ───────────────────────── reviewing ─────────────────────────

  private scheduler(s: DeckSettings) {
    let maximum = 36500;
    if (s.readyBy) {
      const days = Math.floor((Date.parse(`${s.readyBy}T23:59:59`) - this.now()) / DAY);
      if (days >= 1) maximum = days;
    }
    return fsrs(generatorParameters({ request_retention: Math.min(0.97, Math.max(0.7, s.retention)), maximum_interval: maximum, enable_fuzz: true }));
  }

  private schedules(): Map<string, ScheduleRow> {
    const out = new Map<string, ScheduleRow>();
    for (const r of this.sql.all('SELECT key, card, due, buried_until FROM card_schedule')) {
      out.set(r.key as string, { card: JSON.parse(r.card as string) as CardInput, due: Number(r.due), buriedUntil: r.buried_until === null ? null : Number(r.buried_until) });
    }
    return out;
  }

  /**
   * What could come up, sorted into buckets. One card's directions and gaps are
   * siblings: once one of them came up today, the others wait for another day.
   */
  private pool(decks: DeckRow[], today: number) {
    const now = this.now();
    const sched = this.schedules();
    const todays = this.sql.all('SELECT key, deck_id, was_new FROM card_reviews WHERE reviewed_at >= ?', today) as Row[];
    const keysToday = new Set(todays.map((r) => r.key as string));
    const cardsToday = new Set(todays.map((r) => baseId(r.key as string)));
    const picked = new Set<string>();
    type Pooled = { deck: DeckRow; unit: Unit; kind: CardKind; row: ScheduleRow | null; bucket: 'due' | 'fresh' | 'soon' | 'ahead' };
    const out: Pooled[] = [];
    for (const deck of decks) {
      let newLeft = Math.max(0, deck.settings.newPerDay - todays.filter((r) => r.deck_id === deck.id && Number(r.was_new) === 1).length);
      for (const card of scanCards(deck.source)) {
        for (const unit of unitsOf(deck.source, card)) {
          const row = sched.get(unit.key) ?? null;
          const sibling = (cardsToday.has(unit.cardId) || picked.has(unit.cardId)) && !keysToday.has(unit.key);
          if (sibling) continue;
          if (row?.buriedUntil && row.buriedUntil > now) continue;
          let bucket: Pooled['bucket'] | null = null;
          if (isNew(row)) {
            if (newLeft > 0) {
              bucket = 'fresh';
              newLeft--;
            }
          } else if (row) {
            const learning = row.card.state === State.Learning || row.card.state === State.Relearning;
            if (row.due <= now) bucket = 'due';
            else if (learning && row.due <= now + LEARN_AHEAD) bucket = 'soon';
            else if (!learning && row.due < today + AHEAD_DAYS * DAY) bucket = 'ahead';
          }
          if (!bucket) continue;
          if (bucket !== 'ahead') picked.add(unit.cardId);
          out.push({ deck, unit, kind: card.kind, row, bucket });
        }
      }
    }
    return out;
  }

  /** The next card of a session over the decks the student picked. */
  async next(deckIds: string[], today: number, ahead: boolean): Promise<ReviewNext> {
    const decks = deckIds.map((id) => this.deck(id));
    const pool = this.pool(decks, today);
    const of = (b: string) => pool.filter((p) => p.bucket === b);
    const learningFirst = (a: (typeof pool)[number], b: (typeof pool)[number]) => {
      const la = a.row!.card.state === State.Review ? 1 : 0;
      const lb = b.row!.card.state === State.Review ? 1 : 0;
      return la - lb || a.row!.due - b.row!.due;
    };
    const due = of('due').sort(learningFirst);
    const fresh = of('fresh');
    const soon = of('soon').sort((a, b) => a.row!.due - b.row!.due);
    const early = of('ahead').sort((a, b) => a.row!.due - b.row!.due);
    const pick = due[0] ?? fresh[0] ?? soon[0] ?? (ahead ? early[0] : undefined);
    const counts = { due: due.length + soon.length, fresh: fresh.length, ahead: early.length };
    if (!pick) return { card: null, ...counts };
    return { card: await this.reviewCard(pick.deck, pick.unit, pick.kind, pick.row), ...counts };
  }

  private async reviewCard(deck: DeckRow, unit: Unit, kind: CardKind, row: ScheduleRow | null): Promise<ReviewCard> {
    const r = await this.render(deck.source);
    const rendered = r.cards.get(unit.cardId);
    const ref = scanCards(deck.source).find((c) => c.id === unit.cardId)?.from ?? null;
    const found = ref ? this.resolver.find(ref) : null;

    const now = this.now();
    const preview = this.scheduler(deck.settings).repeat(row?.card ?? createEmptyCard(now), now);
    const intervals = Object.fromEntries(([1, 2, 3, 4] as const).map((g) => [g, preview[g as Grade].card.due.getTime() - now])) as Record<CardRating, number>;

    const reversed = unit.side === 'back';
    const front = (reversed ? rendered?.back : rendered?.front) ?? '';
    const back = (reversed ? rendered?.front : rendered?.back) ?? '';
    return { key: unit.key, deckId: deck.id, deckTitle: deck.title, cardId: unit.cardId, kind, gap: unit.gap, reversed, front, back, css: r.css, origin: found ? origin(found) : null, isNew: isNew(row), intervals };
  }

  /** Finds a review unit in whichever deck the card is in now. */
  private locate(key: string): { deck: DeckRow; unit: Unit } {
    for (const deck of this.decks()) {
      for (const card of scanCards(deck.source)) {
        const unit = unitsOf(deck.source, card).find((u) => u.key === key);
        if (unit) return { deck, unit };
      }
    }
    throw new FlashcardError('unknown-card');
  }

  /** Says whether the card now counts as one that keeps being forgotten, so the session can offer to look at it. */
  rate(key: string, rating: CardRating): { struggling: boolean } {
    const { deck, unit } = this.locate(key);
    const now = this.now();
    const row = this.schedules().get(key) ?? null;
    const { card } = this.scheduler(deck.settings).next(row?.card ?? createEmptyCard(now), now, rating as Grade);
    this.sql.tx(() => {
      this.writeSchedule(key, card, now);
      this.sql.run(
        'INSERT INTO card_reviews (key, deck_id, rating, was_new, state, stability, difficulty, due, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)',
        key,
        deck.id,
        rating,
        isNew(row) ? 1 : 0,
        card.state,
        card.stability,
        card.difficulty,
        card.due.getTime(),
        now,
      );
    });
    return { struggling: rating === 1 && this.knowledge().struggling(unit.cardId) };
  }

  /** "Not today": back tomorrow, unrated. A new card stays new. */
  bury(key: string, today: number): void {
    this.locate(key);
    const until = today + DAY;
    const now = this.now();
    if (this.sql.get('SELECT 1 FROM card_schedule WHERE key = ?', key)) this.sql.run('UPDATE card_schedule SET buried_until = ?, updated_at = ? WHERE key = ?', until, now, key);
    else this.sql.run('INSERT INTO card_schedule (key, card, due, buried_until, updated_at) VALUES (?,?,?,?,?)', key, JSON.stringify(createEmptyCard(now)), now, until, now);
  }

  private writeSchedule(key: string, card: Card, now: number): void {
    this.sql.run(
      'INSERT INTO card_schedule (key, card, due, buried_until, updated_at) VALUES (?,?,?,NULL,?) ON CONFLICT(key) DO UPDATE SET card = excluded.card, due = excluded.due, buried_until = NULL, updated_at = excluded.updated_at',
      key,
      JSON.stringify(card),
      card.due.getTime(),
      now,
    );
  }
}

function check(kind: CardKind, front: string, back: string): void {
  if (!balanced(front) || (kind !== 'cloze' && !balanced(back))) throw new FlashcardError('unbalanced');
}

function tally(groups: Grouping[]): CardConfidence {
  return { solid: groups.filter((g) => g === 'solid').length, shaky: groups.filter((g) => g === 'shaky').length, fresh: groups.filter((g) => g === 'fresh').length };
}

const origin = (f: Found): CardOrigin => ({ ref: f.ref, title: f.title, courseTitle: f.courseTitle, href: f.href });
