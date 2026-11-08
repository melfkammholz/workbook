import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { SLD_TREE_TEST, type CheckRun, type Diagnostic } from '@wb/shared';
import type { ServerCode } from '../content/loader.js';
import { syncFiles } from './files.js';
import { runProcess } from './haskell-check.js';
import type { LoadResult } from './ghci.js';
import type { ReplEvents } from './repl.js';

/**
 * `sldcheck` (https://github.com/melfkammholz/sldcheck, version 0.2 or newer) checks an SLD tree written in its
 * notation against a Prolog program. `sldcheck --json TREE PROGRAM` prints a JSON object `{ version, diagnostics:
 * [{ severity, code, file, line, column, endLine, endColumn, message }] }` and exits with 0 (no errors) or 1 (errors).
 * A syntax error is a diagnostic too (`S001` in the tree, `S002` in the program), with exit status 2. `--syntax` only
 * reads the tree, which is all the live check needs.
 */

interface Finding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  line: number;
  column: number;
  /** Where it ends (exclusive), when sldcheck says. */
  endLine?: number;
  endColumn?: number;
  message: string;
}

/** A tree without anything in it, for example the empty starter: not worth a syntax error. */
export function isBlank(tree: string): boolean {
  return tree.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').every((l) => l.trim() === '' || l.trim().startsWith('%'));
}

/** A syntax error: in the tree, or in the program of the exercise. */
export type InputProblem = { in: 'tree' | 'program'; line: number; column: number; endLine?: number; endColumn?: number; message: string };

/** The diagnostics of `--json`, or null when the output is not what is expected. */
export function parseFindings(stdout: string): Finding[] | null {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return null;
  }
  const list = (json as { diagnostics?: unknown } | null)?.diagnostics;
  if (!Array.isArray(list)) return null;
  const out: Finding[] = [];
  for (const f of list as Record<string, unknown>[]) {
    const { severity, code, line, column, endLine, endColumn, message } = f ?? {};
    if ((severity !== 'error' && severity !== 'warning' && severity !== 'info') || typeof code !== 'string' || typeof line !== 'number' || typeof column !== 'number' || typeof message !== 'string') return null;
    out.push({ severity, code, line, column, message, ...(typeof endLine === 'number' && typeof endColumn === 'number' ? { endLine, endColumn } : {}) });
  }
  return out;
}

/** A syntax error that came as a diagnostic: `S001` is in the tree, `S002` in the program. */
function inputProblemOf(findings: Finding[]): InputProblem | null {
  const f = findings.find((x) => x.code === 'S001' || x.code === 'S002');
  if (!f) return null;
  return { in: f.code === 'S002' ? 'program' : 'tree', line: f.line, column: f.column, message: f.message, ...(f.endLine !== undefined && f.endColumn !== undefined ? { endLine: f.endLine, endColumn: f.endColumn } : {}) };
}

/** A marker from the start of the problem to the end of its line, since the checker gives no extent. */
function diagnostic(file: string, tree: string, f: { severity: 'error' | 'warning'; code: string | null; line: number; column: number; endLine?: number; endColumn?: number; message: string }): Diagnostic {
  const text = tree.split('\n')[f.line - 1] ?? '';
  return {
    severity: f.severity,
    file,
    line: f.line,
    column: f.column,
    endLine: f.endLine ?? f.line,
    endColumn: f.endColumn ?? Math.max(f.column + 1, text.length + 1),
    code: f.code,
    message: f.message,
  };
}



export type SldOutcome =
  | { kind: 'findings'; findings: Finding[] }
  | { kind: 'syntax'; problem: InputProblem }
  | { kind: 'program'; problem: InputProblem }
  | { kind: 'failed'; message: string }
  | { kind: 'stopped' };

/** Writes the tree and the program into `dir` and runs `sldcheck` there. */
export async function runSldcheck(o: { bin: string; dir: string; code: ServerCode; tree: string; timeoutMs: number; signal?: AbortSignal; syntaxOnly?: boolean }): Promise<SldOutcome> {
  const { code, dir } = o;
  if (code.program === null) return { kind: 'failed', message: 'This exercise has no program to check the tree against.' };
  syncFiles(dir, { ...code.support, [code.studentPath]: o.tree });
  // `--syntax` reads the tree and nothing else, which is quicker. `./`: a file name that starts with a dash must not be taken for an option.
  const r = await runProcess(o.bin, ['--json', ...(o.syntaxOnly ? ['--syntax'] : []), `./${code.studentPath}`, `./${code.program}`], dir, o.timeoutMs, o.signal);
  if (r.stopped) return { kind: 'stopped' };
  if (r.spawnError) return { kind: 'failed', message: `Could not start ${o.bin}: ${r.spawnError}` };
  if (r.timedOut) return { kind: 'failed', message: 'The check took too long and was stopped.' };
  if (r.code === 0 || r.code === 1) {
    const findings = parseFindings(r.stdout);
    return findings ? { kind: 'findings', findings } : { kind: 'failed', message: `${o.bin} printed something unexpected:\n${r.stdout.slice(0, 400)}` };
  }
  const found = r.code === 2 ? parseFindings(r.stdout) : null;
  const problem = found && inputProblemOf(found);
  if (problem) return { kind: problem.in === 'program' ? 'program' : 'syntax', problem };
  return { kind: 'failed', message: r.stderr.trim().split('\n').slice(0, 8).join('\n') || `${o.bin} stopped with status ${r.code}.` };
}

