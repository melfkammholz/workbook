import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { ZodError } from 'zod';
import { RUNNABLE_LANGUAGES } from '@wb/shared';
import type {
  ChapterMeta,
  ChecklistMeta,
  CodeSpec,
  ContentProblem,
  ExerciseMeta,
  ItemMeta,
  Language,
  Outline,
  PageMeta,
  PartMeta,
  RunnableLanguage,
  TagInfo,
  ThreadInfo,
} from '@wb/shared';
import { preprocess, PreprocessError, solutionBlocks, usesTemplateConditionals, type SolutionBlock } from './cpp.js';
import { deriveTitle, emojiFor, slugify } from './ids.js';
import { plainText } from './search.js';
import {
  chapterSchema,
  checklistSchema,
  exerciseSchema,
  pageSchema,
  sectionSchema,
  tagsSchema,
  threadSchema,
  workbookSchema,
  type ExerciseEntry,
} from './schema.js';

/** Everything the server needs to run an exercise's code, loaded into memory. */
export interface ServerCode {
  language: Language;
  runnable: boolean;
  options: string[];
  /** The first (usually the only) file the student edits, inside a session directory. */
  studentPath: string;
  starter: string;
  solution: string | null;
  /** Everything the student edits: path → what it starts as. */
  files: Record<string, string>;
  /** The complete solution: path → source. Only the tools see this for shared files. */
  fullSolution: Record<string, string>;
  /** What this exercise may show a student: path → source. */
  reveal: Record<string, string>;
  /** The adventure or thread whose files these are. */
  shared: string | null;
  check: string | null;
  /** Read-only modules, keyed by session-relative path. */
  support: Record<string, string>;
}

interface ServerItemBase {
  /** Typst source of the task text. */
  typst: string;
  /** Path of the text file relative to the content dir (for diagnostics). */
  typstRel: string;
  /** Directory of the chapter, relative to the content dir. Used to resolve images etc. */
  chapterRel: string;
  /** What inline code and code blocks without a language of their own are highlighted as. */
  codeLanguage: string | null;
}
export interface ServerExercise extends ServerItemBase {
  meta: ExerciseMeta;
  code: ServerCode | null;
}
export interface ServerPage extends ServerItemBase {
  meta: PageMeta;
}
export interface ServerChecklist extends ServerItemBase {
  meta: ChecklistMeta;
}
export type ServerItem = ServerExercise | ServerPage | ServerChecklist;

/** A text that is not an item of the outline: landing page, chapter introduction, adventure page. */
export type ServerDoc = ServerItemBase;
export const docKey = {
  landing: 'landing',
  chapter: (id: string) => `chapter/${id}`,
  thread: (id: string) => `thread/${id}`,
};

/** Files of an adventure or thread that several exercises work in. */
interface SharedFiles {
  language: Language;
  options: string[];
  files: { path: string; starter: string; solution: string; blocks: SolutionBlock[] }[];
  support: Record<string, string>;
  /** For error messages. */
  source: string;
}

export class Content {
  private texts: { id: string; title: string; href: string; text: string }[] | undefined;

  constructor(
    readonly dir: string,
    readonly outline: Outline,
    private readonly items: Map<string, ServerItem>,
    private readonly docs: Map<string, ServerDoc> = new Map(),
  ) {}

  /** The words of every item, worked out once for this version of the course. */
  searchTexts(): { id: string; title: string; href: string; text: string }[] {
    this.texts ??= [
      ...this.all().map((i) => ({ id: i.meta.id, title: i.meta.title, href: `/item/${i.meta.id}`, text: plainText(i.typst) })),
      ...this.outline.chapters.flatMap((c) => {
        const doc = this.doc(docKey.chapter(c.id));
        return doc ? [{ id: `chapter/${c.id}`, title: c.title, href: `/chapter/${c.id}`, text: plainText(doc.typst) }] : [];
      }),
      ...this.outline.threads.flatMap((t) => {
        const doc = this.doc(docKey.thread(t.id));
        return doc ? [{ id: `thread/${t.id}`, title: t.title, href: `/adventure/${t.id}`, text: plainText(doc.typst) }] : [];
      }),
      ...(this.doc(docKey.landing) ? [{ id: 'landing', title: this.outline.title, href: '/welcome', text: plainText(this.doc(docKey.landing)!.typst) }] : []),
    ];
    return this.texts;
  }

