import { execFileSync, spawnSync } from 'node:child_process';
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

export function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