export interface RunSldOptions {
  bin: string;
  workDir: string;
  code: ServerCode;
  files: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The tests of an `sld` exercise: is the tree correct? One test, as the answer is right or it is not. */
export async function runSldChecks(o: RunSldOptions): Promise<CheckRun> {
  const t0 = Date.now();
  const tree = o.files[o.code.studentPath] ?? '';
  const empty = (): CheckRun => ({ compiled: true, diagnostics: [], results: [], stdout: '', runnerError: null, durationMs: Date.now() - t0 });

  if (isBlank(tree)) {
    return { ...empty(), results: [{ name: SLD_TREE_TEST, status: 'fail', message: 'The file is empty: write the tree, starting with the query (?- ...).' }] };
  }

  const dir = path.join(o.workDir, crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    const outcome = await runSldcheck({ bin: o.bin, dir, code: o.code, tree, timeoutMs: o.timeoutMs ?? 30_000, ...(o.signal ? { signal: o.signal } : {}) });
    const file = o.code.studentPath;
    switch (outcome.kind) {
      case 'stopped':
        return { ...empty(), stopped: true };
      case 'failed':
        return { ...empty(), runnerError: outcome.message };
      case 'program':
        return { ...empty(), runnerError: `The program of this exercise has an error (a problem with the exercise, not with your tree):\n${outcome.problem.message}` };
      case 'syntax': {
        return { ...empty(), compiled: false, diagnostics: [diagnostic(file, tree, { severity: 'error', code: null, ...outcome.problem })] };
      }
      case 'findings': {
        const shown = outcome.findings.filter((f): f is Finding & { severity: 'error' | 'warning' } => f.severity !== 'info');
        const errors = shown.filter((f) => f.severity === 'error');
        const diagnostics = shown.map((f) => diagnostic(file, tree, f));
        const message = errors.map((f) => `line ${f.line}: [${f.code}] ${f.message}`).join('\n');
        return { ...empty(), diagnostics, results: [{ name: SLD_TREE_TEST, status: errors.length ? 'fail' : 'pass', message }] };
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface SldSessionOptions {
  bin: string;
  /** Session directory: the files are written here. */
  dir: string;
  code: ServerCode;
}

/**
 * What the editor of an `sld` exercise is connected to. There is no interpreter: every change is only read, so that a
 * syntax error shows while writing. Whether the tree is right is for the tests, because showing every missing branch
 * of a tree that is half drawn would give away what the exercise asks for. It has the shape of the other sessions so that
 * the socket and the pool can treat it alike.
 */
export class SldSession extends EventEmitter<ReplEvents> {
  readonly ready = Promise.resolve();
  readonly busy = false;
  lastActivity = Date.now();
  private dead = false;

  constructor(private readonly opts: SldSessionOptions) {
    super();
  }

  start(): this {
    fs.mkdirSync(this.opts.dir, { recursive: true });
    return this;
  }

  async load(files: Record<string, string>): Promise<LoadResult> {
    this.lastActivity = Date.now();
    const t0 = Date.now();
    const { code, dir, bin } = this.opts;
    const tree = files[code.studentPath] ?? '';
    const done = (diagnostics: Diagnostic[]): LoadResult => ({ ok: diagnostics.length === 0, diagnostics, durationMs: Date.now() - t0 });
    if (this.dead || isBlank(tree)) return done([]);
    const outcome = await runSldcheck({ bin, dir, code, tree, timeoutMs: 10_000, syntaxOnly: true });
    if (outcome.kind !== 'syntax') return done([]);
    return done([diagnostic(code.studentPath, tree, { severity: 'error', code: null, ...outcome.problem })]);
  }

  /** Nothing to type into. */
  input(): void {}
  interrupt(): void {}

  /** The pool forgets a session before it kills it, and the socket knows why it closes: nothing to announce. */
  kill(): void {
    this.dead = true;
  }
}