  doc(key: string): ServerDoc | undefined {
    return this.docs.get(key);
  }

  allDocs(): ServerDoc[] {
    return [...this.docs.values()];
  }

  /** Where the work in a file lives: shared files belong to their adventure, not to one exercise. */
  owner(id: string, slot: string): string {
    const code = this.exercise(id)?.code;
    return code?.shared && slot in code.files ? sharedOwner(code.shared) : id;
  }

  /** An exercise that works in the files stored under this owner, to link to them. */
  exerciseOfOwner(owner: string): string | undefined {
    if (!owner.startsWith('@')) return owner;
    return this.all().find((i) => i.meta.type === 'exercise' && (i as ServerExercise).code?.shared === owner.slice(1))?.meta.id;
  }

  get(id: string): ServerItem | undefined {
    return this.items.get(id);
  }

  exercise(id: string): ServerExercise | undefined {
    const item = this.items.get(id);
    return item && item.meta.type === 'exercise' ? (item as ServerExercise) : undefined;
  }

  all(): ServerItem[] {
    return [...this.items.values()];
  }
}

/** Exercise ids cannot start with this, so shared work never clashes with an exercise's own. */
export const sharedOwner = (threadId: string) => `@${threadId}`;

// ───────────────────────── helpers ─────────────────────────

function readYaml(file: string): unknown {
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

function formatZod(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`)
    .join('; ');
}

/** Module name → session-relative path, e.g. `Playground.Foo` → `Playground/Foo.hs`. */
export function haskellPathFor(source: string, fallback = 'Main.hs'): string {
  const m = /^\s*module\s+([A-Z][\w']*(?:\.[A-Z][\w']*)*)/m.exec(source);
  return m ? m[1]!.split('.').join('/') + '.hs' : fallback;
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

/** Changes whenever any content file is added, removed or modified. */
export function contentSignature(dir: string): string {
  const h = crypto.createHash('sha1');
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.statSync(p);
        h.update(`${path.relative(dir, p)}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
      }
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 12);
}

// ───────────────────────── loading ─────────────────────────

