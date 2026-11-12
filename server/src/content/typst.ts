import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { scanCards, type RenderedItem, type TypstDiagnostic } from '@wb/shared';
import { dedent } from '../flashcards/source.js';
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
  /** Shown as a picture, because HTML export lost part of it. */
  asPicture?: boolean;
}

/** Bump when the processing of Typst's output changes, so cached renders are made again. */
const RENDER_VERSION = '4';

/** Typst's warning when HTML export drops something, e.g. what a package lays out. */
const LOST_IN_HTML = /was ignored during HTML export/;
const lostSomething = (d: TypstDiagnostic[]) => d.some((x) => x.severity === 'warning' && LOST_IN_HTML.test(x.message)) && !d.some((x) => x.severity === 'error');

/**
 * Warming the render cache after a course is loaded: one compile at a time for all courses, only while no student is
 * waiting for a render. A real compile ends the one being warmed (it is tried again later), so it never waits for it.
 */
type Renderable = Pick<ServerItem, 'typst' | 'chapterRel' | 'codeLanguage'> & { meta?: { type: string } };
/** How long renders must have been quiet before warming goes on: a student clicking around comes first. */
const WARM_QUIET_MS = 500;
const lane = {
  jobs: [] as { renderer: TypstRenderer; text: Renderable }[],
  /** Real compiles running now, in any course. */
  busy: 0,
  quietSince: Date.now(),
  /** Ends the compile being warmed. */
  cancel: null as (() => void) | null,
  running: false,
};

