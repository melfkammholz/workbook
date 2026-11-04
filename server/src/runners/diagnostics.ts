import type { Diagnostic } from '@wb/shared';

// file:line:col[-endcol]: error|warning: [CODE] [-Wflag]
const SIMPLE = /^(?<file>[^\s:][^:]*?):(?<l>\d+):(?<c>\d+)(?:-(?<ec>\d+))?: (?<sev>error|warning):(?<tags>(?: \[[^\]]+\])*)\s*(?<rest>.*)$/;
// file:(l1,c1)-(l2,c2): error|warning: …
const MULTI = /^(?<file>[^\s:][^:]*?):\((?<l>\d+),(?<c>\d+)\)-\((?<el>\d+),(?<ec>\d+)\): (?<sev>error|warning):(?<tags>(?: \[[^\]]+\])*)\s*(?<rest>.*)$/;

const isSnippet = (line: string) => /^\s*\d*\s*\|(\s|$)/.test(line);

/**
 * Parses GHC/GHCi diagnostics (`-ferror-spans` format) out of arbitrary output.
 *
 * Works for GHC 9.4 (no error codes) as well as newer versions
 * (`error: [GHC-83865]`). Diagnostics in `<interactive>` are skipped: they
 * belong to what the student typed in the REPL, not to a file in the editor.
 */
export function parseGhcDiagnostics(output: string): Diagnostic[] {
  const lines = output.split(/\r?\n/);
  const out: Diagnostic[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = MULTI.exec(line) ?? SIMPLE.exec(line);
    if (!m?.groups) {
      i++;
      continue;
    }
    const g = m.groups as Record<string, string | undefined>;
    const multi = g.el !== undefined;
    const startLine = Number(g.l);
    const startCol = Number(g.c);
    const endLine = multi ? Number(g.el) : startLine;
    // GHC's end column is exclusive for multi-line spans and inclusive for single-line ones.
    const endCol = multi ? Number(g.ec) : g.ec ? Number(g.ec) + 1 : startCol + 1;

    const body: string[] = [];
    if (g.rest) body.push(g.rest);
    i++;
    while (i < lines.length) {
      const next = lines[i]!;
      if (next.trim() === '') {
        // A blank line only ends the message if what follows is not indented.
        const following = lines[i + 1];
        if (following === undefined || !/^\s/.test(following)) break;
        i++;
        continue;
      }
      if (!/^\s/.test(next)) break;
      if (!isSnippet(next)) body.push(next);
      i++;
    }

    const tags = [...(g.tags ?? '').matchAll(/\[([^\]]+)\]/g)].map((t) => t[1]!);
    const code = tags.find((t) => /^GHC-\d+$/.test(t)) ?? tags.find((t) => t.startsWith('-W')) ?? null;
    if (g.file === '<interactive>') continue;
    out.push({
      severity: g.sev as 'error' | 'warning',
      file: g.file!,
      line: startLine,
      column: startCol,
      endLine,
      endColumn: endCol,
      code,
      message: dedent(body).join('\n').trim(),
    });
  }
  return out;
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min));
}

/** True when GHCi reports that all requested modules loaded. */
export function loadSucceeded(output: string): boolean {
  // GHC 9.10 and newer say "reloaded" after `:reload`, and small numbers are spelled out.
  return /^Ok, \S+ modules? (?:re)?loaded\.?$/m.test(output);
}
