import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SLD_TREE_TEST } from '@wb/shared';
import { loadContent, type ServerCode } from '../src/content/loader.js';
import { runChecks } from '../src/runners/checks.js';
import { SldSession, isBlank, parseFindings } from '../src/runners/sldcheck.js';
import { EXAMPLE_CONTENT, hasSldcheck } from './helpers.js';

const bin = process.env.SLDCHECK_BIN ?? 'sldcheck';
const haveSldcheck = hasSldcheck(bin);

describe('reading what sldcheck prints', () => {
  it('reads the diagnostics and refuses anything else', () => {
    const json = '{"version":"0.2.0.0","diagnostics":[{"severity":"error","code":"E022","line":4,"column":3,"message":"a \\"b\\"\\nc"},\n {"severity":"info","code":"I001","line":1,"column":1,"message":"x"}]}\n';
    expect(parseFindings(json)).toEqual([
      { severity: 'error', code: 'E022', line: 4, column: 3, message: 'a "b"\nc' },
      { severity: 'info', code: 'I001', line: 1, column: 1, message: 'x' },
    ]);
    expect(parseFindings('{"diagnostics":[]}')).toEqual([]);
    // With the file and where the problem ends.
    const object = '{"version":"0.2.0.0","diagnostics":[{"severity":"error","code":"S001","file":"a.sld","line":3,"column":5,"endLine":3,"endColumn":6,"message":"Syntax error: x"}]}';
    expect(parseFindings(object)).toEqual([{ severity: 'error', code: 'S001', line: 3, column: 5, endLine: 3, endColumn: 6, message: 'Syntax error: x' }]);
    expect(parseFindings('{"version":"0.2.0.0"}')).toBeNull();
    expect(parseFindings('not json')).toBeNull();
    expect(parseFindings('[]')).toBeNull();
    expect(parseFindings('{"diagnostics":[{"severity":"error"}]}')).toBeNull();
  });

  it('does not count comments as a tree', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank('% The tree.\n\n  /* later */\n')).toBe(true);
    expect(isBlank('% The tree.\n?- p.\n')).toBe(false);
  });
});

describe('an sld exercise', () => {
  const ex = loadContent(EXAMPLE_CONTENT).exercise('sld-member')!;

  it('has tests, a read-only program and a starter with only the query', () => {
    expect(ex.meta.code).toMatchObject({ language: 'sld', runnable: true, hasCheck: true, hasSolution: true });
    expect(ex.code!.program).toBe('member.pl');
    expect(ex.code!.support['member.pl']).toContain('member(X, [X|_]).');
    expect(ex.code!.studentPath).toBe('member.sld');
    expect(ex.code!.starter).toContain('?- member(X, [1, 2]), Y is X + 1.');
    expect(ex.code!.starter).not.toContain('|');
    expect(ex.code!.solution).toContain('| no rule');
  });
});

