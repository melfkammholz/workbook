import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic } from '@wb/shared';
import { syncFiles } from './files.js';
import type { LoadResult } from './ghci.js';
import { PipeRepl } from './repl.js';

export interface PrologOptions {
  bin: string;
  /** Session directory: student files live here and it is the interpreter's cwd. */
  dir: string;
  /** Directory containing `workbook_repl.pl`. */
  libDir: string;
  /** The files the student edits; absent for scratch sessions. */
  targets?: string[];
  /** Read-only files to place next to the student's file. */
  support?: Record<string, string>;
}

const DIAG = '@@WB-DIAG@@';

/**
 * Parses what `workbook_load.pl` prints. Messages mention the absolute path of
 * the session directory, which means nothing to a student, so it is removed.
 */
export function parsePrologDiagnostics(output: string, dir: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const at = line.indexOf(DIAG);
    if (at < 0) continue;
    const [severity, file = '', lineNo = '1', column = '0', ...rest] = line.slice(at + DIAG.length).split('\t');
    const n = Math.max(1, Number(lineNo) || 1);
    const c = Number(column) || 0;
    const message = rest
      .join('\t')
      .replaceAll('\x01', '\n')
      .replaceAll(`${dir}${path.sep}`, '')
      .replace(/^[^\s:]+\.pl:\d+(?::\d+)?:\s*/, '')
      .trim();
    out.push({
      severity: severity === 'error' ? 'error' : 'warning',
      file: file ? path.relative(dir, file) : '',
      line: n,
      column: Math.max(1, c),
      endLine: n,
      // Without a column the whole line is meant.
      endColumn: c > 0 ? c + 1 : 1000,
      code: null,
      message,
    });
  }
  return out;
}

/** One warm SWI-Prolog, reloading the student's file on every edit. */
export class PrologSession extends PipeRepl {
  protected readonly sentinel = '@@WB-PROMPT@@';
  private last: LoadResult | null = null;

  constructor(private readonly opts: PrologOptions) {
    super();
    fs.mkdirSync(opts.dir, { recursive: true });
    if (opts.support) syncFiles(opts.dir, opts.support);
  }

  // The driver prints the sentinel itself: nothing to configure.
  protected promptSetup(): string[] {
    return [];
  }

  protected spawnArgs() {
    const { bin, dir, libDir } = this.opts;
    return { bin, cwd: dir, args: ['-q', '-f', 'none', '-g', 'workbook_repl:main', '-t', 'halt', path.join(libDir, 'workbook_repl.pl')] };
  }

  async load(files: Record<string, string>): Promise<LoadResult> {
    const changed = syncFiles(this.opts.dir, files);
    if (this.last && changed.length === 0) return this.last;

    const targets = this.opts.targets ?? [];
    if (targets.length === 0) return (this.last = { ok: true, diagnostics: [], durationMs: 0 });

    const t0 = Date.now();
    const diagnostics: Diagnostic[] = [];
    for (const target of targets) {
      const output = await this.exec(`@@WB-LOAD@@ ${target}`);
      diagnostics.push(...parsePrologDiagnostics(output, fs.realpathSync(this.opts.dir)).map((d) => ({ ...d, file: d.file || target })));
    }
    return (this.last = { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics, durationMs: Date.now() - t0 });
  }
}
