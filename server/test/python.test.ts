import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PythonSession, parsePythonDiagnostics } from '../src/runners/python.js';
import { PROLOG_LIB, hasBinary } from './helpers.js';

const bin = process.env.PYTHON_BIN ?? 'python3';
const PYTHON_LIB = path.join(path.dirname(PROLOG_LIB), 'python');

describe('parsePythonDiagnostics', () => {
  it('reads positions and multi-line messages', () => {
    const out = parsePythonDiagnostics('hi\n@@WB-DIAG@@error\ta.py\t3\t5\tSyntaxError: x\x01more\n');
    expect(out).toEqual([{ severity: 'error', file: 'a.py', line: 3, column: 5, endLine: 3, endColumn: 6, code: null, message: 'SyntaxError: x\nmore' }]);
  });
});

describe.skipIf(!hasBinary(bin))('PythonSession', () => {
  const sessions: PythonSession[] = [];
  const dirs: string[] = [];
  const open = (target?: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-py-'));
    dirs.push(dir);
    const s = new PythonSession({ bin, dir, libDir: PYTHON_LIB, ...(target ? { targets: [target] } : {}) }).start();
    sessions.push(s);
    return s;
  };
  const ask = (s: PythonSession, line: string) =>
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

  it('runs the file afresh on every change and reports where it fails', async () => {
    const s = open('a.py');
    const bad = await s.load({ 'a.py': 'def f(:\n' });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]).toMatchObject({ severity: 'error', file: 'a.py', line: 1 });

    const good = await s.load({ 'a.py': 'def f(x):\n    return x + 1\n' });
    expect(good).toMatchObject({ ok: true, diagnostics: [] });
    expect(await ask(s, 'f(1)')).toBe('2\n');

    await s.load({ 'a.py': 'def g():\n    return 7\n' });
    expect(await ask(s, 'g()')).toBe('7\n');
    expect(await ask(s, 'f(1)')).toContain('NameError'); // the old definitions are gone
  });

  it('survives errors and prints what the code prints', async () => {
    const s = open();
    await s.ready;
    expect(await ask(s, '1/0')).toContain('ZeroDivisionError');
    expect(await ask(s, 'print("hallo")')).toBe('hallo\n');
  });
});
