import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadContent } from '../src/content/loader.js';
import { GhciSession } from '../src/runners/ghci.js';
import { runHaskellChecks } from '../src/runners/haskell-check.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, hasBinary, hasGhcWithQuickCheck } from './helpers.js';

const haveGhc = hasBinary('ghci');
const haveQuickCheck = hasGhcWithQuickCheck();
const content = loadContent(EXAMPLE_CONTENT);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wb-run-'));

describe.skipIf(!haveGhc)('GhciSession', () => {
  const sessions: GhciSession[] = [];
  afterEach(() => sessions.splice(0).forEach((s) => s.kill()));

  async function start(target?: string) {
    const s = new GhciSession({ bin: 'ghci', dir: tmp(), libDir: HASKELL_LIB, options: [], ...(target ? { targets: [target] } : {}) }).start();
    sessions.push(s);
    await s.ready;
    return s;
  }
  const collect = (s: GhciSession) => {
    const chunks: string[] = [];
    s.on('output', (t) => chunks.push(t));
    return () => chunks.join('');
  };
  const idle = (s: GhciSession) =>
    new Promise<void>((res) => {
      const h = (busy: boolean) => {
        if (!busy) {
          s.off('busy', h);
          res();
        }
      };
      s.on('busy', h);
    });

  it('loads a module, reports errors with positions, and recovers on fix', async () => {
    const s = await start('A.hs');
    const bad = await s.load({ 'A.hs': 'module A where\nf :: Int -> Int\nf x = x + "a"\n' });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]).toMatchObject({ severity: 'error', file: 'A.hs', line: 3 });

    const good = await s.load({ 'A.hs': 'module A where\nf :: Int -> Int\nf x = x * 2\n' });
    expect(good.ok).toBe(true);
    expect(good.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('evaluates expressions against the loaded module and is fast to reload', async () => {
    const s = await start('A.hs');
    const out = collect(s);
    await s.load({ 'A.hs': 'module A where\nf :: Int -> Int\nf x = x * 2\n' });
    const done = idle(s);
    s.input('f 21');
    await done;
    expect(out()).toBe('42\n');

    const r = await s.load({ 'A.hs': 'module A where\nf :: Int -> Int\nf x = x * 3\n' });
    expect(r.ok).toBe(true);
    expect(r.durationMs).toBeLessThan(1500);
    const done2 = idle(s);
    s.input('f 21');
    await done2;
    expect(out()).toBe('42\n63\n');
  });

  it('does not re-run GHC when nothing changed', async () => {
    const s = await start('A.hs');
    const files = { 'A.hs': 'module A where\nf = 1 :: Int\n' };
    const a = await s.load(files);
    const b = await s.load(files);
    expect(b).toBe(a);
  });

  it('feeds later input to a running program and can interrupt it', async () => {
    const s = await start();
    const out = collect(s);
    let done = idle(s);
    s.input('getLine >>= putStrLn . reverse');
    await new Promise((r) => setTimeout(r, 150));
    s.input('hello');
    await done;
    expect(out()).toContain('olleh');

    done = idle(s);
    s.input('let loop n = loop (n + 1 :: Int) in loop 0');
    await new Promise((r) => setTimeout(r, 200));
    s.interrupt();
    await done;
    expect(out()).toContain('Interrupted');
    done = idle(s);
    s.input('1 + 1');
    await done;
    expect(out().trimEnd().endsWith('2')).toBe(true);
  });
});

describe.skipIf(!haveQuickCheck)('runHaskellChecks (automatic differentiation)', () => {
  const ad = content.exercise('automatic-differentiation')!;
  const run = (source: string) =>
    runHaskellChecks({
      runghcBin: 'runghc',
      libDir: HASKELL_LIB,
      workDir: tmp(),
      code: ad.code!,
      files: { [ad.code!.studentPath]: source },
    });

  it('passes every check on the reference solution', async () => {
    const r = await run(ad.code!.solution!);
    expect(r.runnerError).toBeNull();
    expect(r.compiled).toBe(true);
    expect(r.results.length).toBeGreaterThan(30);
    expect(r.results.filter((x) => x.status !== 'pass')).toEqual([]);
  });

  it('reports the unfinished stub as "not implemented" rather than crashing', async () => {
    const r = await run(ad.code!.starter);
    expect(r.compiled).toBe(true);
    expect(r.results.length).toBeGreaterThan(30);
    // A few checks (e.g. d/dx x = 1) legitimately pass on an empty stub; nearly all must not.
    expect(r.results.filter((x) => x.status === 'error').length).toBeGreaterThan(25);
    expect(r.results.filter((x) => x.status === 'fail')).toEqual([]);
    expect(r.results.find((x) => x.status === 'error')!.message).toMatch(/not implemented yet/);
  });

  it('reports wrong answers with expected and actual', async () => {
    const wrong = ad.code!.solution!.replace('D (x1 * x2) (d1 * x2 + x1 * d2)', 'D (x1 * x2) (d1 * d2)');
    const r = await run(wrong);
    const product = r.results.find((x) => x.name.startsWith('product rule: d/dx x² at 3'))!;
    expect(product.status).toBe('fail');
    expect(product.message).toMatch(/expected 6\.0\s+but got/);
  });

  it('reports compile errors of the student code as diagnostics, not as failed checks', async () => {
    const r = await run(ad.code!.starter.replace('data D a = D a a', 'data D a = D a a a'));
    expect(r.compiled).toBe(false);
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(r.results).toEqual([]);
  });
});

describe.skipIf(!haveQuickCheck)('runHaskellChecks (misc)', () => {
  it('keeps student output separate and survives infinite loops', async () => {
    const be = content.exercise('binary-exponentiation')!;
    const looping = be.code!.starter.replace('power x n = undefined', 'power x n = trace\' `seq` power x n\n  where trace\' = ()');
    const t0 = Date.now();
    const r = await runHaskellChecks({
      runghcBin: 'runghc',
      libDir: HASKELL_LIB,
      workDir: tmp(),
      code: be.code!,
      files: { [be.code!.studentPath]: looping },
      timeoutMs: 12_000,
    });
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(r.results.some((x) => x.status === 'timeout') || r.runnerError !== null).toBe(true);
  });

  it('stops a run when asked to, long before the time limit', async () => {
    const be = content.exercise('binary-exponentiation')!;
    const looping = be.code!.starter.replace('power x n = undefined', 'power x n = power x n');
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 1_500);
    const t0 = Date.now();
    const r = await runHaskellChecks({
      runghcBin: 'runghc',
      libDir: HASKELL_LIB,
      workDir: tmp(),
      code: be.code!,
      files: { [be.code!.studentPath]: looping },
      timeoutMs: 60_000,
      signal: stop.signal,
    });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.stopped).toBe(true);
    expect(r.runnerError).toBeNull();
  });

  it('passes the gcd and binary exponentiation reference solutions', async () => {
    for (const id of ['binary-exponentiation', 'gcd-pf']) {
      const ex = content.exercise(id)!;
      const r = await runHaskellChecks({
        runghcBin: 'runghc',
        libDir: HASKELL_LIB,
        workDir: tmp(),
        code: ex.code!,
        files: { [ex.code!.studentPath]: ex.code!.solution! },
      });
      expect(r.runnerError, id).toBeNull();
      expect(r.results.filter((x) => x.status !== 'pass'), id).toEqual([]);
      expect(r.results.length, id).toBeGreaterThan(5);
    }
  });
});

