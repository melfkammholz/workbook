import { randomUUID } from 'node:crypto';
import { announceChanges } from '../changes-bus.js';
import {
  type TicketLinkKind,
  type Change,
  type ChangeField,
  type ChangeRefKind,
  type ChangeValue,
  type CardPayload,
  type HighlightPayload,
  type CreatePayload,
  type Created,
  type QuestionPayload,
  type MergePayload,
  type MergeUndo,
  type WorkPayload,
  type WorkUndo,
  MIN_CONFIDENCE,
  fieldsConfidence,
  MAX_PENDING_CHANGES,
  MAX_TICKET,
} from '@wb/shared';
import type { Store } from '../store.js';
import { type Row, ChangeError, rowToChange, wasArchived, wasArchivedAt } from './shared.js';

export class ChangesPart {
  // ───────────────────────── changes (the assistant inbox) ─────────────────────────

  labelNames(this: Store, ids: string[]): string[] {
    const names = new Map(this.listTags().map((l) => [l.id, l.name]));
    return ids.flatMap((i) => (names.has(i) ? [names.get(i)!] : []));
  }

  setTicketLabels(this: Store, id: string, names: string[]): void {
    this.setTags('question', id, [...new Set(names.map((x) => x.trim()).filter(Boolean))].map((n) => this.ensureTag(n)));
  }

