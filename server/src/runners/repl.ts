import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface ReplEvents {
  /** Output produced by what the student typed (not by internal commands). */
  output: [text: string];
  busy: [busy: boolean];
  exit: [reason: string];
}

/**
 * A line-oriented interpreter (ghci, swipl) driven through pipes.
 *
 * Pipes, not a pty: we need clean, ordered output we can parse (diagnostics!)
 * and an exact notion of "the interpreter is idle again", which we get by
 * making the prompt a unique sentinel. Everything between two sentinels is the
 * output of one command.
 *
 * Two kinds of input share the one stdin:
 *  - internal commands (`exec`), e.g. `:reload`, whose output is captured;
 *  - student input (`input`), whose output is streamed to listeners. While a
 *    student's program runs, further input is simply the program's stdin.
 */
export abstract class PipeRepl extends EventEmitter<ReplEvents> {
  protected proc: ChildProcess | null = null;
  protected abstract readonly sentinel: string;
  /** Commands that make the interpreter print `sentinel` as its only prompt. */
  protected abstract promptSetup(): string[];
  protected abstract spawnArgs(): { bin: string; args: string[]; cwd: string };

  private buf = '';
  private started = false;
  private collector: string[] | null = null;
  private waiter: ((out: string) => void) | null = null;
  private rejecter: ((e: Error) => void) | null = null;
  private queuedInput: string[] = [];
  private _busy = false;
  private idleWaiters: (() => void)[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private readyResolve!: () => void;
  private readyReject!: (e: Error) => void;
  readonly ready = new Promise<void>((res, rej) => {
    this.readyResolve = res;
    this.readyReject = rej;
  });
  private dead = false;
  lastActivity = Date.now();

  get busy(): boolean {
    return this._busy;
  }

  start(): this {
    const { bin, args, cwd } = this.spawnArgs();
    // Merge stderr into stdout inside the shell so ordering is exact.
    const proc = spawn('sh', ['-c', 'exec "$0" "$@" 2>&1', bin, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TERM: 'dumb' },
    });
    this.proc = proc;
    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (chunk: string) => this.onData(chunk));
    proc.stdin!.on('error', () => {});
    proc.on('error', (e) => this.onExit(`failed to start ${bin}: ${e.message}`));
    proc.on('exit', (code, signal) => this.onExit(signal ? `terminated by ${signal}` : `exited with code ${code}`));
    for (const cmd of this.promptSetup()) proc.stdin!.write(cmd + '\n');
    return this;
  }

  /** Run an interpreter command and return everything it printed. */
  protected exec(cmd: string, timeoutMs = 60_000): Promise<string> {
    const run = async (): Promise<string> => {
      await this.ready;
      // What the student started has to finish first: its output would end up in
      // this command's result, and this command would be read as the program's input.
      await this.idle();
      if (this.dead) throw new Error('interpreter is not running');
      return new Promise<string>((resolve, reject) => {
        this.collector = [];
        const timer = setTimeout(() => {
          this.waiter = null;
          this.rejecter = null;
          this.collector = null;
          this.kill();
          reject(new Error(`timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
        this.waiter = (out) => {
          clearTimeout(timer);
          this.rejecter = null;
          resolve(out);
        };
        this.rejecter = (e) => {
          clearTimeout(timer);
          reject(e);
        };
        this.proc!.stdin!.write(cmd + '\n');
      });
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  private idle(): Promise<void> {
    if (!this._busy) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Text typed by the student (a command, or input for the running program). */
  input(text: string): void {
    this.lastActivity = Date.now();
    if (this.dead || !this.proc) return;
    if (this.collector) {
      this.queuedInput.push(text);
      return;
    }
    this.setBusy(true);
    this.proc.stdin!.write(text.endsWith('\n') ? text : text + '\n');
  }

  interrupt(): void {
    this.lastActivity = Date.now();
    this.proc?.kill('SIGINT');
  }

  kill(): void {
    if (this.dead) return;
    this.proc?.kill('SIGKILL');
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    for (;;) {
      const i = this.buf.indexOf(this.sentinel);
      if (i < 0) break;
      this.emitText(this.buf.slice(0, i));
      this.buf = this.buf.slice(i + this.sentinel.length);
      this.onPrompt();
    }
    // Hold back a possible partial sentinel at the end of the buffer.
    let keep = 0;
    for (let n = Math.min(this.sentinel.length - 1, this.buf.length); n > 0; n--) {
      if (this.sentinel.startsWith(this.buf.slice(this.buf.length - n))) {
        keep = n;
        break;
      }
    }
    this.emitText(this.buf.slice(0, this.buf.length - keep));
    this.buf = this.buf.slice(this.buf.length - keep);
  }

  private emitText(text: string): void {
    if (!text || !this.started) return; // drop the banner before the first prompt
    if (this.collector) this.collector.push(text);
    else this.emit('output', text);
  }

  private onPrompt(): void {
    // The first prompt is the one we installed ourselves: the interpreter is ready.
    if (!this.started) {
      this.started = true;
      this.readyResolve();
      return;
    }
    if (this.waiter) {
      const done = this.waiter;
      const out = (this.collector ?? []).join('');
      this.waiter = null;
      this.collector = null;
      done(out);
      if (this.queuedInput.length) {
        this.setBusy(true);
        for (const t of this.queuedInput.splice(0)) this.proc!.stdin!.write(t.endsWith('\n') ? t : t + '\n');
      }
      return;
    }
    this.setBusy(false);
  }

  private setBusy(b: boolean): void {
    if (this._busy === b) return;
    this._busy = b;
    this.emit('busy', b);
    if (!b) for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  private onExit(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    this.readyReject(new Error(reason));
    this.ready.catch(() => {});
    this.rejecter?.(new Error(`interpreter ${reason}`));
    this.rejecter = null;
    this.waiter = null;
    this.collector = null;
    this.setBusy(false);
    this.emit('exit', reason);
  }
}
