import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadContent } from '../src/content/loader.js';
import { runChecks } from '../src/runners/checks.js';
import { PrologSession, parsePrologDiagnostics } from '../src/runners/prolog.js';
import { EXAMPLE_CONTENT, PROLOG_LIB, hasBinary } from './helpers.js';

const bin = process.env.SWIPL_BIN ?? 'swipl';

describe('parsePrologDiagnostics', () => {
  it('reads positions and removes the session directory from messages', () => {
    const out = parsePrologDiagnostics('hello\n@@WB-DIAG@@error\t/s/a.pl\t6\t9\t/s/a.pl:6:9: Syntax error: x\x01more\x01\n@@WB-DIAG@@warning\t/s/a.pl\t3\t0\tSingleton variables: [Y]\x01\n', '/s');
    expect(out[0]).toMatchObject({ severity: 'error', file: 'a.pl', line: 6, column: 9, endColumn: 10, message: 'Syntax error: x\nmore' });
    expect(out[1]).toMatchObject({ severity: 'warning', line: 3, column: 1, endColumn: 1000, message: 'Singleton variables: [Y]' });
  });
});

describe.skipIf(!hasBinary(bin))('PrologSession', () => {
  const sessions: PrologSession[] = [];
  const dirs: string[] = [];
  const open = (target?: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pl-'));
    dirs.push(dir);
    const s = new PrologSession({ bin, dir, libDir: PROLOG_LIB, ...(target ? { targets: [target] } : {}) }).start();
    sessions.push(s);
    return s;
  };
  /** What the next student input prints, once the interpreter is idle again. */
  const ask = (s: PrologSession, line: string) =>
    new Promise<string>((resolve) => {
      let text = '';
      const onOut = (t: string) => (text += t);
      s.on('output', onOut);
      const onBusy = (b: boolean) => {
        if (b) return;
        s.off('output', onOut);
        s.off('busy', onBusy);
        resolve(text);
      };
      s.on('busy', onBusy);
      s.input(line);
    });

  afterEach(() => {
    sessions.splice(0).forEach((s) => s.kill());
    dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  it('loads a file, reports problems with positions, and recovers on a fix', async () => {
    const s = open('a.pl');
    const bad = await s.load({ 'a.pl': 'p(1).\nq( :- .\n' });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]).toMatchObject({ severity: 'error', file: 'a.pl', line: 2 });
    expect(bad.diagnostics[0]!.message).not.toContain(os.tmpdir());

    const warn = await s.load({ 'a.pl': 'p(X, Y) :- q(X).\nq(1).\n' });
    expect(warn.ok).toBe(true);
    expect(warn.diagnostics[0]).toMatchObject({ severity: 'warning', line: 1 });
    expect(warn.diagnostics[0]!.message).toContain('Singleton');

    const good = await s.load({ 'a.pl': 'p(1).\np(2).\n' });
    expect(good).toMatchObject({ ok: true, diagnostics: [] });
  });

  it('answers queries with all solutions, and sees the latest code', async () => {
    const s = open('a.pl');
    await s.load({ 'a.pl': 'p(1).\np(2).\n' });
    expect(await ask(s, 'p(X).')).toBe('X = 1 ;\nX = 2.\n');
    expect(await ask(s, 'p(3)')).toBe('false.\n'); // the final dot is optional
    expect(await ask(s, 'p(1).')).toBe('true.\n');
    expect(await ask(s, 'write(hallo), nl.')).toBe('hallo\ntrue.\n');

    await s.load({ 'a.pl': 'p(9).\n' });
    expect(await ask(s, 'p(X).')).toBe('X = 9.\n');
  });

  it('does not lose an answer when the code reloads while a query runs', async () => {
    const s = open('a.pl');
    await s.load({ 'a.pl': 'p(1).\n' });
    const answer = ask(s, 'sleep(0.2), p(X).');
    const reload = s.load({ 'a.pl': 'p(2).\n' });
    expect(await answer).toBe('X = 1.\n');
    expect((await reload).ok).toBe(true);
    expect(await ask(s, 'p(X).')).toBe('X = 2.\n');
  });

  it('survives errors, endless solutions and an interrupted loop', async () => {
    const s = open();
    await s.ready;
    expect(await ask(s, 'gibtsnicht(1).')).toMatch(/^ERROR: .*gibtsnicht\/1/);
    expect(await ask(s, 'foo(')).toMatch(/^ERROR: /);
    expect(await ask(s, 'repeat.')).toContain('first 10 solutions shown');

    const looping = ask(s, 'repeat, fail.');
    await new Promise((r) => setTimeout(r, 200));
    s.interrupt();
    expect(await looping).toContain('Interrupted.');
    expect(await ask(s, 'X = 1.')).toBe('X = 1.\n');
  });
});

