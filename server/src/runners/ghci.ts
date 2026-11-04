import fs from 'node:fs';
import type { Diagnostic, TypeInfo } from '@wb/shared';
import { loadSucceeded, parseGhcDiagnostics } from './diagnostics.js';
import { syncFiles } from './files.js';
import { PipeRepl } from './repl.js';

export interface GhciOptions {
  bin: string;
  /** Session directory: student files live here and it is the interpreter's cwd. */
  dir: string;
  /** Directory containing `Workbook/Check.hs`, made importable. */
  libDir: string;
  /** Extra flags such as `-XLambdaCase`. */
  options: string[];
  /** The modules the student edits; absent for scratch sessions. */
  targets?: string[];
  /** Read-only modules to place next to the student's file. */
  support?: Record<string, string>;
}

export interface LoadResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  durationMs: number;
}

/** Only names go to `:doc`: it is the one place where text from the editor reaches the interpreter. */
const NAME = /^(?:[\p{L}_][\p{L}\p{N}_']*(?:\.[\p{L}_][\p{L}\p{N}_']*)*|[!#$%&*+./<=>?@\\^|~:-]+)$/u;
const inParens = (name: string) => (/^[\p{L}_]/u.test(name) ? name : `(${name})`);
const DOC_LENGTH = 360;

/** The opening paragraph of what `:doc` prints, without Haddock's markup. */
export function firstParagraph(output: string): string | null {
  const lines: string[] = [];
  for (const raw of output.split('\n')) {
    if (!raw.startsWith('--')) {
      if (lines.length) break;
      continue;
    }
    const line = raw.replace(/^--\s?/, '').replace(/^\|\s?/, '').trim();
    if (!line) {
      if (lines.length) break;
      continue;
    }
    lines.push(line);
  }
  const text = lines
    .join(' ')
    .replace(/\\\(|\\\)/g, '')
    .replace(/\\mathcal\{(\w+)\}/g, '$1')
    .replace(/@([^@]*)@/g, '$1')
    .replace(/(^|[\s(\[])'([^'\s]+)'/g, '$1$2')
    .replace(/"([A-Z][\w.]*)"/g, '$1')
    .trim();
  if (!text) return null;
  // Often it leads into an example that is not shown here.
  if (/(?:,|:|\bi\.e\.,?|\be\.g\.,?)$/.test(text)) return `${text.replace(/[\s,:]*(?:i\.e\.,?|e\.g\.,?)?[\s,:]*$/, '')}…`;
  return text.length > DOC_LENGTH ? `${text.slice(0, DOC_LENGTH).replace(/\s+\S*$/, '')}…` : text;
}

/** One warm ghci process, reloading the student's module on every edit. */
export class GhciSession extends PipeRepl {
  protected readonly sentinel = '@@WB-PROMPT@@';
  private loadedOnce = false;
  private last: LoadResult | null = null;

  constructor(private readonly opts: GhciOptions) {
    super();
    fs.mkdirSync(opts.dir, { recursive: true });
    if (opts.support) syncFiles(opts.dir, opts.support);
  }

  protected promptSetup(): string[] {
    // prompt-cont first: its (default) prompt is printed before ours takes effect.
    // `+c` keeps the type information that `:type-at` answers from.
    return [':set +c', ':set prompt-cont ""', `:set prompt "${this.sentinel}"`];
  }

  protected spawnArgs() {
    const { bin, dir, libDir, options } = this.opts;
    return {
      bin,
      cwd: dir,
      args: [
        '-ignore-dot-ghci',
        '-ferror-spans',
        '-fdiagnostics-color=never',
        '-Wincomplete-patterns',
        // Beginners meet `head` and `tail` early, and this warning would be all they see.
        '-Wno-x-partial',
        '-i.',
        `-i${libDir}`,
        ...options,
      ],
    };
  }

  /** What is known about a name in the code as it was last loaded, or null if it is not a term. */
  async typeAt(file: string, line: number, column: number, endLine: number, endColumn: number, name: string): Promise<TypeInfo | null> {
    if (!this.last?.ok) return null;
    const span = `${file} ${line} ${column} ${endLine} ${endColumn}`;
    const output = (await this.exec(`:type-at ${span}`)).trim();
    const type = /^(?:\S* )?:: ([\s\S]+)$/.exec(output)?.[1];
    if (!type) return null;
    // Asks where this very use is defined: a parameter called `map` is not the library's `map`.
    const location = (await this.exec(`:loc-at ${span}`)).trim();
    // Not found there can also mean another of the student's own files, so `:info` has the last word.
    const library =
      NAME.test(name) && !/^[^\s:]+\.l?hs:/.test(location) && /Defined in ‘/.test(await this.exec(`:info ${inParens(name)}`));
    return { type: type.replace(/\s+/g, ' '), library, doc: library ? firstParagraph(await this.exec(`:doc ${inParens(name)}`)) : null };
  }

  /** Write the student's files and (re)load them. Resolves with diagnostics. */
  async load(files: Record<string, string>): Promise<LoadResult> {
    const changed = syncFiles(this.opts.dir, files);
    if (this.last && changed.length === 0) return this.last;

    const targets = this.opts.targets ?? [];
    const target = targets[0];
    if (!target) return (this.last = { ok: true, diagnostics: [], durationMs: 0 });

    const t0 = Date.now();
    const output = await this.exec(this.loadedOnce ? ':reload' : `:load ${targets.join(' ')}`);
    this.loadedOnce = true;

    const diagnostics = parseGhcDiagnostics(output);
    const ok = loadSucceeded(output) && !diagnostics.some((d) => d.severity === 'error');
    if (!ok && !diagnostics.some((d) => d.severity === 'error')) {
      // Something GHC reported without a source span (missing module, bad flag, …).
      const raw = output.replace(/^\[\d+ of \d+\] Compiling.*$/gm, '').trim();
      diagnostics.push({
        severity: 'error',
        file: target,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 2,
        code: null,
        message: raw || 'The module could not be loaded.',
      });
    }
    // After loading several modules, only the last would be in scope at the prompt.
    if (ok && targets.length > 1) await this.exec(`:module ${targets.map((t) => `*${t.replace(/\.l?hs$/, '').split('/').join('.')}`).join(' ')}`);
    return (this.last = { ok, diagnostics, durationMs: Date.now() - t0 });
  }
}