describe.skipIf(!haveSldcheck)('checking a tree', () => {
  const code: ServerCode = loadContent(EXAMPLE_CONTENT).exercise('sld-member')!.code!;
  const dirs: string[] = [];
  const run = (tree: string, c: ServerCode = code) => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sld-'));
    dirs.push(workDir);
    return runChecks({ runghcBin: 'runghc', swiplBin: 'swipl', sldcheckBin: bin, haskellLib: '', prologLib: '', workDir, code: c, files: { [c.studentPath]: tree } });
  };
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it('passes the reference solution', async () => {
    const r = await run(code.solution!);
    expect(r).toMatchObject({ compiled: true, runnerError: null, results: [{ name: SLD_TREE_TEST, status: 'pass', message: '' }] });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('says what is missing from a tree that has only the query, as markers in the file', async () => {
    const r = await run(code.starter);
    expect(r.compiled).toBe(true);
    expect(r.results).toEqual([{ name: SLD_TREE_TEST, status: 'fail', message: expect.stringContaining('[E022]') }]);
    const e022 = r.diagnostics.find((d) => d.code === 'E022')!;
    expect(e022).toMatchObject({ severity: 'error', file: 'member.sld', line: 2, column: 1, endLine: 2 });
    // Up to the end of the line, which is where the problem is.
    expect(e022.endColumn).toBe('?- member(X, [1, 2]), Y is X + 1.'.length + 1);
  });

  it('is all or nothing: one wrong step fails the test, and nothing else is reported for it', async () => {
    const r = await run(code.solution!.replace('{X2 |-> X, _2 |-> 1, T2 |-> [2]}', '{X2 |-> X, _2 |-> 2, T2 |-> [2]}'));
    expect(r.results[0]!.status).toBe('fail');
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => d.code)).toEqual(['E015']);
    // At the step: the line of its rule.
    expect(errors[0]!.line).toBe(9);
  });

  it('keeps warnings out of the verdict', async () => {
    // Without its answer a proven node is fine, with a warning.
    const r = await run(code.solution!.replace('?- true.                                 {X |-> 1, Y |-> 2}', '?- true.'));
    expect(r.results[0]!.status).toBe('pass');
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'W004' })]);
  });

  it('reports a syntax error where it is, without a test result', async () => {
    // A step that is not aligned with the others: reported alike by every version of sldcheck.
    const r = await run('?- member(X, [1, 2]).\n  | member(X1, [X1|_1]).\n   | {X |-> 1}\n');
    expect(r.compiled).toBe(false);
    expect(r.results).toEqual([]);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', file: 'member.sld', line: 3, column: 4, code: null });
    expect(r.diagnostics[0]!.message).toMatch(/^Syntax error: /);
    expect(r.diagnostics[0]!.message).toContain('not aligned with the other steps');
  });

  it('puts a syntax error where the problem is, from the first character of what is wrong to its end', async () => {
    const brace = await run('?- member(X, [1, 2]), Y is X + 1.\n  | member(X1, [X1|_1]).\n  | {X |-> 1, X1 |-> 1, _1 |-> [2]\n  ?- true.\n');
    expect(brace.compiled).toBe(false);
    // At the brace that is never closed, with the message of sldcheck as it is.
    expect(brace.diagnostics).toEqual([expect.objectContaining({ severity: 'error', file: 'member.sld', line: 3, column: 5, endLine: 3, endColumn: 6, message: expect.stringMatching(/^Syntax error: this brace is never closed/) })]);
    const dot = await run('?- member(X, [1, 2]), Y is X + 1\n  | member(X1, [X1|_1]).\n');
    // Right after the goal, on the line where the dot belongs.
    expect(dot.diagnostics[0]).toMatchObject({ line: 1, column: 33, message: expect.stringContaining('end dot') });
  });

  it('says so when there is nothing yet', async () => {
    const r = await run('% Only a comment.\n');
    expect(r).toMatchObject({ compiled: true, results: [{ status: 'fail', message: expect.stringContaining('empty') }] });
  });

  it('blames the exercise, not the student, for a broken program', async () => {
    const broken = { ...code, support: { 'member.pl': 'member(X, [X|_]\n' } };
    const r = await run(code.solution!, broken);
    expect(r.results).toEqual([]);
    expect(r.runnerError).toMatch(/problem with the exercise/);
  });

  it('reports a missing sldcheck as a problem of the setup', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sld-'));
    dirs.push(workDir);
    const r = await runChecks({ runghcBin: 'runghc', swiplBin: 'swipl', sldcheckBin: '/nonexistent/sldcheck', haskellLib: '', prologLib: '', workDir, code, files: { [code.studentPath]: code.solution! } });
    expect(r.runnerError).toMatch(/Could not start/);
  });
});

describe.skipIf(!haveSldcheck)('SldSession', () => {
  const code: ServerCode = loadContent(EXAMPLE_CONTENT).exercise('sld-member')!.code!;
  const dirs: string[] = [];
  const open = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sld-session-'));
    dirs.push(dir);
    return new SldSession({ bin, dir, code }).start();
  };
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it('shows syntax errors while writing, and only those', async () => {
    const s = open();
    await s.ready;
    // Half a tree is full of semantic errors, which the tests are for.
    expect(await s.load({ 'member.sld': code.starter })).toMatchObject({ ok: true, diagnostics: [] });
    const crooked = code.solution!.replace('  | {X2 |-> X,', '   | {X2 |-> X,');
    expect(await s.load({ 'member.sld': crooked })).toMatchObject({ ok: false, diagnostics: [{ severity: 'error', file: 'member.sld', line: 10, column: 4 }] });
    expect(await s.load({ 'member.sld': code.solution! })).toMatchObject({ ok: true, diagnostics: [] });
  });

  it('locates a syntax error where the problem is, when only the syntax is read', async () => {
    const s = open();
    expect(await s.load({ 'member.sld': '?- member(X, [1, 2])\n' })).toMatchObject({ ok: false, diagnostics: [{ line: 1, column: 21, message: expect.stringContaining('end dot') }] });
  });

  it('is not bothered by an empty file', async () => {
    const s = open();
    expect(await s.load({ 'member.sld': '' })).toMatchObject({ ok: true, diagnostics: [] });
  });

  it('does not check anything once it is closed', async () => {
    const s = open();
    s.kill();
    // A tree with a syntax error, which would be reported by a session that is still open.
    expect(await s.load({ 'member.sld': '?- member(X, [1, 2])\n  | x.\n' })).toMatchObject({ ok: true, diagnostics: [] });
  });
});
