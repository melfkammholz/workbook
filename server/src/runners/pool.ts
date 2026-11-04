import fs from 'node:fs';
import type { PipeRepl } from './repl.js';

interface Entry {
  session: PipeRepl;
  dir: string;
  evict: (reason: string) => void;
}

/**
 * Bounds the number of live interpreter processes. Sessions are cheap to
 * recreate (ghci starts in ~200 ms), so the least recently used one is simply
 * closed when the limit is reached or when it has been idle for a while; the
 * client reconnects on demand.
 */
export class SessionPool {
  private entries = new Set<Entry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly max: number,
    private readonly idleMs: number,
  ) {}

  start(): void {
    this.timer ??= setInterval(() => this.sweep(), 30_000).unref();
  }

  add(session: PipeRepl, dir: string, evict: (reason: string) => void): Entry {
    while (this.entries.size >= this.max) {
      const oldest = [...this.entries].sort((a, b) => a.session.lastActivity - b.session.lastActivity)[0]!;
      this.close(oldest, 'closed to free resources for another exercise');
    }
    const entry: Entry = { session, dir, evict };
    this.entries.add(entry);
    session.once('exit', () => this.entries.delete(entry));
    return entry;
  }

  /** Close a session because its client went away. */
  release(entry: Entry): void {
    this.close(entry, null);
  }

  private close(entry: Entry, reason: string | null): void {
    if (!this.entries.delete(entry)) return;
    entry.session.kill();
    fs.rm(entry.dir, { recursive: true, force: true }, () => {});
    if (reason) entry.evict(reason);
  }

  private sweep(): void {
    const now = Date.now();
    for (const e of [...this.entries])
      if (!e.session.busy && now - e.session.lastActivity > this.idleMs) this.close(e, 'closed after being idle');
  }

  /** Ends every running session, telling its client why. */
  closeSessions(reason: string): void {
    for (const e of [...this.entries]) this.close(e, reason);
  }

  closeAll(): void {
    if (this.timer) clearInterval(this.timer);
    for (const e of [...this.entries]) this.close(e, null);
  }

  get size(): number {
    return this.entries.size;
  }
}
