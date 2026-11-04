import fs from 'node:fs';
import path from 'node:path';

let lastTick = 0;

/**
 * Write files into a session directory, touching only those whose content
 * changed. Modification times are strictly increasing so GHCi always notices
 * an edit, even two within the same filesystem timestamp tick.
 * Returns the paths that were written.
 */
export function syncFiles(dir: string, files: Record<string, string>): string[] {
  const changed: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = safeJoin(dir, rel);
    let current: string | null = null;
    try {
      current = fs.readFileSync(abs, 'utf8');
    } catch {
      /* new file */
    }
    if (current === content) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    lastTick = Math.max(Date.now() / 1000, lastTick + 0.01);
    fs.utimesSync(abs, lastTick, lastTick);
    changed.push(rel);
  }
  return changed;
}

/** Join, refusing paths that escape `dir`. */
export function safeJoin(dir: string, rel: string): string {
  const abs = path.resolve(dir, rel);
  if (abs !== dir && !abs.startsWith(dir + path.sep)) throw new Error(`path escapes session directory: ${rel}`);
  return abs;
}