describe.skipIf(!hasBinary(bin))('Prolog tests', () => {
  const content = loadContent(EXAMPLE_CONTENT);
  const code = content.exercise('prolog-laenge')!.code!;
  const run = (source: string, override: Partial<typeof code> = {}) =>
    runChecks({
      runghcBin: 'runghc',
      swiplBin: bin,
      haskellLib: '',
      prologLib: PROLOG_LIB,
      workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-plrun-')),
      code: { ...code, ...override },
      files: { [code.studentPath]: source },
    });

  it('passes the reference solutions of the example exercises', async () => {
    for (const id of ['prolog-laenge', 'prolog-familie']) {
      const c = content.exercise(id)!.code!;
      const r = await runChecks({ runghcBin: 'runghc', swiplBin: bin, haskellLib: '', prologLib: PROLOG_LIB, workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-plrun-')), code: c, files: { [c.studentPath]: c.solution! } });
      expect(r.runnerError, id).toBeNull();
      expect(r.compiled, id).toBe(true);
      expect(r.results.length, id).toBeGreaterThan(2);
      expect(r.results.filter((x) => x.status !== 'pass'), id).toEqual([]);
    }
  });

  it('stops a run when asked to, long before the time limit', async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 1_000);
    const t0 = Date.now();
    const r = await runChecks({
      runghcBin: 'runghc',
      swiplBin: bin,
      haskellLib: '',
      prologLib: PROLOG_LIB,
      workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-plrun-')),
      code,
      files: { [code.studentPath]: 'laenge(L, N) :- laenge(L, N).\n' },
      timeoutMs: 60_000,
      signal: stop.signal,
    });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.stopped).toBe(true);
    expect(r.runnerError).toBeNull();
  });

  it('calls an empty starter "not implemented" and not wrong', async () => {
    const r = await run(code.starter);
    expect(r.compiled).toBe(true);
    const direct = r.results.filter((x) => x.status === 'error');
    expect(direct.length).toBeGreaterThan(0);
    expect(direct[0]!.message).toBe('not implemented yet: laenge/2');
  });

  it('shows expected and actual for a wrong answer', async () => {
    const r = await run('laenge(_, 7).\n');
    const wrong = r.results.find((x) => x.name.includes('leere'));
    expect(wrong).toMatchObject({ status: 'fail' });
    expect(wrong!.message).toContain('expected: 0');
    expect(wrong!.message).toContain('got: 7');
  });

  it('reports code that does not load instead of running the tests', async () => {
    const r = await run('laenge( :- .\n');
    expect(r.compiled).toBe(false);
    expect(r.results).toEqual([]);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', line: 1, file: code.studentPath });
  });

  it('keeps what the code prints apart and stops an endless loop', async () => {
    const printed = await run('laenge(_, 0) :- write(hallo), nl.\n');
    expect(printed.stdout).toContain('hallo');
    expect(printed.stdout).not.toContain('@@');

    const looping = await run('laenge(X, N) :- laenge(X, N).\n', { check: 'check("endet", holds(laenge([], 0))).\n' });
    expect(looping.results[0]?.status).toBe('timeout');
  }, 20_000);

  it('blames the exercise when the test file is broken', async () => {
    const r = await run(code.solution!, { check: 'check( :- .\n' });
    expect(r.compiled).toBe(true);
    expect(r.runnerError).toContain('test file itself');
  });
});
