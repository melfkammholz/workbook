import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CheckResult, CheckRun, CheckStatus } from '@wb/shared';
import type { ServerCode } from '../content/loader.js';
import { parseGhcDiagnostics } from './diagnostics.js';
import { syncFiles } from './files.js';

const MARK = '@@WB@@';
const MAX_STDOUT = 16_000;
const CHECK_FILE = 'WbCheck.hs';

export interface HaskellCheckOptions {
  runghcBin: string;
  /** Directory containing `Workbook/Check.hs`. */
  libDir: string;
  /** Scratch space for per-run directories. */
  workDir: string;
  code: ServerCode;
  /** The student's files, by session-relative path. */
  files: Record<string, string>;
  /** Wall-clock limit for the whole run (compilation + all checks). */
  timeoutMs?: number;
}

const STATUSES = new Set<CheckStatus>(['pass', 'fail', 'error', 'timeout']);

/** Splits a test program's output into results (marked JSON lines) and whatever the student's code printed. */
export function parseMarkedResults(stdout: string): { results: CheckResult[]; stdout: string } {
  const results: CheckResult[] = [];
  const plain: string[] = [];
  const [head = '', ...pieces] = stdout.split(MARK);
  plain.push(head);
  for (const piece of pieces) {
    const nl = piece.indexOf('\n');
    const jsonText = nl < 0 ? piece : piece.slice(0, nl);
    plain.push(nl < 0 ? '' : piece.slice(nl + 1));
    try {
      const r = JSON.parse(jsonText) as { name: string; status: string; message: string };
      results.push({
        name: String(r.name),
        status: STATUSES.has(r.status as CheckStatus) ? (r.status as CheckStatus) : 'error',
        message: String(r.message ?? ''),
      });
    } catch {
      /* a half-written line, e.g. when the process was killed */
    }
  }
  return { results, stdout: plain.join('').replace(/^\n+/, '').slice(0, MAX_STDOUT).trimEnd() };
}

const MISSING_QUICKCHECK = `The tests need the Haskell package QuickCheck, which is not installed here. This is a problem with the setup, not with your code. The Docker image includes it. Without Docker, install it with:

cabal install --lib QuickCheck`;

/**
 * Runs the exercise's check program against the student's code in a fresh
 * directory, in a separate process (so an infinite loop cannot take down a
 * REPL session and can be killed hard).
 *
 * Interpreted via runghc: for exercise-sized modules this is as fast as
 * compiling, needs no build cache, and cannot go stale.
 */
export async function runHaskellChecks(o: HaskellCheckOptions): Promise<CheckRun> {
  const t0 = Date.now();
  const check = o.code.check;
  if (check === null) {
    return { compiled: true, diagnostics: [], results: [], stdout: '', runnerError: 'This exercise has no tests.', durationMs: 0 };
  }

  const dir = path.join(o.workDir, crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    syncFiles(dir, { ...o.code.support, ...o.files, [CHECK_FILE]: check });
    const { stdout, stderr, timedOut, spawnError } = await runProcess(
      o.runghcBin,
      ['-i.', `-i${o.libDir}`, '-ferror-spans', '-fdiagnostics-color=never', '-Wno-x-partial', ...o.code.options, CHECK_FILE],
      dir,
      o.timeoutMs ?? 30_000,
    );

    const { results, stdout: plainOut } = parseMarkedResults(stdout);

    const diagnostics = parseGhcDiagnostics(stderr);
    const checkErrors = diagnostics.filter((d) => d.file === CHECK_FILE && d.severity === 'error');
    // The workbook's own library failing to load says nothing about the student's code.
    const inLibrary = (file: string) => path.resolve(dir, file).startsWith(path.resolve(o.libDir) + path.sep);
    const libraryErrors = diagnostics.filter((d) => inLibrary(d.file) && d.severity === 'error');
    const studentDiagnostics = diagnostics.filter((d) => d.file !== CHECK_FILE && !inLibrary(d.file));
    const studentErrors = studentDiagnostics.some((d) => d.severity === 'error');

    let runnerError: string | null = null;
    if (spawnError) runnerError = `Could not start ${o.runghcBin}: ${spawnError}`;
    else if ([...libraryErrors, ...checkErrors].some((d) => /Could not (find|load) module.*Test\.QuickCheck/s.test(d.message))) runnerError = MISSING_QUICKCHECK;
    else if (libraryErrors.length > 0) runnerError = `The workbook's test library does not compile (not a problem with your code):\n${libraryErrors[0]!.message}`;
    else if (checkErrors.length > 0)
      runnerError = `The tests do not compile with your code. Often a function has another name or type than the task asks for. If yours match the task, it is a problem with the exercise:\n${checkErrors[0]!.message}`;
    else if (timedOut) runnerError = 'The tests took too long and were stopped (is there an infinite loop?).';
    else if (results.length === 0 && !studentErrors && stderr.trim())
      runnerError = stderr.trim().split('\n').slice(0, 8).join('\n');

    return {
      compiled: !studentErrors,
      diagnostics: studentDiagnostics,
      results,
      stdout: plainOut,
      runnerError,
      durationMs: Date.now() - t0,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runProcess(bin: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string; timedOut: boolean; spawnError: string | null }>((resolve) => {
    // Own process group, so the timeout also kills the ghc child runghc starts.
    const proc = spawn(bin, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: string | null = null;
    const cap = 512_000;
    proc.stdout.setEncoding('utf8').on('data', (d: string) => (stdout.length < cap ? (stdout += d) : undefined));
    proc.stderr.setEncoding('utf8').on('data', (d: string) => (stderr.length < cap ? (stderr += d) : undefined));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-proc.pid!, 'SIGKILL');
      } catch {
        proc.kill('SIGKILL');
      }
    }, timeoutMs);
    proc.on('error', (e) => {
      spawnError = e.message;
    });
    proc.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, spawnError });
    });
  });
}
