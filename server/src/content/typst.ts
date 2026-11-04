import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RenderedItem, TypstDiagnostic } from '@wb/shared';
import type { ServerItem } from './loader.js';
import { bodyOf, splitDocument } from './html.js';

export interface TypstOptions {
  bin: string;
  contentDir: string;
  dataDir: string;
  /** Directory holding `prelude.typ` (shipped with the app). */
  assetsDir: string;
  /** Content language, e.g. "de". */
  language: string;
  concurrency?: number;
}

export interface RenderedNote {
  html: string;
  css: string;
  diagnostics: TypstDiagnostic[];
}

// With `--diagnostic-format short`: path:line:col: error: message
const SHORT = /^(?<file>.+?):(?<line>\d+):(?<col>\d+): (?<sev>error|warning): (?<msg>.*)$/;

/**
 * Compiles Typst to HTML with the Typst CLI.
 *
 * Layout of the compile root (so authors' `#import` paths stay short and
 * nothing outside it is reachable):
 *
 *     <dataDir>/typst-root/
 *       _workbook/prelude.typ   shipped helpers (remark, hint, xref, …)
 *       content  →  <contentDir>
 *       _tmp/                   generated wrapper files, deleted after use
 *
 * Items are compiled inline after a generated header (not via `#include`,
 * which would not inherit the prelude's names), and diagnostics are mapped
 * back to lines in the author's file.
 */
export class TypstRenderer {
  private readonly root: string;
  private readonly cacheDir: string;
  private queue = 0;
  private waiters: (() => void)[] = [];
  private versionPromise: Promise<string> | null = null;
  private readonly max: number;
  /** Id → title, kept current by the owner when content reloads. */
  titles: (id: string) => string | undefined = () => undefined;
  /** Content language; follows `workbook.yml` and is updated when content reloads. */
  language: string;

  constructor(private readonly o: TypstOptions) {
    this.max = o.concurrency ?? 4;
    this.language = o.language;
    this.root = path.join(o.dataDir, 'typst-root');
    this.cacheDir = path.join(o.dataDir, 'cache', 'render');
    fs.mkdirSync(path.join(this.root, '_workbook'), { recursive: true });
    fs.mkdirSync(path.join(this.root, '_tmp'), { recursive: true });
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.copyFileSync(path.join(o.assetsDir, 'prelude.typ'), path.join(this.root, '_workbook', 'prelude.typ'));
    const link = path.join(this.root, 'content');
    try {
      fs.rmSync(link, { force: true });
    } catch {
      /* ignore */
    }
    fs.symlinkSync(o.contentDir, link, 'dir');
  }

  version(): Promise<string> {
    this.versionPromise ??= new Promise((resolve) => {
      execFile(this.o.bin, ['--version'], (err, stdout) => resolve(err ? 'unavailable' : stdout.trim()));
    });
    return this.versionPromise;
  }

  async available(): Promise<boolean> {
    return (await this.version()) !== 'unavailable';
  }

  private header(chapterRel?: string, codeLanguage?: string | null): string[] {
    const lines = ['#import "/_workbook/prelude.typ": *'];
    if (fs.existsSync(path.join(this.o.contentDir, 'prelude.typ'))) lines.push('#import "/content/prelude.typ": *');
    lines.push('#show: workbook', `#set text(lang: "${this.language}")`);
    // Code that names no language is in the language of what it is part of. A language written on the code wins.
    if (codeLanguage) lines.push(`#set raw(lang: "${codeLanguage}")`);
    if (chapterRel) {
      // Images and data files are written relative to the exercise.
      lines.push(`#let image(path, ..args) = std.image("/content/${chapterRel}/" + path, ..args)`);
    }
    return lines;
  }

  async renderItem(item: Pick<ServerItem, 'typst' | 'chapterRel' | 'codeLanguage'>): Promise<RenderedItem> {
    const header = this.header(item.chapterRel, item.codeLanguage).join('\n') + '\n';
    const key = await this.cacheKey(header + item.typst);
    const cached = this.readCache(key);
    // Titles are filled in after the cache, so renaming an exercise updates links to it.
    if (cached) return this.fillTitles(cached);

    const run = await this.compile(header + item.typst, header.split('\n').length - 1);
    if (run.html === null) {
      return { task: '', remarks: [], hints: [], samples: [], questions: [], css: '', diagnostics: run.diagnostics.map((d) => ({ ...d })) };
    }
    const parts = splitDocument(run.html);
    const rendered: RenderedItem = { ...parts, diagnostics: run.diagnostics };
    this.writeCache(key, rendered);
    return this.fillTitles(rendered);
  }

  /** Renders a student's note. Never cached: it is previewed while typing. */
  async renderNote(source: string): Promise<RenderedNote> {
    const header = this.header().join('\n') + '\n';
    const run = await this.compile(header + source, header.split('\n').length - 1);
    if (run.html === null) return { html: '', css: '', diagnostics: run.diagnostics };
    const body = bodyOf(run.html);
    return { ...body, html: this.fillXrefs(body.html), diagnostics: run.diagnostics };
  }

