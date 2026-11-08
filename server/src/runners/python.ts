import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic } from '@wb/shared';
import { syncFiles } from './files.js';
import type { LoadResult } from './ghci.js';
import { PipeRepl } from './repl.js';

export interface PythonOptions {
  bin: string;
  /** Session directory: the student's files live here, and it is the interpreter's cwd. */
  dir: string;
  /** Directory containing `workbook_repl.py`. */
  libDir: string;
  /** The files the student edits; absent for scratch sessions. */
  targets?: string[];
  support?: Record<string, string>;
}

const DIAG = '@@WB-DIAG@@';

/** What `workbook_repl.py` prints when a file does not run: one line per problem, tab-separated. */
export function parsePythonDiagnostics(output: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const at = line.indexOf(DIAG);
    if (at < 0) continue;
    const [, file = '', lineNo = '1', column = '0', ...rest] = line.slice(at + DIAG.length).split('\t');
    const n = Math.max(1, Number(lineNo) || 1);
    const c = Number(column) || 0;
    out.push({
      severity: 'error',
      file,
      line: n,
      column: Math.max(1, c),
      endLine: n,
      endColumn: c > 0 ? c + 1 : 1000,
      code: null,
      message: rest.join('\t').replaceAll('\x01', '\n').trim(),
    });
  }
  return out;
}

/** One warm Python, running the student's file afresh on every edit. Its functions can then be called at the prompt. */
export class PythonSession extends PipeRepl {
  protected readonly sentinel = '@@WB-PROMPT@@';
  private last: LoadResult | null = null;

  constructor(private readonly opts: PythonOptions) {
    super();
    fs.mkdirSync(opts.dir, { recursive: true });
    if (opts.support) syncFiles(opts.dir, opts.support);
  }

  // The driver prints the marker itself.
  protected promptSetup(): string[] {
    return [];
  }

  protected spawnArgs() {
    const { bin, dir, libDir } = this.opts;
    return { bin, cwd: dir, args: ['-u', path.join(libDir, 'workbook_repl.py')] };
  }

  async load(files: Record<string, string>): Promise<LoadResult> {
    const changed = syncFiles(this.opts.dir, files);
    if (this.last && changed.length === 0) return this.last;
    const targets = this.opts.targets ?? [];
    if (targets.length === 0) return (this.last = { ok: true, diagnostics: [], durationMs: 0 });
    const t0 = Date.now();
    const diagnostics: Diagnostic[] = [];
    for (const target of targets) diagnostics.push(...parsePythonDiagnostics(await this.exec(`@@WB-LOAD@@ ${target}`)).map((d) => ({ ...d, file: target })));
    return (this.last = { ok: diagnostics.length === 0, diagnostics, durationMs: Date.now() - t0 });
  }
}