async function pumpWarming(): Promise<void> {
  if (lane.running) return;
  lane.running = true;
  try {
    while (lane.jobs.length > 0) {
      const wait = lane.busy > 0 ? WARM_QUIET_MS : lane.quietSince + WARM_QUIET_MS - Date.now();
      if (wait > 0) {
        await new Promise((res) => setTimeout(res, wait).unref());
        continue;
      }
      const job = lane.jobs.shift()!;
      let done = true;
      try {
        done = await job.renderer.warmOne(job.text);
      } catch {
        /* a text that cannot be rendered is rendered when it is asked for */
      }
      // Ended by a real compile: tried again once things are quiet, unless the course has gone or was loaded again.
      if (!done && lane.jobs.every((j) => j.renderer !== job.renderer || j.text !== job.text)) lane.jobs.unshift(job);
    }
  } finally {
    lane.running = false;
  }
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
    for (const f of fs.readdirSync(o.assetsDir)) if (f.endsWith('.typ')) fs.copyFileSync(path.join(o.assetsDir, f), path.join(this.root, '_workbook', f));
    const link = path.join(this.root, 'content');
    try {
      fs.rmSync(link, { force: true });
    } catch {
      /* ignore */
    }
    fs.symlinkSync(o.contentDir, link, 'dir');
    // Asked for by the first render (cache key) and by /api/info; spawning Typst then would add ~100 ms to either.
    void this.version();
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

  private async itemSource(item: Renderable): Promise<{ source: string; headerLines: number; inlineRemarks: boolean; key: string }> {
    const typst = withQuizSources(item.typst);
    const header = this.header(item.chapterRel, item.codeLanguage).join('\n') + '\n';
    // A lesson's remarks are notes in its text, where the author put them.
    const inlineRemarks = item.meta?.type === 'lesson';
    const key = await this.cacheKey(header + typst + (inlineRemarks ? '\0inline-remarks' : ''));
    return { source: header + typst, headerLines: header.split('\n').length - 1, inlineRemarks, key };
  }

  async renderItem(item: Renderable): Promise<RenderedItem> {
    const { source, headerLines, inlineRemarks, key } = await this.itemSource(item);
    const cached = this.readCache(key);
    // Titles are filled in after the cache, so renaming an exercise updates links to it.
    if (cached) return this.fillTitles(cached);

    const run = await this.compile(source, headerLines);
    if (run.html === null) {
      return { task: '', remarks: [], hints: [], samples: [], questions: [], css: '', diagnostics: run.diagnostics.map((d) => ({ ...d })) };
    }
    const rendered: RenderedItem = { ...splitDocument(run.html, { inlineRemarks }), diagnostics: run.diagnostics };
    this.writeCache(key, rendered);
    return this.fillTitles(rendered);
  }

  /**
   * Renders these texts in the background, so the first visit to each finds it in the cache. Replaces what was
   * still to be warmed for this course; texts already in the cache cost a hash each.
   */
  warm(texts: Renderable[]): void {
    this.stopWarming();
    lane.jobs.push(...texts.map((text) => ({ renderer: this, text })));
    lane.quietSince = Math.max(lane.quietSince, Date.now());
    void pumpWarming();
  }

  /** Forgets what was still to be warmed for this course, e.g. when it is removed. */
  stopWarming(): void {
    lane.jobs = lane.jobs.filter((j) => j.renderer !== this);
  }

  /** One text of `warm`. False when a real compile ended it first. */
  async warmOne(item: Renderable): Promise<boolean> {
    const { source, headerLines, inlineRemarks, key } = await this.itemSource(item);
    if (fs.existsSync(this.cachePath(key))) return true;
    const run = await this.compile(source, headerLines, {}, true);
    if (run.cancelled) return false;
    if (run.html !== null) this.writeCache(key, { ...splitDocument(run.html, { inlineRemarks }), diagnostics: run.diagnostics });
    return true;
  }

  /** Renders a student's note. Never cached: it is previewed while typing. */
  /** `width`: where it is shown, in pt, so a picture fallback is laid out at that width instead of being scaled. */
  async renderNote(source: string, width?: number): Promise<RenderedNote> {
    const header = this.header().join('\n') + '\n';
    let run = await this.compile(header + source, header.split('\n').length - 1);
    let asPicture = false;
    // Lost in HTML export: laid out as a page instead, the way typst-preview shows it.
    if (lostSomething(run.diagnostics)) {
      const pictured = [...this.header(), '#show: _as-picture'].join('\n') + '\n';
      const again = await this.compile(pictured + source, pictured.split('\n').length - 1, width ? { 'wb-width': String(Math.round(width)) } : {});
      if (again.html !== null) {
        run = again;
        asPicture = true;
      }
    }
    if (run.html === null) return { html: '', css: '', diagnostics: run.diagnostics };
    const body = bodyOf(run.html);
    return { ...body, html: this.fillXrefs(body.html), diagnostics: run.diagnostics, ...(asPicture ? { asPicture } : {}) };
  }

  /** Renders a flashcard deck. Cached like exercises: a review session renders the same deck again and again. */
  async renderDeck(source: string): Promise<RenderedNote> {
    const header = [...this.header(), '#import "/_workbook/flashcards.typ": flashcard, cloze, quiz'].join('\n') + '\n';
    const key = await this.cacheKey(`deck\n${header}${source}`);
    const cached = this.readCache<RenderedNote>(key);
    if (cached && typeof cached.html === 'string') return { ...cached, html: this.fillXrefs(cached.html) };
    let run = await this.compile(header + source, header.split('\n').length - 1);
    let asPicture = false;
    // Lost in HTML export: card sides are laid out as pages. A cloze stays text, or its gaps could not be hidden.
    if (lostSomething(run.diagnostics)) {
      const pictured = [...this.header(), '#import "/_workbook/flashcards.typ": _flashcard-framed as flashcard, cloze, quiz'].join('\n') + '\n';
      const again = await this.compile(pictured + source, pictured.split('\n').length - 1);
      if (again.html !== null) {
        run = again;
        asPicture = true;
      }
    }
    if (run.html === null) return { html: '', css: '', diagnostics: run.diagnostics };
    const body = bodyOf(run.html);
    const out = { ...body, diagnostics: run.diagnostics, ...(asPicture ? { asPicture } : {}) };
    this.writeCache(key, out);
    return { ...out, html: this.fillXrefs(out.html) };
  }

  // ───────────── internals ─────────────

  /** Fills in the (current) title of every `xref` that has no body of its own. */
  private fillXrefs(html: string): string {
    return html.replace(/<a ([^>]*\bclass="wb-xref"[^>]*)><\/a>/g, (_m, attrs: string) => {
      const id = /\bdata-xref="([^"]*)"/.exec(attrs)?.[1] ?? '';
      const title = this.titles(id);
      const a = title === undefined ? attrs.replace('class="wb-xref"', 'class="wb-xref wb-xref-broken"') : attrs;
      // Code in a title, `like this`, is code in the link too.
      return `<a ${a}>${escape(title ?? id).replace(/`([^`]+)`/g, '<code>$1</code>')}</a>`;
    });
  }

  private fillTitles(r: RenderedItem): RenderedItem {
    const fill = (h: string) => this.fillXrefs(h);
    return { ...r, task: fill(r.task), remarks: r.remarks.map(fill), hints: r.hints.map(fill), samples: r.samples.map(fill), questions: r.questions.map((q) => ({ ...q, html: fill(q.html) })) };
  }

  private async cacheKey(source: string): Promise<string> {
    const helper = (name: string) => (fs.existsSync(path.join(this.root, '_workbook', name)) ? fs.readFileSync(path.join(this.root, '_workbook', name), 'utf8') : '');
    // Everything that shapes the output: the helpers, and how the HTML is processed afterwards.
    const prelude = `${RENDER_VERSION}\0${helper('prelude.typ')}\0${helper('flashcards.typ')}`;
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

  private cachePath(key: string): string {
    return path.join(this.cacheDir, key + '.json');
  }

  private readCache<T = RenderedItem>(key: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(this.cachePath(key), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  private writeCache(key: string, r: { diagnostics: TypstDiagnostic[] }): void {
    // Compile errors are not cached: fixing a package or the prelude should show up immediately.
    if (r.diagnostics.some((d) => d.severity === 'error')) return;
    // Written whole and then moved, so a render read at the same time never sees half of it.
    const tmp = `${this.cachePath(key)}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(r));
    fs.renameSync(tmp, this.cachePath(key));
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

  /** `background`: warming, outside the pool of real compiles, and ended by the next one of those. */
  private async compile(
    source: string,
    headerLines: number,
    inputs: Record<string, string> = {},
    background = false,
  ): Promise<{ html: string | null; diagnostics: TypstDiagnostic[]; cancelled?: boolean }> {
    if (!background) {
      lane.busy++;
      lane.cancel?.();
      await this.acquire();
    }
    let cancelled = false;
    const id = crypto.randomBytes(6).toString('hex');
    const input = path.join(this.root, '_tmp', `${id}.typ`);
    const output = path.join(this.root, '_tmp', `${id}.html`);
    try {
      fs.writeFileSync(input, source);
      const { stderr, code, error } = await new Promise<{ stderr: string; code: number | null; error: string | null }>((resolve) => {
        const proc = spawn(
          this.o.bin,
          // The app's own fonts, so pictures look like the text around them.
          [
            'compile',
            '--root',
            this.root,
            '--font-path',
            path.join(this.o.assetsDir, 'fonts'),
            ...Object.entries(inputs).flatMap(([k, v]) => ['--input', `${k}=${v}`]),
            '--features',
            'html',
            '--format',
            'html',
            '--diagnostic-format',
            'short',
            input,
            output,
          ],
          {
            stdio: ['ignore', 'ignore', 'pipe'],
            env: {
              ...process.env,
              TYPST_PACKAGE_CACHE_PATH: process.env.TYPST_PACKAGE_CACHE_PATH ?? path.join(this.o.dataDir, 'typst-packages'),
            },
          },
        );
        if (background)
          lane.cancel = () => {
            cancelled = true;
            proc.kill('SIGKILL');
          };
        let stderr = '';
        proc.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
        const timer = setTimeout(() => proc.kill('SIGKILL'), 60_000);
        proc.on('error', (e) => resolve({ stderr, code: null, error: e.message }));
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ stderr, code, error: null });
        });
      });
      if (background) lane.cancel = null;
      if (cancelled) return { html: null, diagnostics: [], cancelled };

      const diagnostics = parseDiagnostics(stderr, headerLines, path.basename(input));
      if (error) diagnostics.push({ severity: 'error', line: null, column: null, message: `Could not run typst: ${error}` });
      if (code !== 0 && !diagnostics.some((d) => d.severity === 'error'))
        diagnostics.push({ severity: 'error', line: null, column: null, message: stderr.trim() || `typst exited with code ${code}` });
      const html = code === 0 && fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
      return { html, diagnostics };
    } finally {
      fs.rmSync(input, { force: true });
      fs.rmSync(output, { force: true });
      if (!background) {
        this.release();
        this.idle();
      }
    }
  }

  private idle(): void {
    lane.busy--;
    lane.quietSince = Date.now();
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

/**
 * Every `#quiz(…)` is given its own text as `_src`, so a student can make a flashcard of it: a quiz card is
 * written exactly like the quiz in the lesson. The string stays on the line, so no line moves.
 */
export function withQuizSources(typst: string): string {
  let out = typst;
  const quizzes = scanCards(typst).filter((c) => c.kind === 'quiz' && c.args);
  for (const q of quizzes.reverse()) {
    const at = q.args!.from + 1;
    const body = dedent(typst.slice(at, q.args!.to));
    const literal = `"${body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
    out = `${out.slice(0, at)}_src: ${literal}, ${out.slice(at)}`;
  }
  return out;
}
