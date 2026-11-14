import crypto from 'node:crypto';
import { HELPER_SEEN_MS, REQUEST_SKILL, type AssistantRequest, type RequestKind, type RequestParams, type RequestStatus } from '@wb/shared';
import { announceChanges } from '../db/changes-bus.js';
import type { Store } from '../db/store.js';

/** A run that has been going this long without a report is given up on (the helper's own timeout is shorter). */
const STALE_RUNNING_MS = 15 * 60_000;
/** Finished requests stay listed (for the strip and failure cards) this long unless dismissed. */
const SHOWN_AFTER_MS = 3 * 24 * 3600_000;

type Row = Record<string, unknown>;

const rowToRequest = (r: Row, summary: AssistantRequest['summary']): AssistantRequest => ({
  id: r.id as string,
  kind: r.kind as RequestKind,
  skill: r.skill as string,
  params: JSON.parse(r.params_json as string) as RequestParams,
  workbook: r.workbook as string,
  status: r.status as RequestStatus,
  createdAt: Number(r.created_at),
  startedAt: r.claimed_at === null ? null : Number(r.claimed_at),
  finishedAt: r.finished_at === null ? null : Number(r.finished_at),
  exitCode: r.exit_code === null ? null : Number(r.exit_code),
  logTail: r.log_tail as string,
  summary,
  dismissed: r.dismissed === 1,
});

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** The queue between the app and the student's helper script, in the global store. */
export class AssistantQueue {
  /** When a helper last asked for work (memory only: it is a heartbeat, not data). */
  private seen = 0;

  constructor(private readonly store: () => Store) {}

  private get sql() {
    return this.store().sql;
  }

  // ───────────── key ─────────────