export function loadContent(dir: string): Content {
  const problems: ContentProblem[] = [];
  const err = (file: string, message: string, itemId?: string) =>
    problems.push({ severity: 'error', file, message, ...(itemId ? { itemId } : {}) });
  const warn = (file: string, message: string, itemId?: string) =>
    problems.push({ severity: 'warning', file, message, ...(itemId ? { itemId } : {}) });
  const rel = (p: string) => path.relative(dir, p);

  // workbook.yml (optional)
  let wb = workbookSchema.parse({});
  const wbFile = path.join(dir, 'workbook.yml');
  if (fs.existsSync(wbFile)) {
    try {
      const parsed = workbookSchema.safeParse(readYaml(wbFile) ?? {});
      if (parsed.success) wb = parsed.data;
      else err('workbook.yml', formatZod(parsed.error));
    } catch (e) {
      err('workbook.yml', `invalid YAML: ${(e as Error).message}`);
    }
  }

  // tags.yml (optional)
  const tagMap = new Map<string, TagInfo>();
  const tagsFile = path.join(dir, 'tags.yml');
  if (fs.existsSync(tagsFile)) {
    try {
      const parsed = tagsSchema.safeParse(readYaml(tagsFile) ?? {});
      if (!parsed.success) err('tags.yml', formatZod(parsed.error));
      else
        for (const [id, v] of Object.entries(parsed.data))
          tagMap.set(id, typeof v === 'string' ? { id, label: v, color: null, type: 'topic', description: null, review: true } : { id, label: v.label, color: v.color ?? null, type: v.type, description: v.description ?? null, review: v.review });
    } catch (e) {
      err('tags.yml', `invalid YAML: ${(e as Error).message}`);
    }
  }

  const items = new Map<string, ServerItem>();
  const docs = new Map<string, ServerDoc>();
  const readDoc = (key: string, file: string, what: string, codeLanguage: string | null = null) => {
    const typstRel = rel(file);
    const typst = readText(file);
    if (typst === null) return err(typstRel, `text file not found (${what})`);
    docs.set(key, { typst, typstRel, chapterRel: rel(path.dirname(file)), codeLanguage });
  };
  if (wb.landing) readDoc(docKey.landing, path.join(dir, wb.landing), 'landing page');

  // Threads come first: exercises can work in their files.
  const threads: ThreadInfo[] = [];
  const shared = new Map<string, SharedFiles>();
  const threadsDir = path.join(dir, 'threads');
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
      try {
        const parsed = threadSchema.safeParse(readYaml(path.join(threadsDir, f)));
        if (!parsed.success) {
          err(`threads/${f}`, formatZod(parsed.error));
          continue;
        }
        const t = parsed.data;
        const id = t.id ?? f.replace(/\.ya?ml$/, '');
        threads.push({
          id,
          title: t.title,
          description: t.description ?? null,
          steps: t.steps.map((s) => (Array.isArray(s) ? s : [s])),
          adventure: !!t.page,
          finale: t.finale ?? null,
        });
        if (t.page) readDoc(docKey.thread(id), path.join(threadsDir, t.page), `page of "${id}"`, t.language);
        if (t.files) shared.set(id, loadSharedFiles(t, threadsDir, `threads/${f}`, err));
      } catch (e) {
        err(`threads/${f}`, `invalid YAML: ${(e as Error).message}`);
      }
    }
  }

  const chapters: ChapterMeta[] = [];
  const chaptersDir = path.join(dir, 'chapters');
  const onDisk = listDirs(chaptersDir);

  // Parts decide the order of the chapters they list. A chapter nobody lists still appears, at the end.
  const parts: PartMeta[] = [];
  const partOfDir = new Map<string, string>();
  const unnumberedParts = new Set<string>();
  if (wb.parts && wb.chapters) warn('workbook.yml', '"chapters" is ignored because "parts" sets the order');
  for (const [n, p] of (wb.parts ?? []).entries()) {
    const partId = p.id ?? `part-${n + 1}`;
    if (parts.some((x) => x.id === partId)) err('workbook.yml', `duplicate part id "${partId}"`);
    parts.push({ id: partId, title: p.title, summary: p.summary ?? null });
    if (!p.numbered) unnumberedParts.add(partId);
    for (const c of p.chapters) {
      if (partOfDir.has(c)) err('workbook.yml', `chapter "${c}" is listed in two parts`);
      else partOfDir.set(c, partId);
    }
  }
  const chapterDirs = wb.parts ? [...partOfDir.keys()] : (wb.chapters ?? onDisk);
  if (wb.parts)
    for (const d of onDisk)
      if (!partOfDir.has(d)) {
        warn('workbook.yml', `chapter "${d}" is not in any part; it is shown after the parts`);
        chapterDirs.push(d);
      }
  let globalIndex = 0;
  let chapterNo = 0;

  for (const chapterDirName of chapterDirs) {
    const chapterDir = path.join(chaptersDir, chapterDirName);
    const chapterFile = path.join(chapterDir, 'chapter.yml');
    if (!fs.existsSync(chapterFile)) {
      err(rel(chapterDir), 'chapter directory has no chapter.yml');
      continue;
    }
    let raw: unknown;
    try {
      raw = readYaml(chapterFile);
    } catch (e) {
      err(rel(chapterFile), `invalid YAML: ${(e as Error).message}`);
      continue;
    }
    const head = chapterSchema.omit({ items: true }).passthrough().safeParse(raw);
    if (!head.success) {
      err(rel(chapterFile), formatZod(head.error));
      continue;
    }
    const rawItems = (raw as { items?: unknown[] }).items;
    if (!Array.isArray(rawItems)) {
      err(rel(chapterFile), 'items: must be a list');
      continue;
    }

    const chapterId = head.data.id ?? chapterDirName.replace(/^\d+[-_]?/, '');
    const partId = partOfDir.get(chapterDirName) ?? null;
    const chapter: ChapterMeta = {
      id: chapterId,
      number: partId && unnumberedParts.has(partId) ? null : ++chapterNo,
      title: head.data.title,
      summary: head.data.summary ?? null,
      hasIntro: !!head.data.intro,
      partId,
      sections: [],
      items: [],
    };
    const defaults = { ...wb.defaults, ...head.data.defaults };
    if (head.data.intro) readDoc(docKey.chapter(chapterId), path.join(chapterDir, head.data.intro), `introduction of chapter "${chapterId}"`, defaults.scratch ?? null);
    let exerciseNo = 0;
    let sectionId: string | null = null;

    rawItems.forEach((rawItem, n) => {
      if (typeof rawItem === 'object' && rawItem !== null && 'section' in rawItem) {
        const parsed = sectionSchema.safeParse(rawItem);
        if (!parsed.success) return err(rel(chapterFile), `items[${n}]: ${formatZod(parsed.error)}`);
        sectionId = `${chapterId}/${chapter.sections.length + 1}`;
        chapter.sections.push({ id: sectionId, title: parsed.data.section });
        return;
      }

      const isPage = typeof rawItem === 'object' && rawItem !== null && 'page' in rawItem;

      if (isPage) {
        const parsed = pageSchema.safeParse(rawItem);
        if (!parsed.success) return err(rel(chapterFile), `items[${n}]: ${formatZod(parsed.error)}`);
        const p = parsed.data;
        if (items.has(p.page)) return err(rel(chapterFile), `duplicate id "${p.page}"`, p.page);
        const textRel = rel(path.join(chapterDir, p.text ?? `${p.page}.typ`));
        const typst = readText(path.join(dir, textRel));
        if (typst === null) return err(textRel, `text file not found (page "${p.page}")`, p.page);
        const meta: PageMeta = { type: 'page', id: p.page, chapterId, sectionId, title: p.title, index: globalIndex++ };
        chapter.items.push(meta);
        items.set(p.page, { meta, typst, typstRel: textRel, chapterRel: rel(chapterDir), codeLanguage: defaults.scratch ?? null });
        return;
      }

      if (typeof rawItem === 'object' && rawItem !== null && 'checklist' in rawItem) {
        const parsed = checklistSchema.safeParse(rawItem);
        if (!parsed.success) return err(rel(chapterFile), `items[${n}]: ${formatZod(parsed.error)}`);
        const c = parsed.data;
        if (items.has(c.checklist)) return err(rel(chapterFile), `duplicate id "${c.checklist}"`, c.checklist);
        const textRel = rel(path.join(chapterDir, c.text ?? `${c.checklist}.typ`));
        const typst = readText(path.join(dir, textRel));
        if (typst === null) return err(textRel, `text file not found (checklist "${c.checklist}")`, c.checklist);
        if (!/#question\s*[\[(]/.test(typst)) warn(textRel, `checklist "${c.checklist}" has no #question[…]`, c.checklist);
        const title = c.title ?? (wb.language.startsWith('de') ? 'Selbstevaluation' : 'Self-evaluation');
        const questionCount = (typst.match(/#question\s*[\[(]/g) ?? []).length;
        const meta: ChecklistMeta = { type: 'checklist', id: c.checklist, chapterId, sectionId, title, index: globalIndex++, questionCount };
        chapter.items.push(meta);
        items.set(c.checklist, { meta, typst, typstRel: textRel, chapterRel: rel(chapterDir), codeLanguage: defaults.scratch ?? null });
        return;
      }

      const parsed = exerciseSchema.safeParse(rawItem);
      if (!parsed.success) return err(rel(chapterFile), `items[${n}]: ${formatZod(parsed.error)}`);
      const e: ExerciseEntry = parsed.data;
      if (items.has(e.id)) return err(rel(chapterFile), `duplicate id "${e.id}"`, e.id);

      const textRel = rel(path.join(chapterDir, e.text ?? `${e.id}.typ`));
      const typst = readText(path.join(dir, textRel));
      if (typst === null) return err(textRel, `text file not found (exercise "${e.id}")`, e.id);

      let code: ServerCode | null = null;
      if (e.code) code = e.code.shared ? loadSharedCode(e.id, e.code, shared, chapterDir, rel, err) : loadCode(e.id, e.code, chapterDir, rel, err, warn);

      exerciseNo++;
      const sh = e['start-here'];
      if (sh !== false && e.extra) err(rel(chapterFile), `exercise "${e.id}" is both start-here and extra`, e.id);
      const scratch = e.scratch ?? defaults.scratch ?? null;
      const spec: CodeSpec | null = code
        ? {
            language: code.language,
            runnable: code.runnable,
            files: Object.keys(code.files),
            shared: code.shared,
            // `#ifdef TEMPLATE <ids>` says which parts of a shared file are whose.
            edits: code.shared ? Object.keys(code.reveal) : Object.keys(code.files),
            hasCheck: code.check !== null,
            hasSolution: Object.keys(code.reveal).length > 0,
            options: code.options,
          }
        : null;
      const meta: ExerciseMeta = {
        type: 'exercise',
        id: e.id,
        chapterId,
        sectionId,
        index: globalIndex++,
        number: chapter.number === null ? String(exerciseNo) : `${chapter.number}.${exerciseNo}`,
        title: e.title ?? deriveTitle(typst),
        kind: e.kind ?? defaults.kind ?? 'test',
        level: e.level ?? defaults.level ?? 1,
        startHere: sh !== false,
        // Both at once is an error (reported below); start-here wins, so the exercise stays in every focus.
        extra: e.extra && sh === false,
        long: e.long ?? defaults.long ?? false,
        emoji: sh === false ? null : typeof sh === 'string' ? sh : emojiFor(e.id),
        tags: [...new Set([...(defaults.tags ?? []), ...e.tags])],
        after: e.after,
        mentions: [],
        similar: e.similar,
        next: [],
        helpAfterMinutes: e['help-after'] ?? null,
        hasSample: /#sample\s*\[/.test(typst),
        scratch: spec ? null : (scratch as RunnableLanguage | null),
        code: spec,
      };
      chapter.items.push(meta);
      items.set(e.id, { meta, typst, typstRel: textRel, chapterRel: rel(chapterDir), codeLanguage: code?.language ?? scratch, code });
    });
    // A checklist that ends the chapter is about all of it, not about its last section.
    const last = chapter.items.at(-1);
    if (last?.type === 'checklist') last.sectionId = null;
    chapters.push(chapter);
  }

  // ── cross-item validation and derived data ──
  const exercises = [...items.values()].filter((i): i is ServerExercise => i.meta.type === 'exercise');
  const known = (id: string) => items.has(id);

  for (const ex of exercises) {
    const m = ex.meta;
    const file = ex.typstRel;
    for (const field of ['after', 'similar'] as const) {
      for (const ref of m[field]) {
        if (ref === m.id) err(file, `${field}: "${ref}" refers to itself`, m.id);
        else if (!known(ref)) err(file, `${field}: unknown id "${ref}"`, m.id);
      }
      m[field] = m[field].filter((r) => r !== m.id && known(r));
    }
    for (const t of m.tags) if (!tagMap.has(t)) tagMap.set(t, { id: t, label: t, color: null, type: 'topic', description: null, review: true });
  }
  for (const item of items.values()) {
    const seen = new Set<string>();
    for (const x of item.typst.matchAll(/xref\(\s*"([^"]+)"/g)) {
      const ref = x[1]!;
      if (ref === item.meta.id) continue;
      if (!known(ref)) err(item.typstRel, `xref: unknown id "${ref}"`, item.meta.id);
      else seen.add(ref);
    }
    if (item.meta.type === 'exercise') item.meta.mentions = [...seen];
  }
  for (const doc of docs.values())
    for (const x of doc.typst.matchAll(/xref\(\s*"([^"]+)"/g)) if (!known(x[1]!)) err(doc.typstRel, `xref: unknown id "${x[1]}"`);

  // A part of a shared solution has to name exercises that work in that file.
  for (const [threadId, sf] of shared) {
    const using = new Set(exercises.filter((e) => e.code?.shared === threadId).map((e) => e.meta.id));
    for (const file of sf.files)
      for (const block of file.blocks)
        for (const name of block.exercises) if (!using.has(name)) err(sf.source, `${file.path}: "#ifdef TEMPLATE ${name}" names an exercise that does not work in these files`);
  }

  // reverse edges
  for (const ex of exercises)
    for (const a of ex.meta.after) {
      const target = items.get(a);
      if (target?.meta.type === 'exercise') target.meta.next.push(ex.meta.id);
      else if (target) err(ex.typstRel, `after: "${a}" is not an exercise`, ex.meta.id);
    }

  // cycles in explicit `after`
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const visit = (id: string, stack: string[]) => {
    state.set(id, 1);
    const ex = items.get(id) as ServerExercise | undefined;
    for (const dep of ex?.meta.after ?? []) {
      if (state.get(dep) === 1) {
        const cyc = [...stack.slice(stack.indexOf(dep)), id, dep].join(' → ');
        if (!reported.has(cyc)) {
          reported.add(cyc);
          err(ex!.typstRel, `dependency cycle: ${cyc}`, id);
        }
      } else if (!state.has(dep) && items.get(dep)?.meta.type === 'exercise') visit(dep, [...stack, id]);
    }
    state.set(id, 2);
  };
  for (const ex of exercises) if (!state.has(ex.meta.id)) visit(ex.meta.id, []);

  // the recommended path should not depend on exercises outside it
  for (const ex of exercises.filter((e) => e.meta.startHere))
    for (const a of ex.meta.after) {
      const dep = items.get(a);
      if (dep?.meta.type === 'exercise' && !dep.meta.startHere)
        warn(ex.typstRel, `start-here exercise "${ex.meta.id}" comes after "${a}", which is not marked start-here`, ex.meta.id);
    }

  // The focus "essentials" shows a chapter's start-here exercises: without any, it shows only the chapter's texts.
  // A course that marks none at all does not offer that focus, so there is nothing to warn about.
  if (exercises.some((e) => e.meta.startHere)) for (const chapter of chapters) {
    const own = exercises.filter((e) => e.meta.chapterId === chapter.id);
    if (own.length && !own.some((e) => e.meta.startHere)) warn(own[0]!.chapterRel + '/chapter.yml', `chapter "${chapter.id}" has no start-here exercise, so the focus "essentials" shows none of its exercises`);
  }

  for (const t of threads)
    for (const step of t.steps)
      for (const sid of step) {
        if (!known(sid)) err(`threads/${t.id}.yml`, `unknown id "${sid}"`);
        else if (items.get(sid)!.meta.type !== 'exercise') warn(`threads/${t.id}.yml`, `"${sid}" is not an exercise`);
      }
  for (const t of threads) t.steps = t.steps.map((s) => s.filter(known)).filter((s) => s.length > 0);
  for (const t of threads)
    if (t.finale && !t.steps.some((s) => s.includes(t.finale!))) {
      err(`threads/${t.id}.yml`, `finale: "${t.finale}" is not one of the steps`);
      t.finale = null;
    }

  // In a chapter, the exercises of an adventure stand together under its name. A simple path can cut across sections.
  for (const chapter of chapters)
    for (const item of chapter.items) {
      const own = threads.filter((t) => t.adventure && t.steps.some((s) => s.includes(item.id)));
      if (!own.length) continue;
      const section = chapter.sections.find((s) => s.id === item.sectionId)?.title;
      if (!own.some((t) => t.title === section))
        warn(items.get(item.id)!.typstRel, `"${item.id}" belongs to "${own.map((t) => t.title).join('" and "')}", so it should be in a section with that name`, item.id);
    }

  const outline: Outline = {
    title: wb.title,
    id: wb.id ?? slugify(wb.title),
    exams: wb.exams.map((e) => ({ title: e.title ?? null, date: e.date })),
    language: wb.language,
    landing: docs.has(docKey.landing),
    issues: wb.issues ?? null,
    parts,
    chapters,
    tags: [...tagMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    threads,
    problems,
    version: contentSignature(dir),
  };
  return new Content(dir, outline, items, docs);
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function loadCode(
  id: string,
  spec: NonNullable<ExerciseEntry['code']>,
  chapterDir: string,
  rel: (p: string) => string,
  err: (file: string, message: string, itemId?: string) => void,
  warn: (file: string, message: string, itemId?: string) => void,
): ServerCode | null {
  const language = spec.language ?? 'haskell';
  const runnable = RUNNABLE_LANGUAGES.includes(language);
  let starter: string;
  let solution: string | null = null;
  if (spec.file === undefined) {
    // No template: the author only says "this is a programming exercise".
    starter = emptyStarter(language);
    if (spec.solution) {
      solution = readText(path.join(chapterDir, spec.solution));
      if (solution === null) err(rel(path.join(chapterDir, spec.solution)), `solution file not found (exercise "${id}")`, id);
    }
  } else {
    const mainPath = path.join(chapterDir, spec.file);
    const main = readText(mainPath);
    if (main === null) {
      err(rel(mainPath), `code file not found (exercise "${id}")`, id);
      return null;
    }
    try {
      starter = preprocess(main, { TEMPLATE: true });
      if (spec.solution) {
        solution = readText(path.join(chapterDir, spec.solution));
        if (solution === null) err(rel(path.join(chapterDir, spec.solution)), `solution file not found (exercise "${id}")`, id);
      } else if (usesTemplateConditionals(main)) {
        solution = preprocess(main, {});
      }
    } catch (e) {
      if (e instanceof PreprocessError) {
        err(rel(mainPath), `line ${e.line}: ${e.message}`, id);
        return null;
      }
      throw e;
    }
    if (!spec.solution && !usesTemplateConditionals(main))
      warn(rel(mainPath), `exercise "${id}" has no solution (use #ifdef TEMPLATE … #else … #endif, or "solution:")`, id);
  }

  if (!runnable && (spec.check || spec.support.length))
    warn(rel(chapterDir), `exercise "${id}": the workbook cannot run ${language}, so its tests and support files are ignored`, id);

  let check: string | null = null;
  if (spec.check && runnable) {
    check = readText(path.join(chapterDir, spec.check));
    if (check === null) err(rel(path.join(chapterDir, spec.check)), `check file not found (exercise "${id}")`, id);
  }

  const support: Record<string, string> = {};
  for (const s of runnable ? spec.support : []) {
    const content = readText(path.join(chapterDir, s));
    if (content === null) err(rel(path.join(chapterDir, s)), `support file not found (exercise "${id}")`, id);
    else support[language === 'haskell' ? haskellPathFor(content, path.basename(s)) : path.basename(s)] = content;
  }

  const studentPath =
    language === 'haskell'
      ? haskellPathFor(starter)
      : spec.file
        ? path.basename(spec.file)
        : `answer.${EXTENSIONS[language] ?? 'txt'}`;
  return {
    language,
    runnable,
    options: spec.options,
    studentPath,
    starter,
    solution,
    files: { [studentPath]: starter },
    fullSolution: solution === null ? {} : { [studentPath]: solution },
    reveal: solution === null ? {} : { [studentPath]: solution },
    shared: null,
    check,
    support,
  };
}

function loadSharedFiles(t: { language: string; options: string[]; files?: string[] | undefined; support: string[] }, threadsDir: string, source: string, err: (file: string, message: string) => void): SharedFiles {
  const result: SharedFiles = { language: t.language, options: t.options, files: [], support: {}, source };
  const runnable = RUNNABLE_LANGUAGES.includes(t.language);
  for (const f of t.files ?? []) {
    const text = readText(path.join(threadsDir, f));
    if (text === null) {
      err(source, `shared file not found: ${f}`);
      continue;
    }
    try {
      const starter = preprocess(text, { TEMPLATE: true });
      const filePath = t.language === 'haskell' ? haskellPathFor(starter, path.basename(f)) : path.basename(f);
      result.files.push({ path: filePath, starter, solution: preprocess(text, {}), blocks: solutionBlocks(text) });
    } catch (e) {
      if (!(e instanceof PreprocessError)) throw e;
      err(source, `${f}, line ${e.line}: ${e.message}`);
    }
  }
  for (const f of runnable ? t.support : []) {
    const text = readText(path.join(threadsDir, f));
    if (text === null) err(source, `support file not found: ${f}`);
    else result.support[t.language === 'haskell' ? haskellPathFor(text, path.basename(f)) : path.basename(f)] = text;
  }
  return result;
}

/** An exercise working in the files of an adventure or thread. It brings its own tests, nothing else. */
function loadSharedCode(
  id: string,
  spec: NonNullable<ExerciseEntry['code']>,
  shared: Map<string, SharedFiles>,
  chapterDir: string,
  rel: (p: string) => string,
  err: (file: string, message: string, itemId?: string) => void,
): ServerCode | null {
  const sf = shared.get(spec.shared!);
  if (!sf || sf.files.length === 0) {
    err(rel(chapterDir), `exercise "${id}": there is no thread "${spec.shared}" with files`, id);
    return null;
  }
  if (spec.file || spec.solution) err(rel(chapterDir), `exercise "${id}": "file" and "solution" do not go with "shared"; the file is the thread's`, id);
  if (spec.language && spec.language !== sf.language) err(rel(chapterDir), `exercise "${id}": language "${spec.language}" differs from the shared files (${sf.language})`, id);
  let check: string | null = null;
  if (spec.check) {
    check = readText(path.join(chapterDir, spec.check));
    if (check === null) err(rel(path.join(chapterDir, spec.check)), `check file not found (exercise "${id}")`, id);
  }
  const support = { ...sf.support };
  for (const s of spec.support) {
    const content = readText(path.join(chapterDir, s));
    if (content === null) err(rel(path.join(chapterDir, s)), `support file not found (exercise "${id}")`, id);
    else support[sf.language === 'haskell' ? haskellPathFor(content, path.basename(s)) : path.basename(s)] = content;
  }
  const reveal: Record<string, string> = {};
  for (const f of sf.files) {
    const mine = f.blocks.filter((b) => b.exercises.includes(id)).map((b) => b.text);
    if (mine.length) reveal[f.path] = mine.join('\n\n');
  }
  const first = sf.files[0]!;
  return {
    language: sf.language,
    runnable: RUNNABLE_LANGUAGES.includes(sf.language),
    options: [...sf.options, ...spec.options],
    studentPath: first.path,
    starter: first.starter,
    solution: first.solution,
    files: Object.fromEntries(sf.files.map((f) => [f.path, f.starter])),
    fullSolution: Object.fromEntries(sf.files.map((f) => [f.path, f.solution])),
    reveal,
    shared: spec.shared!,
    check,
    support,
  };
}

const EXTENSIONS: Record<string, string> = {
  prolog: 'pl',
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  rust: 'rs',
  go: 'go',
  ruby: 'rb',
  sql: 'sql',
  shell: 'sh',
  bash: 'sh',
};

/** What a programming exercise without a template starts from. */
function emptyStarter(language: string): string {
  // GHCi needs a module header: a file without one is `Main`, which must define `main`.
  return language === 'haskell' ? 'module Answer where\n\n' : '';
}