describe.skipIf(!hasBinary('runghc'))('runHaskellChecks (a broken setup)', () => {
  const code = (check: string) => ({ language: 'haskell', runnable: true, options: [], studentPath: 'A.hs', starter: '', solution: null, check, support: {} });
  const brokenLib = (imported: string) => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-lib-'));
    fs.mkdirSync(path.join(lib, 'Workbook'));
    fs.writeFileSync(path.join(lib, 'Workbook', 'Check.hs'), `module Workbook.Check where\nimport ${imported}\n`);
    return lib;
  };
  const run = (libDir: string) =>
    runHaskellChecks({ runghcBin: 'runghc', libDir, workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-run-')), code: code('import Workbook.Check\nimport A\nmain = pure ()\n'), files: { 'A.hs': 'module A where\nx = 1\n' } });

  it('does not blame the student when QuickCheck is missing, and says what to do', async () => {
    const r = await run(brokenLib('Test.QuickCheck.NotInstalled'));
    expect(r.compiled).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.runnerError).toContain('cabal install --lib QuickCheck');
  });

  it('does not blame the student for any other problem in the library', async () => {
    const r = await run(brokenLib('Some.Other.Module'));
    expect(r.compiled).toBe(true);
    expect(r.runnerError).toContain('not a problem with your code');
    expect(r.runnerError).toContain('Some.Other.Module');
  });
});