  /**
   * An assistant proposes changes to one question; they wait in the inbox. A pending proposal for the same field is
   * replaced. Returns what was filed, or why not.
   */
  proposeInner(this: Store, who: string, questionId: string, p: { labels?: string[]; answer?: string; text?: string; reason?: string }): { ids: string[] } | { error: string } {
    const q = this.getTicket(questionId);
    if (!q) return { error: 'unknown question' };
    const wanted: [ChangeField, string | string[] | null, string | string[] | null][] = [];
    if (p.labels !== undefined) {
      const names = [...new Set(p.labels.map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 8);
      const cur = this.labelNames(q.labels);
      const next = [...new Set([...cur, ...names])];
      if (next.length !== cur.length) wanted.push(['labels', cur, next]);
    }
    if (p.answer !== undefined && p.answer.trim()) wanted.push(['answer', q.answer, p.answer.trim().slice(0, 8000)]);
    if (p.text !== undefined && p.text.trim() && p.text.trim() !== q.text) wanted.push(['text', q.text, p.text.trim().slice(0, MAX_TICKET)]);
    if (!wanted.length) return { error: 'nothing to change' };
    const pending = Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'")!.n);
    const replaced = wanted.filter(([f]) => this.get("SELECT 1 FROM changes WHERE status = 'pending' AND ref_kind = 'question' AND ref_id = ? AND field = ?", questionId, f)).length;
    if (pending - replaced + wanted.length > MAX_PENDING_CHANGES) return { error: 'inbox full: the student has to go through what is waiting first' };
    const t = this.now();
    const group = this.pendingGroup(questionId) ?? `g-${randomUUID()}`;
    const ids: string[] = [];
    this.tx(() => {
      this.run('UPDATE tickets SET read = 0 WHERE id = ?', questionId);
      for (const [field, before, after] of wanted) {
        this.run("DELETE FROM changes WHERE status = 'pending' AND ref_kind = 'question' AND ref_id = ? AND field = ?", questionId, field);
        const id = `ch-${randomUUID()}`;
        this.run(
          `INSERT INTO changes (id, who, ref_kind, ref_id, field, before, after, base_version, group_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
          id, who, 'question', questionId, field, JSON.stringify(before), JSON.stringify(after), q.updatedAt, group, (p.reason ?? '').slice(0, 500), t,
        );
        ids.push(id);
      }
    });
    return { ids };
  }

  /** The group of what waits for this question (changes to it, cards and notes made from it), so one question's proposals show together. */
  pendingGroup(this: Store, questionId: string): string | undefined {
    const r = this.get(
      `SELECT group_id FROM changes WHERE status = 'pending' AND ((ref_kind = 'question' AND ref_id = ? AND field NOT IN ('create','merge','work'))
         OR (field = 'create' AND ref_kind IN ('card','highlight') AND json_extract(after, '$.question') = ?)) ORDER BY created_at LIMIT 1`,
      questionId, questionId,
    );
    return r ? (r.group_id as string) : undefined;
  }

  /**
   * The assistant proposes making something: a card, a note on a PDF page, a question. It waits in the inbox as a
   * `create` change whose `after` is the payload. Returns the id of the change, or why not.
   */
  proposeCreateInner(this: Store, who: string, kind: ChangeRefKind, payload: CreatePayload, reason = ''): { id: string } | { error: string } {
    if (Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'")!.n) >= MAX_PENDING_CHANGES) return { error: 'inbox full: the student has to go through what is waiting first' };
    const err = this.checkCreate(kind, payload);
    if (err) return { error: err };
    const question = kind === 'question' ? undefined : (payload as CardPayload | HighlightPayload).question;
    if (question !== undefined && !this.get('SELECT 1 FROM tickets WHERE id = ?', question)) return { error: 'unknown question' };
    const id = `ch-${randomUUID()}`;
    if (question !== undefined) this.run('UPDATE tickets SET read = 0 WHERE id = ?', question);
    this.run(
      `INSERT INTO changes (id, who, ref_kind, ref_id, field, before, after, base_version, group_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      id, who, kind, '', 'create', null, JSON.stringify(payload), 0, (question && this.pendingGroup(question)) || `g-${randomUUID()}`, reason.slice(0, 500), this.now(),
    );
    return { id };
  }

  /**
   * The assistant proposes merging duplicates into `survivor`. One waits per survivor (a new one replaces it).
   */
  proposeMergeInner(this: Store, who: string, survivor: string, duplicates: string[], opts: { text?: string; reason?: string } = {}): { id: string } | { error: string } {
    const ids = [...new Set(duplicates)];
    const err = this.checkMerge(survivor, ids);
    if (err) return { error: err };
    if (opts.text !== undefined && (!opts.text.trim() || opts.text.length > MAX_TICKET)) return { error: 'text must be a question of reasonable length' };
    this.run("DELETE FROM changes WHERE status = 'pending' AND ref_kind = 'question' AND ref_id = ? AND field = 'merge'", survivor);
    if (Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'")!.n) >= MAX_PENDING_CHANGES) return { error: 'inbox full: the student has to go through what is waiting first' };
    const id = `ch-${randomUUID()}`;
    this.run('UPDATE tickets SET read = 0 WHERE id = ?', survivor);
    const payload: MergePayload = { duplicates: ids, ...(opts.text?.trim() ? { text: opts.text.trim() } : {}) };
    this.run(
      `INSERT INTO changes (id, who, ref_kind, ref_id, field, before, after, base_version, group_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      id, who, 'question', survivor, 'merge', null, JSON.stringify(payload), 0, `g-${randomUUID()}`, (opts.reason ?? '').slice(0, 500), this.now(),
    );
    return { id };
  }

  /**
   * The assistant proposes the fields of a reference the parser was unsure about (see `flaggedWork`). One waits per
   * work; a new one replaces it.
   */
  proposeWorkInner(this: Store, who: string, workId: string, p: WorkPayload, reason = ''): { id: string } | { error: string } {
    const row = this.get('SELECT * FROM works WHERE id = ?', workId);
    if (!row) return { error: 'unknown reference' };
    if (!this.isFlagged(row)) return { error: 'this reference is not flagged: only references the parser was unsure about can be fixed' };
    const clean = this.checkWork(p);
    if ('error' in clean) return clean;
    this.run("DELETE FROM changes WHERE status = 'pending' AND ref_kind = 'work' AND ref_id = ?", workId);
    if (Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'")!.n) >= MAX_PENDING_CHANGES) return { error: 'inbox full: the student has to go through what is waiting first' };
    const id = `ch-${randomUUID()}`;
    this.run(
      `INSERT INTO changes (id, who, ref_kind, ref_id, field, before, after, base_version, group_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      id, who, 'work', workId, 'work', null, JSON.stringify(clean), 0, `g-${randomUUID()}`, reason.slice(0, 500), this.now(),
    );
    return { id };
  }

  /** The reference entries whose fields the parser could not read (the app shows their text as it is). Not the imported ones. */
  isFlagged(this: Store, r: Row): boolean {
    if (Number(r.imported) === 1) return false;
    const stored = r.confidence === undefined || r.confidence === null ? -1 : Number(r.confidence);
    const c = stored >= 0 ? stored : fieldsConfidence({ title: r.title as string, authors: r.authors as string, year: r.year === null ? null : Number(r.year), venue: r.venue as string, doi: r.doi as string, url: r.url as string });
    return c < MIN_CONFIDENCE;
  }

  checkWork(this: Store, p: WorkPayload): WorkPayload | { error: string } {
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
    const title = s(p?.title, 300);
    const authors = s(p?.authors, 400);
    const venue = s(p?.venue, 300);
    const year = p?.year === null || p?.year === undefined ? null : p.year;
    if (!title) return { error: 'a reference needs a title' };
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2200)) return { error: 'year must be a four-digit number or null' };
    return { title, authors, year, venue };
  }

  applyWork(this: Store, c: Change, value: ChangeValue, undo: boolean): string | null {
    const row = this.get('SELECT * FROM works WHERE id = ?', c.ref.id);
    if (undo) {
      const u = c.before as WorkUndo | null;
      if (!row || !u) return null;
      this.run('UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, confidence = ?, source = ?, updated_at = ? WHERE id = ?', u.title, u.authors, u.year, u.venue, u.confidence, u.source, u.updatedAt, c.ref.id);
      return null;
    }
    if (!row) return 'the reference is gone';
    const p = this.checkWork(value as WorkPayload);
    if ('error' in p) return p.error;
    const before: WorkUndo = { title: row.title as string, authors: row.authors as string, year: row.year === null ? null : Number(row.year), venue: row.venue as string, confidence: row.confidence === null ? -1 : Number(row.confidence), source: row.source as string, updatedAt: Number(row.updated_at) };
    this.run('UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, confidence = 1, updated_at = ? WHERE id = ?', p.title, p.authors, p.year, p.venue, this.now(), c.ref.id);
    this.run('UPDATE changes SET before = ? WHERE id = ?', JSON.stringify(before), c.id);
    return null;
  }

  checkMerge(this: Store, survivor: string, duplicates: string[]): string | null {
    const s = this.getTicket(survivor);
    if (!s) return 'the surviving question does not exist';
    if (s.mergedInto) return 'the surviving question was itself merged into another';
    if (!duplicates.length) return 'name at least one duplicate';
    if (duplicates.length > 20) return 'at most 20 duplicates';
    for (const d of duplicates) {
      if (d === survivor) return 'a question cannot be merged into itself';
      const q = this.getTicket(d);
      if (!q) return `unknown question ${d}`;
      if (q.mergedInto) return `question ${d} was merged already`;
    }
    return null;
  }

  applyMerge(this: Store, c: Change, value: ChangeValue, undo: boolean): string | null {
    if (undo) {
      const u = c.before as MergeUndo | null;
      if (!u?.survivor) return null;
      const s = u.survivor;
      if (this.getTicket(c.ref.id)) {
        this.run('UPDATE tickets SET text = ?, answer = ?, answer_by = ?, archived = ?, archived_at = ?, updated_at = ? WHERE id = ?', s.text, s.answer, s.answer === null ? null : (s.answerBy ?? 'assistant'), wasArchived(s) ? 1 : 0, wasArchivedAt(s), s.updatedAt, c.ref.id);
        this.setTags('question', c.ref.id, s.labels);
      }
      for (const d of u.duplicates) {
        if (!this.getTicket(d.id)) continue;
        this.run('UPDATE tickets SET merged_into = NULL, archived = ?, archived_at = ?, answer = ?, answer_by = ? WHERE id = ?', wasArchived(d) ? 1 : 0, wasArchivedAt(d), d.answer, d.answer === null ? null : (d.answerBy ?? 'assistant'), d.id);
      }
      for (const l of u.links ?? []) {
        if (!this.getTicket(l.from)) continue;
        if (!l.kept) this.run('DELETE FROM ticket_links WHERE ticket_id = ? AND kind = ? AND ref = ?', c.ref.id, l.kind, l.ref);
        this.run('INSERT OR IGNORE INTO ticket_links (ticket_id, kind, ref, created_at) VALUES (?,?,?,?)', l.from, l.kind, l.ref, l.createdAt);
      }
      return null;
    }
    const p = value as MergePayload;
    const dups = Array.isArray(p?.duplicates) ? [...new Set(p.duplicates.filter((x): x is string => typeof x === 'string'))] : [];
    const bad = this.checkMerge(c.ref.id, dups);
    if (bad) return bad;
    if (p.text !== undefined && (typeof p.text !== 'string' || !p.text.trim())) return 'the question needs text';
    const s = this.getTicket(c.ref.id)!;
    const all = dups.map((d) => this.getTicket(d)!);
    const moved: NonNullable<MergeUndo['links']> = [];
    const undo_: MergeUndo = {
      survivor: { text: s.text, answer: s.answer, answerBy: s.answerBy, archived: s.archived, archivedAt: s.archivedAt, updatedAt: s.updatedAt, labels: s.labels },
      duplicates: all.map((q) => ({ id: q.id, archived: q.archived, archivedAt: q.archivedAt, answer: q.answer, answerBy: q.answerBy, labels: q.labels })),
      links: moved,
    };
    // The survivor's answer wins; without one it takes the first duplicate's. Labels are the union, links move over.
    const donor = s.answer?.trim() ? s : all.find((q) => q.answer?.trim());
    const t = this.now();
    this.run('UPDATE tickets SET text = ?, answer = ?, answer_by = ?, updated_at = ? WHERE id = ?', (p.text?.trim() ?? s.text).slice(0, MAX_TICKET), donor?.answer ?? null, donor ? donor.answerBy : null, t, s.id);
    for (const d of all) {
      for (const l of this.all('SELECT kind, ref, created_at FROM ticket_links WHERE ticket_id = ?', d.id)) {
        const kind = l.kind as TicketLinkKind;
        const ref = l.ref as string;
        const kept = this.get('SELECT 1 FROM ticket_links WHERE ticket_id = ? AND kind = ? AND ref = ?', s.id, kind, ref) !== undefined;
        moved.push({ from: d.id, kind, ref, createdAt: Number(l.created_at), kept });
        this.run('INSERT OR IGNORE INTO ticket_links (ticket_id, kind, ref, created_at) VALUES (?,?,?,?)', s.id, kind, ref, Number(l.created_at));
      }
      this.run('DELETE FROM ticket_links WHERE ticket_id = ?', d.id);
    }
    this.setTags('question', s.id, [...new Set(all.flatMap((q) => q.labels))]);
    for (const q of all) this.run("UPDATE tickets SET merged_into = ?, archived = 1, archived_at = ? WHERE id = ?", s.id, q.archived ? (q.archivedAt ?? t) : t, q.id);
    this.run('UPDATE changes SET before = ? WHERE id = ?', JSON.stringify(undo_), c.id);
    return null;
  }

  checkCreate(this: Store, kind: ChangeRefKind, p: CreatePayload): string | null {
    const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (kind === 'question') return text((p as QuestionPayload).text, MAX_TICKET) && (p as QuestionPayload).anchor ? null : 'a question needs text and a place';
    if (kind === 'card') {
      const c = p as CardPayload;
      if (!text(c.front, 4000) || !text(c.back, 4000) && c.cardKind !== 'cloze' && c.cardKind !== 'quiz') return 'a card needs a front and a back';
      return 'id' in c.deck || ('title' in c.deck && text(c.deck.title, 120)) ? null : 'a card needs a deck';
    }
    const h = p as HighlightPayload;
    return text(h.quote, 2000) && typeof h.note === 'string' && Number.isInteger(h.pageIndex) && h.pageIndex >= 0 && text(h.resource, 100) ? null : 'a page note needs a material, a page and a quote';
  }

  // Each of these tells the open tabs that the inbox changed.
  proposeCreate(this: Store, ...a: Parameters<Store['proposeCreateInner']>): ReturnType<Store['proposeCreateInner']> {
    const r = this.proposeCreateInner(...a);
    announceChanges();
    return r;
  }
  proposeWork(this: Store, ...a: Parameters<Store['proposeWorkInner']>): ReturnType<Store['proposeWorkInner']> {
    const r = this.proposeWorkInner(...a);
    announceChanges();
    return r;
  }
  proposeMerge(this: Store, ...a: Parameters<Store['proposeMergeInner']>): ReturnType<Store['proposeMergeInner']> {
    const r = this.proposeMergeInner(...a);
    announceChanges();
    return r;
  }
  propose(this: Store, ...a: Parameters<Store['proposeInner']>): ReturnType<Store['proposeInner']> {
    const r = this.proposeInner(...a);
    announceChanges();
    return r;
  }
  decideChange(this: Store, ...a: Parameters<Store['decideChangeInner']>): ReturnType<Store['decideChangeInner']> {
    const r = this.decideChangeInner(...a);
    announceChanges();
    return r;
  }
  undoChange(this: Store, ...a: Parameters<Store['undoChangeInner']>): ReturnType<Store['undoChangeInner']> {
    const r = this.undoChangeInner(...a);
    announceChanges();
    return r;
  }
  acceptBatch(this: Store, ...a: Parameters<Store['acceptBatchInner']>): ReturnType<Store['acceptBatchInner']> {
    const r = this.acceptBatchInner(...a);
    announceChanges();
    return r;
  }
  undoBatch(this: Store, ...a: Parameters<Store['undoBatchInner']>): ReturnType<Store['undoBatchInner']> {
    const r = this.undoBatchInner(...a);
    announceChanges();
    return r;
  }

  /** Pending ones first, then the latest decided ones. Proposals that no longer fit (question gone, answer edited) expire. */
  listChanges(this: Store, opts: { limit?: number } = {}): Change[] {
    this.expireStale();
    const rows = [
      ...this.all("SELECT * FROM changes WHERE status = 'pending' ORDER BY created_at, rowid"),
      ...this.all("SELECT * FROM changes WHERE status <> 'pending' ORDER BY COALESCE(decided_at, created_at) DESC, rowid DESC LIMIT ?", opts.limit ?? 60),
    ];
    return rows.map(rowToChange);
  }

  hasPendingChanges(this: Store): boolean {
    this.expireStale();
    return this.get("SELECT 1 FROM changes WHERE status = 'pending' LIMIT 1") !== undefined;
  }

  expireStale(this: Store): void {
    const t = this.now();
    this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE status = 'pending' AND ref_kind = 'question' AND field <> 'create' AND NOT EXISTS (SELECT 1 FROM tickets q WHERE q.id = changes.ref_id)", t);
    // A creation only goes stale when what it points at (the deck, the material) is gone.
    for (const r of this.all("SELECT id, ref_kind, after FROM changes WHERE status = 'pending' AND field = 'create' AND ref_kind <> 'question'")) {
      if (this.db.creators?.gone(r.ref_kind as 'card' | 'highlight', JSON.parse(r.after as string) as CreatePayload)) this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE id = ?", t, r.id as string);
    }
    // A reference goes stale when it is gone or no longer unsure (looked up online, or fixed by the student).
    for (const r of this.all("SELECT id, ref_id FROM changes WHERE status = 'pending' AND field = 'work'")) {
      const w = this.get('SELECT * FROM works WHERE id = ?', r.ref_id as string);
      if (!w || !this.isFlagged(w)) this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE id = ?", t, r.id as string);
    }
    for (const r of this.all("SELECT id, ref_id, after FROM changes WHERE status = 'pending' AND field = 'merge'")) {
      const p = JSON.parse(r.after as string) as MergePayload;
      if (this.checkMerge(r.ref_id as string, p.duplicates)) this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE id = ?", t, r.id as string);
    }
    this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE status = 'pending' AND field IN ('answer','text') AND EXISTS (SELECT 1 FROM tickets q WHERE q.id = changes.ref_id AND q.updated_at <> changes.base_version)", t);
  }

  /** Applies a proposal (`after` replaces the proposed value, for accept after editing) or turns it down. */
  decideChangeInner(this: Store, id: string, decision: 'accept' | 'reject', opts: { feedback?: string; after?: ChangeValue } = {}): Change | { error: string } {
    this.expireStale();
    const r = this.get('SELECT * FROM changes WHERE id = ?', id);
    if (!r) return { error: 'unknown change' };
    const c = rowToChange(r);
    if (c.status !== 'pending') return { error: `already ${c.status}` };
    const t = this.now();
    const feedback = (opts.feedback ?? '').slice(0, 500);
    if (decision === 'reject') this.run("UPDATE changes SET status = 'rejected', feedback = ?, decided_at = ? WHERE id = ?", feedback, t, id);
    else {
      const after = opts.after === undefined ? c.after : opts.after;
      try {
        this.tx(() => {
          const err = this.applyChange(c, after);
          if (err) throw new ChangeError(err);
          this.run("UPDATE changes SET status = 'applied', after = ?, feedback = ?, decided_at = ? WHERE id = ?", JSON.stringify(after), feedback, t, id);
        });
      } catch (e) {
        if (e instanceof ChangeError) return { error: e.message };
        throw e;
      }
    }
    return rowToChange(this.get('SELECT * FROM changes WHERE id = ?', id)!);
  }

  /** Puts back what an applied change replaced. */
  undoChangeInner(this: Store, id: string): Change | { error: string } {
    const r = this.get('SELECT * FROM changes WHERE id = ?', id);
    if (!r) return { error: 'unknown change' };
    const c = rowToChange(r);
    // A rejection only closed the proposal: taking it back opens it again, nothing was changed.
    if (c.status === 'rejected') {
      this.run("UPDATE changes SET status = 'pending', feedback = '', decided_at = NULL WHERE id = ?", id);
      return rowToChange(this.get('SELECT * FROM changes WHERE id = ?', id)!);
    }
    if (c.status !== 'applied') return { error: `is ${c.status}, not applied` };
    try {
      this.tx(() => {
        const err = this.applyChange(c, c.before, true);
        if (err) throw new ChangeError(err);
        this.run("UPDATE changes SET status = 'undone', decided_at = ? WHERE id = ?", this.now(), id);
      });
    } catch (e) {
      if (e instanceof ChangeError) return { error: e.message };
      throw e;
    }
    return rowToChange(this.get('SELECT * FROM changes WHERE id = ?', id)!);
  }

  /** Accepts several proposals as one batch (one undo). All or none: if one cannot be applied, nothing changes. */
  acceptBatchInner(this: Store, ids: string[]): { batch: string; changes: Change[] } | { error: string } {
    this.expireStale();
    const unique = [...new Set(ids)];
    if (!unique.length) return { error: 'nothing to accept' };
    const batch = `b-${randomUUID()}`;
    try {
      this.tx(() => {
        for (const id of unique) {
          const r = this.get('SELECT * FROM changes WHERE id = ?', id);
          if (!r) throw new ChangeError('unknown change');
          const c = rowToChange(r);
          if (c.status !== 'pending') throw new ChangeError(`already ${c.status}`);
          const err = this.applyChange(c, c.after);
          if (err) throw new ChangeError(err);
          this.run("UPDATE changes SET status = 'applied', batch_id = ?, decided_at = ? WHERE id = ?", batch, this.now(), id);
        }
      });
    } catch (e) {
      if (e instanceof ChangeError) return { error: e.message };
      throw e;
    }
    return { batch, changes: unique.map((id) => rowToChange(this.get('SELECT * FROM changes WHERE id = ?', id)!)) };
  }

  /** Undoes every applied change of a batch, newest first. All or none. */
  undoBatchInner(this: Store, batch: string): Change[] | { error: string } {
    const rows = this.all("SELECT * FROM changes WHERE batch_id = ? AND status = 'applied' ORDER BY decided_at DESC, rowid DESC", batch);
    if (!rows.length) return { error: 'nothing to undo in this batch' };
    try {
      this.tx(() => {
        for (const r of rows) {
          const c = rowToChange(r);
          const err = this.applyChange(c, c.before, true);
          if (err) throw new ChangeError(err);
          this.run("UPDATE changes SET status = 'undone', decided_at = ? WHERE id = ?", this.now(), c.id);
        }
      });
    } catch (e) {
      if (e instanceof ChangeError) return { error: e.message };
      throw e;
    }
    return rows.map((r) => rowToChange(this.get('SELECT * FROM changes WHERE id = ?', r.id as string)!));
  }

  /** Applies one change (or, with `undo`, takes it back): a field of a question, or a creation. */
  applyChange(this: Store, c: Change, value: ChangeValue, undo = false): string | null {
    if (c.field === 'merge') return this.applyMerge(c, value, undo);
    if (c.field === 'work') return this.applyWork(c, value, undo);
    if (c.field !== 'create') return this.applyField(c.ref.id, c.field, value as string | string[] | null, undo);
    const kind = c.ref.kind as Exclude<ChangeRefKind, 'work'>;
    if (undo) {
      const made = c.before as Created | null;
      if (!made?.id) return null;
      const from = kind === 'question' ? undefined : (c.after as CardPayload | HighlightPayload).question;
      if (from) this.removeTicketLink(from, kind === 'card' ? 'card' : 'note', made.id);
      if (kind === 'question') this.deleteTicket(made.id);
      else this.db.creators?.remove(kind, made);
      this.run("UPDATE changes SET ref_id = '' WHERE id = ?", c.id);
      return null;
    }
    const payload = value as CreatePayload;
    const bad = this.checkCreate(kind, payload);
    if (bad) return bad;
    let made: Created;
    if (kind === 'question') {
      const q = payload as QuestionPayload;
      made = { id: this.addTicket({ text: q.text, anchor: q.anchor, who: c.who }).id };
    } else {
      if (!this.db.creators) return 'cannot be made here';
      try {
        made = this.db.creators.create(kind, payload);
      } catch (e) {
        return e instanceof Error ? e.message : 'could not be made';
      }
    }
    this.run('UPDATE changes SET ref_id = ?, before = ? WHERE id = ?', made.id, JSON.stringify(made), c.id);
    // The student may have edited the payload; the question it comes from is the proposal's own.
    const from = kind === 'question' ? undefined : ((c.after as CardPayload | HighlightPayload).question ?? (payload as CardPayload | HighlightPayload).question);
    if (from) this.addTicketLink(from, kind === 'card' ? 'card' : 'note', made.id);
    return null;
  }

  /** Labels leave `updated_at` alone, so a proposal for the answer is not made stale by another one of the group. */
  applyField(this: Store, questionId: string, field: ChangeField, value: string | string[] | null, undo = false): string | null {
    const q = this.getTicket(questionId);
    if (!q) return 'the question is gone';
    if (field === 'labels') {
      this.setTicketLabels(questionId, Array.isArray(value) ? value : []);
    } else if (field === 'text') {
      if (typeof value !== 'string' || !value.trim()) return 'the question needs text';
      this.updateTicket(questionId, { text: value });
    } else {
      // An answer does not settle the question: it stays open (or done) as the student left it.
      if (undo) this.updateTicket(questionId, { answer: (value as string | null) ?? null });
      else this.updateTicket(questionId, { answer: typeof value === 'string' ? value : null, answerBy: 'assistant' });
    }
    if (field === 'answer' || field === 'text') {
      // Another waiting proposal for the same question (answer and rewrite come in one group) stays current.
      const now = this.getTicket(questionId)!.updatedAt;
      this.run("UPDATE changes SET base_version = ? WHERE status = 'pending' AND ref_kind = 'question' AND ref_id = ? AND field IN ('answer','text')", now, questionId);
    }
    return null;
  }

}
