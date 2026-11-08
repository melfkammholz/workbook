import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CheckRun } from '@wb/shared';
import type { ServerCode } from '../content/loader.js';
import { syncFiles } from './files.js';
import { parseMarkedResults, runHaskellChecks, runProcess, stoppedRun } from './haskell-check.js';
import { parsePrologDiagnostics } from './prolog.js';
import { runSldChecks } from './sldcheck.js';

export interface RunChecksOptions {
  runghcBin: string;
  swiplBin: string;
  sldcheckBin: string;
  haskellLib: string;
  prologLib: string;
  workDir: string;
  code: ServerCode;
  files: Record<string, string>;
  timeoutMs?: number;
  /** Stops the run, e.g. when the student presses stop. */
  signal?: AbortSignal;
}

/** Runs an exercise's tests with whatever its language needs. */
export function runChecks(o: RunChecksOptions): Promise<CheckRun> {
  const { runghcBin, haskellLib, workDir, code, files, timeoutMs, signal } = o;
  if (code.language === 'prolog') return runPrologChecks(o);
  if (code.language === 'sld') return runSldChecks({ bin: o.sldcheckBin, workDir, code, files, ...(timeoutMs ? { timeoutMs } : {}), ...(signal ? { signal } : {}) });
  return runHaskellChecks({ runghcBin, libDir: haskellLib, workDir, code, files, ...(timeoutMs ? { timeoutMs } : {}), ...(signal ? { signal } : {}) });
}

const TEST_FILE = 'wb_tests.pl';
const TESTS_START = '@@WB-TESTS@@';

async function runPrologChecks(o: RunChecksOptions): Promise<CheckRun> {
  const t0 = Date.now();
  const none = { compiled: true, diagnostics: [], results: [], stdout: '' };
  if (o.code.check === null) return { ...none, runnerError: 'This exercise has no tests.', durationMs: 0 };

  const dir = path.join(o.workDir, crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    syncFiles(dir, { ...o.code.support, ...o.files, [TEST_FILE]: o.code.check });
    const { stdout, stderr, timedOut, stopped, spawnError } = await runProcess(
      o.swiplBin,
      ['-q', '-f', 'none', '-g', 'workbook_check:main', '-t', 'halt', path.join(o.prologLib, 'workbook_check.pl'), '--', TEST_FILE, ...Object.keys(o.code.files)],
      dir,
      o.timeoutMs ?? 30_000,
      o.signal,
    );
    if (stopped) return stoppedRun(withoutMarkers(stdout), t0);

    const real = fs.realpathSync(dir);
    const all = parsePrologDiagnostics(stdout, real);
    const testErrors = all.filter((d) => d.file === TEST_FILE && d.severity === 'error');
    const diagnostics = all.filter((d) => d.file !== TEST_FILE).map((d) => ({ ...d, file: d.file || o.code.studentPath }));
    const compiled = !diagnostics.some((d) => d.severity === 'error');

    const { results, stdout: plain } = parseMarkedResults(withoutMarkers(stdout));

    let runnerError: string | null = null;
    if (spawnError) runnerError = `Could not start ${o.swiplBin}: ${spawnError}`;
    else if (testErrors.length > 0) runnerError = `The test file itself has an error (a problem with the exercise, not with your code):\n${testErrors[0]!.message}`;
    else if (timedOut) runnerError = 'The tests took too long and were stopped (is there an infinite loop?).';
    else if (results.length === 0 && compiled && stderr.trim()) runnerError = stderr.trim().split('\n').slice(0, 8).join('\n');

    return { compiled, diagnostics, results, stdout: plain, runnerError, durationMs: Date.now() - t0 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The driver's own lines (diagnostics, start of the tests) are not output of the student's code. */
function withoutMarkers(stdout: string): string {
  return stdout
    .split('\n')
    .filter((l) => !l.includes('@@WB-DIAG@@') && l !== TESTS_START)
    .join('\n');
}
