import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_CONTENT = path.resolve(here, 'fixtures/course');
export const HASKELL_LIB = path.resolve(here, '../assets/haskell');
export const PROLOG_LIB = path.resolve(here, '../assets/prolog');

export function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