  // ───────────── internals ─────────────

  /** Fills in the (current) title of every `xref` that has no body of its own. */
  private fillXrefs(html: string): string {
    return html.replace(/<a ([^>]*\bclass="wb-xref"[^>]*)><\/a>/g, (_m, attrs: string) => {
      const id = /\bdata-xref="([^"]*)"/.exec(attrs)?.[1] ?? '';
      const title = this.titles(id);
      const a = title === undefined ? attrs.replace('class="wb-xref"', 'class="wb-xref wb-xref-broken"') : attrs;
      return `<a ${a}>${escape(title ?? id)}</a>`;
    });
  }

  private fillTitles(r: RenderedItem): RenderedItem {
    const fill = (h: string) => this.fillXrefs(h);
    return { ...r, task: fill(r.task), remarks: r.remarks.map(fill), hints: r.hints.map(fill), samples: r.samples.map(fill), questions: r.questions.map((q) => ({ ...q, html: fill(q.html) })) };
  }

  private async cacheKey(source: string): Promise<string> {
    const prelude = fs.readFileSync(path.join(this.root, '_workbook', 'prelude.typ'), 'utf8');
    const authorPrelude = path.join(this.o.contentDir, 'prelude.typ');
    const author = fs.existsSync(authorPrelude) ? fs.readFileSync(authorPrelude, 'utf8') : '';
    return crypto
      .createHash('sha1')
      .update(await this.version())
      .update('\0')
      .update(prelude)
      .update('\0')
      .update(author)
      .update('\0')
      .update(source)
      .digest('hex');
  }

  private readCache(key: string): RenderedItem | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.cacheDir, key + '.json'), 'utf8')) as RenderedItem;
    } catch {
      return null;
    }
  }

  private writeCache(key: string, r: RenderedItem): void {
    // Compile errors are not cached: fixing a package or the prelude should show up immediately.
    if (r.diagnostics.some((d) => d.severity === 'error')) return;
    fs.writeFileSync(path.join(this.cacheDir, key + '.json'), JSON.stringify(r));
  }

  private async acquire(): Promise<void> {
    if (this.queue < this.max) {
      this.queue++;
      return;
    }
    await new Promise<void>((res) => this.waiters.push(res));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.queue--;
  }

  private async compile(source: string, headerLines: number): Promise<{ html: string | null; diagnostics: TypstDiagnostic[] }> {
    await this.acquire();
    const id = crypto.randomBytes(6).toString('hex');
    const input = path.join(this.root, '_tmp', `${id}.typ`);
    const output = path.join(this.root, '_tmp', `${id}.html`);
    try {
      fs.writeFileSync(input, source);
      const { stderr, code, error } = await new Promise<{ stderr: string; code: number | null; error: string | null }>((resolve) => {
        const proc = spawn(
          this.o.bin,
          ['compile', '--root', this.root, '--features', 'html', '--format', 'html', '--diagnostic-format', 'short', input, output],
          {
            stdio: ['ignore', 'ignore', 'pipe'],
            env: {
              ...process.env,
              TYPST_PACKAGE_CACHE_PATH: process.env.TYPST_PACKAGE_CACHE_PATH ?? path.join(this.o.dataDir, 'typst-packages'),
            },
          },
        );
        let stderr = '';
        proc.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
        const timer = setTimeout(() => proc.kill('SIGKILL'), 60_000);
        proc.on('error', (e) => resolve({ stderr, code: null, error: e.message }));
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ stderr, code, error: null });
        });
      });

      const diagnostics = parseDiagnostics(stderr, headerLines, path.basename(input));
      if (error) diagnostics.push({ severity: 'error', line: null, column: null, message: `Could not run typst: ${error}` });
      if (code !== 0 && !diagnostics.some((d) => d.severity === 'error'))
        diagnostics.push({ severity: 'error', line: null, column: null, message: stderr.trim() || `typst exited with code ${code}` });
      const html = code === 0 && fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
      return { html, diagnostics };
    } finally {
      fs.rmSync(input, { force: true });
      fs.rmSync(output, { force: true });
      this.release();
    }
  }
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseDiagnostics(stderr: string, headerLines: number, wrapperName: string): TypstDiagnostic[] {
  const out: TypstDiagnostic[] = [];
  for (const line of stderr.split('\n')) {
    const m = SHORT.exec(line);
    if (!m?.groups) continue;
    const g = m.groups as Record<string, string>;
    // Only diagnostics inside the wrapper map to the author's text; others (prelude, packages) keep their file name.
    const inWrapper = g.file!.endsWith(wrapperName);
    const ln = Number(g.line);
    out.push({
      severity: g.sev as 'error' | 'warning',
      line: inWrapper ? Math.max(1, ln - headerLines) : null,
      column: inWrapper ? Number(g.col) : null,
      message: inWrapper ? g.msg! : `${path.basename(g.file!)}:${ln}: ${g.msg}`,
    });
  }
  return out;
}
