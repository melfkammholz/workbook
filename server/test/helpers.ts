import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_CONTENT = path.resolve(here, 'fixtures/course');
export const HASKELL_LIB = path.resolve(here, '../assets/haskell');
export const PROLOG_LIB = path.resolve(here, '../assets/prolog');

/** sldcheck 0.2 or newer, which is the first with `--version` (and `--syntax`, and syntax errors as diagnostics). */
export function hasSldcheck(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}

/** The version `sldcheck --version` prints, as numbers; null if it cannot say. */
export function sldcheckVersion(bin: string): number[] | null {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  const m = r.status === 0 ? /(\d+(?:\.\d+)*)/.exec(r.stdout) : null;
  return m ? m[1]!.split('.').map(Number) : null;
}

/** sldcheck 0.3 or newer: the first that prints the tree as JSON (`--tree`). */
export function hasSldcheckTree(bin: string): boolean {
  const v = sldcheckVersion(bin);
  return v !== null && (v[0]! > 0 || v[1]! >= 3);
}

/**
 * Whether `--tree` says which clause a step used (0.4+). Found out by trying, not from `--version`: the tag v0.4.0.0
 * still reports 0.3.0.0.
 */
export function hasSldcheckClauses(bin: string): boolean {
  if (!hasSldcheckTree(bin)) return false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sld-probe-'));
  try {
    fs.writeFileSync(path.join(dir, 'p.pl'), 'p(1).\n');
    fs.writeFileSync(path.join(dir, 't.sld'), '?- p(X).\n  | p(1).\n  | {X |-> 1}\n  ?- true.\n');
    const out = execFileSync(bin, ['--tree', './t.sld', './p.pl'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /"clause":1\b/.test(out);
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
