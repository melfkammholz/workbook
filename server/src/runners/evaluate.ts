import crypto from 'node:crypto';
import path from 'node:path';
import { GhciSession } from './ghci.js';
import type { SessionPool } from './pool.js';

export type Evaluation = { ok: true; value: string } | { ok: false; error: string };

const MODULE = 'WbWidget';
const PER_EXPRESSION_MS = 5_000;

/**
 * Works out results for widgets in course text, so authors write the choices and the app the answers.
 * One warm ghci for all of them: each widget's definitions become a module, loaded when they change,
 * and every result is kept, since the same page asks the same questions on every visit.
 */
export class Evaluator {
  private session: GhciSession | null = null;
  private loaded: string | null = null;
  private readonly cache = new Map<string, Evaluation>();
  /** One request at a time: another widget's definitions must not be loaded in the middle of it. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly o: { ghciBin: string; dataDir: string; libDir: string; pool: SessionPool },
  ) {}

  haskell(setup: string, exprs: string[]): Promise<Evaluation[]> {
    const run = this.queue.then(() => this.run(setup, exprs));
    this.queue = run.catch(() => {});
    return run;
  }

  private async run(setup: string, exprs: string[]): Promise<Evaluation[]> {
    const key = (e: string) => crypto.createHash('sha1').update(setup).update('\0').update(e).digest('hex');
    const missing = exprs.filter((e) => !this.cache.has(key(e)));
    if (missing.length) {
      let session: GhciSession;
      try {
        session = await this.open(setup);
      } catch (err) {
        // Not cached: the definitions may load once the interpreter is there.
        return exprs.map(() => ({ ok: false, error: (err as Error).message }));
      }
      for (const e of missing) {
        let result: Evaluation;
        try {
          const out = (await session.evaluate(e, PER_EXPRESSION_MS)).trim();
          result = /^<interactive>:|error:|\*\*\* Exception/.test(out) ? { ok: false, error: out } : { ok: true, value: out };
        } catch (err) {
          result = { ok: false, error: (err as Error).message };
          this.session = null; // timed out and killed: the next one starts afresh
        }
        this.cache.set(key(e), result);
      }
    }
    return exprs.map((e) => this.cache.get(key(e))!);
  }

  private async open(setup: string): Promise<GhciSession> {
    if (!this.session) {
      const dir = path.join(this.o.dataDir, 'sessions', `widgets-${crypto.randomBytes(6).toString('hex')}`);
      const session = new GhciSession({ bin: this.o.ghciBin, dir, libDir: this.o.libDir, options: [], targets: [`${MODULE}.hs`] }).start();
      this.o.pool.add(session, dir, () => {});
      session.once('exit', () => {
        if (this.session === session) this.session = null;
      });
      this.session = session;
      this.loaded = null;
    }
    const session = this.session;
    await session.ready;
    if (this.loaded !== setup) {
      const r = await session.load({ [`${MODULE}.hs`]: `module ${MODULE} where\n${setup}\n` });
      if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join('\n'));
      this.loaded = setup;
    }
    return session;
  }
}
