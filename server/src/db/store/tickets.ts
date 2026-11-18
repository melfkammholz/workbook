import { randomUUID } from 'node:crypto';
import { type SQLInputValue } from 'node:sqlite';
import {
  type AnnotationReview,
  type Ticket,
  type TicketLink,
  type TicketLinkKind,
  type AnswerBy,
  TICKET_LINK_KINDS,
  type Anchor,
  MAX_TICKET,
} from '@wb/shared';
import type { Store } from '../store.js';
import { rowToTicket } from './shared.js';

export class TicketsPart {
  // ───────────────────────── questions ─────────────────────────

  /** Questions are the student's, in every course: a reset of a course's work keeps them. */
  listTickets(this: Store, filter: { course?: string; exercise?: string; resource?: string } = {}): Ticket[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.course !== undefined) {
      where.push('course = ?');
      params.push(filter.course);
    }
    if (filter.exercise !== undefined) {
      where.push("json_extract(anchor, '$.id') = ?");
      params.push(filter.exercise);
    }
    if (filter.resource !== undefined) {
      where.push("json_extract(anchor, '$.resource') = ?");
      params.push(filter.resource);
    }
    const rows = this.all(`SELECT * FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, rowid`, ...params);
    const labels = this.tagLinks('question');
    const links = this.ticketLinks(rows.map((r) => r.id as string), filter.course === undefined && filter.exercise === undefined && filter.resource === undefined);
    const fetched = this.ticketFetches();
    return rows.map((r) => rowToTicket(r, labels.get(r.id as string) ?? [], links.get(r.id as string) ?? [], fetched.get(r.id as string) ?? null));
  }

  /** The assistant read these questions through the MCP; `purpose` says why (the skill or prompt that asked). */
  logTicketFetches(this: Store, ids: string[], purpose: string): void {
    const t = this.now();
    for (const id of ids) this.run('INSERT INTO ticket_fetches (ticket_id, at, purpose) SELECT id, ?, ? FROM tickets WHERE id = ?', t, purpose, id);
  }

  /** The latest read of each question that was read. */
  ticketFetches(this: Store): Map<string, { at: number; purpose: string }> {
    const rows = this.all('SELECT ticket_id, at, purpose FROM ticket_fetches WHERE id IN (SELECT MAX(id) FROM ticket_fetches GROUP BY ticket_id)');
    return new Map(rows.map((r) => [r.ticket_id as string, { at: Number(r.at), purpose: r.purpose as string }]));
  }

  getTicket(this: Store, id: string): Ticket | null {
    const r = this.get('SELECT * FROM tickets WHERE id = ?', id);
    if (!r) return null;
    const f = this.get('SELECT at, purpose FROM ticket_fetches WHERE ticket_id = ? ORDER BY id DESC LIMIT 1', id);
    return rowToTicket(r, this.tagsOf('question', id), this.ticketLinks([id], false).get(id) ?? [], f ? { at: Number(f.at), purpose: f.purpose as string } : null);
  }

  /** The links of these questions (`all`: of every question, in one query), without those whose target is gone. */
  ticketLinks(this: Store, ids: string[], all: boolean): Map<string, TicketLink[]> {
    const rows = all
      ? this.all('SELECT ticket_id, kind, ref, created_at FROM ticket_links ORDER BY created_at, ref')
      : ids.length > 50
        ? this.all('SELECT ticket_id, kind, ref, created_at FROM ticket_links ORDER BY created_at, ref').filter((r) => ids.includes(r.ticket_id as string))
        : ids.flatMap((id) => this.all('SELECT ticket_id, kind, ref, created_at FROM ticket_links WHERE ticket_id = ? ORDER BY created_at, ref', id));
    const out = new Map<string, TicketLink[]>();
    if (!rows.length) return out;
    const decks = this.db.creators?.cardDecks(rows.filter((r) => r.kind === 'card').map((r) => r.ref as string)) ?? new Map<string, string>();
    for (const r of rows) {
      const kind = r.kind as TicketLinkKind;
      const ref = r.ref as string;
      const link: TicketLink = { kind, ref, createdAt: Number(r.created_at) };
      if (kind === 'card') {
        const deck = decks.get(ref);
        if (!deck) continue;
        link.deck = deck;
      } else if (!this.targetExists(kind, ref)) continue;
      const q = r.ticket_id as string;
      (out.get(q) ?? out.set(q, []).get(q)!).push(link);
    }
    return out;
  }

  targetExists(this: Store, kind: 'note' | 'highlight', ref: string): boolean {
    if (kind === 'note') return this.get('SELECT 1 FROM pdf_pages WHERE id = ?', ref) !== undefined;
    return this.get('SELECT 1 FROM annotations WHERE id = ?', ref) !== undefined || this.get('SELECT 1 FROM pdf_annotations WHERE id = ?', ref) !== undefined;
  }

  /** Records that something was made from a question. False if the question or the target does not exist (nothing is stored). */
  addTicketLink(this: Store, id: string, kind: TicketLinkKind, ref: string): boolean {
    if (!(TICKET_LINK_KINDS as readonly string[]).includes(kind) || !ref || !this.get('SELECT 1 FROM tickets WHERE id = ?', id)) return false;
    const exists = kind === 'card' ? (this.db.creators?.cardDecks([ref]).has(ref) ?? false) : this.targetExists(kind, ref);
    if (!exists) return false;
    this.run('INSERT OR IGNORE INTO ticket_links (ticket_id, kind, ref, created_at) VALUES (?,?,?,?)', id, kind, ref, this.now());
    return true;
  }

  removeTicketLink(this: Store, id: string, kind: string, ref: string): boolean {
    if (this.get('SELECT 1 FROM ticket_links WHERE ticket_id = ? AND kind = ? AND ref = ?', id, kind, ref) === undefined) return false;
    this.run('DELETE FROM ticket_links WHERE ticket_id = ? AND kind = ? AND ref = ?', id, kind, ref);
    return true;
  }

  addTicket(this: Store, q: { id?: string | undefined; text: string; anchor: Anchor; highlightId?: string | null; who?: string }): Ticket {
    const t = this.now();
    const id = q.id ?? `q-${randomUUID()}`;
    const course = 'course' in q.anchor ? q.anchor.course : '';
    this.tx(() => {
      this.run(
        `INSERT INTO tickets (id, text, anchor, course, highlight_id, who, read, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        id, q.text.trim().slice(0, MAX_TICKET), JSON.stringify(q.anchor), course, q.highlightId ?? null, q.who ?? null, q.who ? 0 : 1, t, t,
      );
    });
    return this.getTicket(id)!;
  }

  /**
   * Archiving and reading are filing, not editing: they leave `updated_at` alone (a proposal waits on it). Restoring
   * from the archive forgets when it was archived; the answer, if any, stays.
   */
  updateTicket(this: Store, id: string, patch: { text?: string; archived?: boolean; read?: boolean; answer?: string | null; answerBy?: AnswerBy }): Ticket | null {
    const cur = this.getTicket(id);
    if (!cur) return null;
    const t = this.now();
    const archived = patch.archived ?? cur.archived;
    const archivedAt = archived ? (cur.archived ? cur.archivedAt : t) : null;
    // Restoring a merged duplicate is the student disagreeing: it stands on its own again.
    if (patch.archived === false) this.run('UPDATE tickets SET merged_into = NULL WHERE id = ?', id);
    const edits = patch.text !== undefined || patch.answer !== undefined;
    const answer = patch.answer === undefined ? cur.answer : patch.answer?.trim() ? patch.answer : null;
    this.run(
      'UPDATE tickets SET text = ?, archived = ?, archived_at = ?, read = ?, answer = ?, answer_by = ?, updated_at = ? WHERE id = ?',
      patch.text === undefined ? cur.text : patch.text.trim().slice(0, MAX_TICKET),
      archived ? 1 : 0,
      archivedAt,
      (patch.read ?? cur.read) ? 1 : 0,
      answer,
      answer === null ? null : patch.answer === undefined ? cur.answerBy : (patch.answerBy ?? 'you'),
      edits ? t : cur.updatedAt,
      id,
    );
    return this.getTicket(id);
  }

  /**
   * "Come back to" is an open question without text about the highlight or page `source` (its `highlight_id`):
   * open means to come back to it, done that it is cleared up. The question keeps its own anchor, so it outlives
   * the highlight.
   */
  reviews(this: Store): Map<string, AnnotationReview> {
    const out = new Map<string, AnnotationReview>();
    for (const r of this.all('SELECT highlight_id, archived FROM tickets WHERE highlight_id IS NOT NULL ORDER BY created_at DESC, rowid DESC')) out.set(r.highlight_id as string, Number(r.archived) === 1 ? 'resolved' : 'open');
    return out;
  }

  /** Sets, changes or (null) clears the come-back question of `source`; a cleared one with text of its own stays, unlinked. */
  setReview(this: Store, source: string, review: AnnotationReview | null, anchor: Anchor): void {
    const cur = this.get('SELECT id, text FROM tickets WHERE highlight_id = ? ORDER BY created_at, rowid LIMIT 1', source);
    if (review === null) {
      if (!cur) return;
      if (cur.text) this.run('UPDATE tickets SET highlight_id = NULL WHERE id = ?', cur.id as string);
      else {
        this.run('DELETE FROM tickets WHERE id = ?', cur.id as string);
        this.unlinkAll('question', cur.id as string);
      }
      return;
    }
    const archived = review === 'resolved';
    if (cur) this.updateTicket(cur.id as string, { archived });
    else {
      const q = this.addTicket({ text: '', anchor, highlightId: source });
      if (archived) this.updateTicket(q.id, { archived });
    }
  }

  textAnchor(this: Store, id: string): Anchor {
    const a = this.get('SELECT target, part, quote, prefix, suffix FROM annotations WHERE id = ? AND course = ?', id, this.course)!;
    return { kind: 'text', course: this.course, target: a.target as string, part: a.part as string, quote: a.quote as string, prefix: a.prefix as string, suffix: a.suffix as string };
  }

  deleteTicket(this: Store, id: string): boolean {
    const had = this.get('SELECT 1 FROM tickets WHERE id = ?', id) !== undefined;
    if (had) {
      // Duplicates that were merged into it are open questions again.
      this.run("UPDATE tickets SET merged_into = NULL, archived = 0, archived_at = NULL WHERE merged_into = ?", id);
      this.run('DELETE FROM tickets WHERE id = ?', id);
      this.unlinkAll('question', id);
    }
    return had;
  }

}