  /** A new key, shown once; the old one stops working. */
  newKey(): string {
    const key = `wbh_${crypto.randomBytes(24).toString('base64url')}`;
    this.sql.run('INSERT INTO helper_key (id, hash, created_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, created_at = excluded.created_at', hash(key), Date.now());
    return key;
  }
  hasKey(): boolean {
    return this.sql.get('SELECT 1 AS x FROM helper_key WHERE id = 1') !== undefined;
  }
  checkKey(key: string): boolean {
    const r = this.sql.get('SELECT hash FROM helper_key WHERE id = 1');
    if (!r) return false;
    const a = Buffer.from(hash(key));
    const b = Buffer.from(r.hash as string);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  heartbeat(): void {
    this.seen = Date.now();
  }
  get connected(): boolean {
    return Date.now() - this.seen < HELPER_SEEN_MS;
  }

  // ───────────── requests ─────────────

  create(kind: RequestKind, params: RequestParams, workbook: string): AssistantRequest {
    const id = crypto.randomUUID();
    this.sql.run(
      "INSERT INTO assistant_requests (id, kind, skill, params_json, workbook, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)",
      id,
      kind,
      REQUEST_SKILL[kind],
      JSON.stringify(params),
      workbook,
      Date.now(),
    );
    announceChanges();
    return this.get(id)!;
  }

  get(id: string): AssistantRequest | null {
    const r = this.sql.get('SELECT * FROM assistant_requests WHERE id = ?', id);
    return r ? rowToRequest(r, this.summaryOf(r)) : null;
  }

  /** What is queued or running, then what finished lately and was not dismissed. */
  list(): AssistantRequest[] {
    this.giveUpOnStale();
    const rows = this.sql.all(
      "SELECT * FROM assistant_requests WHERE status IN ('queued','running') OR (dismissed = 0 AND finished_at > ?) ORDER BY created_at",
      Date.now() - SHOWN_AFTER_MS,
    );
    return rows.map((r) => rowToRequest(r, this.summaryOf(r)));
  }

  /** From the app's own records, not the helper's word: questions read under this request, proposals made while it ran. */
  private summaryOf(r: Row): AssistantRequest['summary'] {
    if (r.status !== 'done' && r.status !== 'failed') return null;
    const from = Number(r.claimed_at ?? r.created_at);
    const to = Number(r.finished_at ?? Date.now());
    const read = this.sql.get('SELECT COUNT(DISTINCT question_id) AS n FROM question_fetches WHERE purpose LIKE ?', `%#${r.id as string}`);
    const proposed = this.sql.get("SELECT COUNT(*) AS n FROM changes WHERE who = 'assistant' AND created_at >= ? AND created_at <= ?", from, to);
    return { read: Number(read?.n ?? 0), proposed: Number(proposed?.n ?? 0) };
  }

  private giveUpOnStale(): void {
    const t = Date.now();
    this.sql.run("UPDATE assistant_requests SET status = 'failed', finished_at = ?, log_tail = 'The helper did not report back.' WHERE status = 'running' AND claimed_at < ?", t, t - STALE_RUNNING_MS);
  }

  /** The oldest queued request, if none is running; it becomes `running`. */
  claim(): AssistantRequest | null {
    this.giveUpOnStale();
    if (this.sql.get("SELECT 1 AS x FROM assistant_requests WHERE status = 'running'")) return null;
    const r = this.sql.get("SELECT id FROM assistant_requests WHERE status = 'queued' ORDER BY created_at LIMIT 1");
    if (!r) return null;
    this.sql.run("UPDATE assistant_requests SET status = 'running', claimed_at = ? WHERE id = ? AND status = 'queued'", Date.now(), r.id as string);
    announceChanges();
    return this.get(r.id as string);
  }

  /** Running requests the student cancelled; the helper stops them and reports. */
  toCancel(): string[] {
    return this.sql.all("SELECT id FROM assistant_requests WHERE status = 'running' AND cancel = 1").map((r) => r.id as string);
  }

  cancel(id: string): boolean {
    const r = this.sql.get('SELECT status FROM assistant_requests WHERE id = ?', id);
    if (!r) return false;
    if (r.status === 'queued') this.sql.run("UPDATE assistant_requests SET status = 'cancelled', finished_at = ? WHERE id = ?", Date.now(), id);
    else if (r.status === 'running') this.sql.run('UPDATE assistant_requests SET cancel = 1 WHERE id = ?', id);
    else return false;
    announceChanges();
    return true;
  }

  /** The helper says how a claimed request ended. */
  report(id: string, exitCode: number, logTail: string): boolean {
    const r = this.sql.get("SELECT cancel FROM assistant_requests WHERE id = ? AND status = 'running'", id);
    if (!r) return false;
    const status: RequestStatus = r.cancel === 1 ? 'cancelled' : exitCode === 0 ? 'done' : 'failed';
    this.sql.run('UPDATE assistant_requests SET status = ?, finished_at = ?, exit_code = ?, log_tail = ? WHERE id = ?', status, Date.now(), exitCode, logTail.slice(-4000), id);
    announceChanges();
    return true;
  }

  dismiss(id: string): boolean {
    const r = this.sql.get("SELECT 1 AS x FROM assistant_requests WHERE id = ? AND status NOT IN ('queued','running')", id);
    if (!r) return false;
    this.sql.run('UPDATE assistant_requests SET dismissed = 1 WHERE id = ?', id);
    announceChanges();
    return true;
  }

  /** A failed or cancelled request goes into the queue again as a new one. */
  retry(id: string): AssistantRequest | null {
    const old = this.get(id);
    if (!old || (old.status !== 'failed' && old.status !== 'cancelled')) return null;
    this.dismiss(id);
    return this.create(old.kind, old.params, old.workbook);
  }
}

const queues = new WeakMap<object, AssistantQueue>();
/** The one queue of a course manager. */
export const queueOf = (courses: { global: Store }): AssistantQueue => {
  let q = queues.get(courses);
  if (!q) queues.set(courses, (q = new AssistantQueue(() => courses.global)));
  return q;
};
