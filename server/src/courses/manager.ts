import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { targetHref, type LocalWorkbook, type CardHighlight, type CardPayload, type Created, type CreatePayload, type HighlightPayload, type CourseErrorCode, type CourseInfo, type CoursesResponse, type CourseUpdate } from '@wb/shared';
import type { Config } from '../config.js';
import { loadContent, type Content } from '../content/loader.js';
import { ContentService } from '../content/service.js';
import { TypstRenderer } from '../content/typst.js';
import { MOUNTED_COURSE } from '../db/migrations.js';
import { Store } from '../db/store.js';
import { FlashcardError, Flashcards } from '../flashcards/service.js';
import { Resources } from '../resources/service.js';
import { Snapshots } from '../snapshots.js';
import * as git from './git.js';

export class CourseError extends Error {
  constructor(readonly code: CourseErrorCode) {
    super(code);
  }
}

/** A course the student added. What a mounted folder needs is known from the config. */
interface CourseRecord {
  id: string;
  /** The address; for a workbook from the workbooks folder `local:<name>`, which only serves to name it. */
  url: string;
  /** The folder's name in the workbooks folder. Records without it were added by address. */
  local?: string;
  /** A plain folder (not a git repo) is compared by this: a hash of its files' paths, sizes and times. */
  fingerprint?: string;
  title: string;
  /**
   * The `course` its work is stored under: the course's own id (`workbook.yml` `id`, or its title as a slug), with a
   * suffix when an earlier course already has it. Set once and kept, so the rows never have to move.
   */
  key?: string;
  /** Removed by the student: the copy and the work stay, and adding the same address again brings it back. */
  hidden?: boolean;
}

/** What a flashcard's `from:` points at. */
export interface ExerciseRef {
  title: string;
  courseTitle: string;
  language: string | null;
  /** Only when that course is open. */
  href: string | null;
  /** The course's stable id. */
  course: string;
  chapterId: string | null;
  tags: string[];
  /** All tags of the course, so a card can name one by its label too. */
  courseTags: { id: string; label: string }[];
  exams: { title: string | null; date: string }[];
}

export interface OpenCourse {
  store: Store;
  content: ContentService;
  renderer: TypstRenderer;
}

const MOUNTED = MOUNTED_COURSE;
/** What the mounted folder was called before it was a course like the others. */
const OLD_MOUNTED = 'mounted';
const COURSES_KEY = 'courses';
const ACTIVE_KEY = 'activeCourse';

/** A folder counts as a course once it has chapters, so an empty mount point is simply no course. */
function isCourse(dir: string): boolean {
  return fs.existsSync(dir) && loadContent(dir).outline.chapters.length > 0;
}

/** Public http(s) addresses only. A login inside the address would end up stored and shown in plain text. */
export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new CourseError('bad-url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CourseError('bad-url');
  if (url.username || url.password) throw new CourseError('has-credentials');
  return url.href.replace(/\/+$/, '');
}

/** What a plain folder looked like when copied: paths, sizes and times of its files, without `.git`. */
export function fingerprintOf(dir: string): string {
  const hash = crypto.createHash('sha1');
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(rel, e.name);
      if (e.name === '.git') continue;
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.lstatSync(path.join(dir, p));
        hash.update(`${p}\0${st.size}\0${Math.floor(st.mtimeMs)}\n`);
      }
    }
  };
  walk('');
  return hash.digest('hex');
}

/** Copies a plain folder, leaving out `.git` and every link: a link could lead out of the folder. */
function copyFolder(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true, filter: (src) => path.basename(src) !== '.git' && !fs.lstatSync(src).isSymbolicLink() });
}

function cheapTitle(dir: string): string | null {
  try {
    const title = (YAML.parse(fs.readFileSync(path.join(dir, 'workbook.yml'), 'utf8')) as { title?: unknown } | null)?.title;
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}

interface Options {
  config: Config;
  /** Directory holding the shipped Typst helpers. */
  typstAssets: string;
  /** Ends what still runs against the course being left. */
  onSwitch?: () => void;
  onLoad?: (title: string, c: Content) => void;
  /** Renders every text in the background after a course is loaded, so a first visit does not wait for Typst. */
  warm?: boolean;
}

/**
 * The courses of this student. Each has its own copy; all work is in one database, kept apart
 * by course because exercise ids of two courses may clash. A mounted folder is the course
 * `content`. Settings and the list of courses are the database's global values.
 */
export class CourseManager {
  /** Settings and the list of courses. */
  readonly global: Store;
  /** The student's decks. They belong to no course. */
  readonly flashcards: Flashcards;
  /** The student's uploaded files. They belong to no course either. */
  readonly resources: Resources;
  /** Backups of the one database and the uploaded files; the daily one is taken by whoever runs the app. */
  readonly snapshots: Snapshots;
  private deckRenderer: TypstRenderer | null = null;
  private readonly open = new Map<string, OpenCourse>();
  private readonly updates = new Map<string, CourseUpdate>();
  private readonly hasMount: boolean;
  private activeId: string | null;

  constructor(private readonly o: Options) {
    this.global = new Store(path.join(o.config.dataDir, 'workbook.db'));
    this.snapshots = new Snapshots(o.config.dataDir, this.global);
    this.resources = new Resources(this.global, o.config.dataDir, () => this.courseRefs());
    this.hasMount = isCourse(o.config.contentDir);
    this.importLegacy();
    // After startup has settled: reading the files' text is background work.
    setTimeout(() => this.resources.indexText(), 2000).unref();
    const known = this.ids();
    const stored = this.global.getValue<string | null>(ACTIVE_KEY, null);
    const saved = stored === OLD_MOUNTED ? MOUNTED : stored;
    this.activeId = saved && known.includes(saved) ? saved : (known[0] ?? null);
    this.flashcards = new Flashcards(this.global, () => this.decksRenderer(), {
      find: (ref) => {
        const found = this.findExercise(ref);
        return found ? { ref, ...found } : null;
      },
      findHighlight: (ref) => this.findHighlight(ref),
      courses: () => this.courseRefs(),
      language: () => {
        const ui = this.global.getSettings().uiLanguage;
        return ui !== 'auto' ? ui : (this.active?.content.current.outline.language ?? 'en');
      },
    });
    this.global.useCreators({
      create: (kind, payload) => this.createFromProposal(kind, payload),
      remove: (kind, made) => this.removeProposed(kind, made),
      gone: (kind, payload) => {
        if (kind === 'card') {
          const deck = (payload as CardPayload).deck;
          return 'id' in deck && !this.flashcards.has(deck.id);
        }
        return !this.resources.has((payload as HighlightPayload).resource);
      },
      cardDecks: (ids) => this.flashcards.cardDecks(ids),
    });
  }

  /** Accepting an assistant's proposal that makes a card (maybe in a new deck) or a note on a PDF page. Throws with a message for the student. */
  private createFromProposal(kind: 'card' | 'highlight', payload: CreatePayload): Created {
    if (kind === 'card') {
      const c = payload as CardPayload;
      let deckId: string;
      let madeDeck: string | undefined;
      if ('id' in c.deck) {
        if (!this.flashcards.has(c.deck.id)) throw new Error('that deck is gone');
        deckId = c.deck.id;
      } else {
        const title = c.deck.title.trim();
        const same = this.flashcards.deckByTitle(title);
        deckId = same ? same.id : (madeDeck = this.flashcards.create(title).id);
      }
      try {
        const saved = this.flashcards.addCard(deckId, c.cardKind, c.front, c.back, null, null, Array.isArray(c.tags) ? c.tags.filter((x) => typeof x === 'string') : [], null, c.anchor);
        return { id: saved.cardId, deck: madeDeck ? deckId : undefined } as Created;
      } catch (e) {
        if (madeDeck) this.flashcards.remove(madeDeck);
        throw e instanceof FlashcardError ? new Error('the card has unbalanced brackets') : e;
      }
    }
    const h = payload as HighlightPayload;
    const res = this.resources.get(h.resource);
    const prev = this.resources.listPages(h.resource).find((p) => p.pageIndex === h.pageIndex);
    const text = `„${h.quote.trim()}“${h.note.trim() ? `\n${h.note.trim()}` : ''}`;
    const item = this.resources.savePage(h.resource, h.pageIndex, {
      version: res.file.sha256,
      fingerprint: prev?.fingerprint ?? '',
      note: prev?.note ? `${prev.note}\n\n${text}` : text,
    });
    return { id: item.id, note: prev?.note ?? '' };
  }

  private removeProposed(kind: 'card' | 'highlight', made: Created): void {
    if (kind === 'card') {
      const d = this.flashcards.deckOf(made.id);
      if (!d) return;
      this.flashcards.deleteCard(d.id, made.id);
      if (made.deck === d.id && d.cards === 1) this.flashcards.remove(d.id);
      return;
    }
    const page = this.resources.getPage(made.id);
    if (page) this.resources.savePage(page.resource, page.pageIndex, { version: page.version, fingerprint: page.fingerprint, note: made.note ?? '' });
  }

  /** The student's courses by the id courses are referred to by (`workbook.yml`'s `id`), for decks and materials. */
  courseRefs(): { id: string; title: string }[] {
    return this.ids().map((id) => ({ id: this.openCourse(id).content.current.outline.id, title: this.openCourse(id).content.current.outline.title }));
  }

  /** The courses search looks in: those shown, with the `course` their work is stored under and their text. */
  searchScope(): { id: string; key: string; title: string; content: Content }[] {
    return this.ids().map((id) => {
      const content = this.openCourse(id).content.current;
      return { id, key: this.key(id), title: content.outline.title, content };
    });
  }

  /** The library's works a student's text cites by id, as the renderer wants them (the id is the key). */
  private libraryWorks(ids: string[]) {
    return this.resources.worksByIds(ids).map((w) => ({ key: w.id, file: '', title: w.title, authors: w.authors, year: w.year, venue: w.venue, doi: w.doi, url: w.url }));
  }

  /** Decks are compiled in a root of their own, with no course content to reach. */
  private decksRenderer(): TypstRenderer {
    if (!this.deckRenderer) {
      const dataDir = path.join(this.o.config.dataDir, 'flashcards');
      const contentDir = path.join(dataDir, 'no-content');
      fs.mkdirSync(contentDir, { recursive: true });
      this.deckRenderer = new TypstRenderer({ bin: this.o.config.typstBin, contentDir, dataDir, assetsDir: this.o.typstAssets, language: 'en' });
      this.deckRenderer.pdfRefs = (res, target) => this.pdfRef(res, target);
      this.deckRenderer.libraryWorks = (ids) => this.libraryWorks(ids);
    }
    return this.deckRenderer;
  }

  get active(): OpenCourse | null {
    return this.activeId ? this.openCourse(this.activeId) : null;
  }

  list(): CoursesResponse {
    const courses: CourseInfo[] = this.shown().map((r) => ({ id: r.id, title: r.title, source: r.local ? 'local' : 'git', url: r.local ? null : r.url, folder: r.local ?? null, update: this.updates.get(r.id) ?? 'unknown' }));
    if (this.hasMount) {
      const { title } = this.openCourse(MOUNTED).content.current.outline;
      courses.unshift({ id: MOUNTED, title, source: 'mounted', url: null, folder: null, update: 'unknown' });
    }
    return { courses, activeId: this.activeId };
  }

  activate(id: string): CoursesResponse {
    if (!this.ids().includes(id)) throw new CourseError('unknown-course');
    this.setActive(id);
    return this.list();
  }

  /**
   * Downloads a repository and opens it. Adding one that is already here just opens it, and adding one that was
   * removed brings it back with its work. A course is its address: the same course from another address is another
   * course (its work is kept under a key of its own).
   */
  async add(input: string | { local: string }): Promise<CoursesResponse> {
    const local = typeof input === 'string' ? null : this.localDir(input.local);
    const url = typeof input === 'string' ? normalizeUrl(input) : `local:${input.local}`;
    const id = `c-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
    const known = this.records().find((r) => r.id === id);
    if (known && !known.hidden) return this.activate(id);
    if (known && isCourse(this.repo(id))) {
      this.saveRecords(this.records().map((r) => (r.id === id ? { ...r, hidden: false } : r)));
      return this.activate(id);
    }

    const fingerprint = await this.download(local ?? url, id, !!local);
    const { outline } = loadContent(this.repo(id));
    const extra = typeof input === 'string' ? {} : { local: input.local, ...(fingerprint ? { fingerprint } : {}) };
    if (known) this.saveRecords(this.records().map((r) => (r.id === id ? { ...r, ...extra, title: outline.title, hidden: false } : r)));
    else this.saveRecords([...this.records(), { id, url, ...extra, title: outline.title, key: this.freeKey(outline.id) }]);
    this.updates.set(id, 'current');
    this.setActive(id);
    return this.list();
  }

  /**
   * A fresh copy at `repo(id)`, replacing whatever was there only once the download is a course. `from` is an
   * address, or a folder in the workbooks folder: a git repo there is cloned, a plain folder is copied and its
   * fingerprint returned.
   */
  private async download(from: string, id: string, folder = false): Promise<string | undefined> {
    const home = this.home(id);
    const tmp = `${home}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    let fingerprint: string | undefined;
    try {
      if (!folder) await git.clone(from, tmp);
      else if (fs.existsSync(path.join(from, '.git'))) await git.clone(pathToFileURL(from).href, tmp);
      else {
        fingerprint = fingerprintOf(from);
        copyFolder(from, tmp);
      }
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new CourseError(e instanceof git.GitError && e.missing ? 'git-missing' : 'clone-failed');
    }
    if (!isCourse(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new CourseError('not-a-course');
    }
    fs.mkdirSync(home, { recursive: true });
    fs.rmSync(this.repo(id), { recursive: true, force: true });
    fs.renameSync(tmp, this.repo(id));
    return fingerprint;
  }

  /** The folders of the workbooks folder that look like workbooks, for the add dialog. */
  listLocal(): LocalWorkbook[] {
    const root = this.o.config.workbooksDir;
    let names: string[];
    try {
      names = fs.readdirSync(root).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
    const added = new Set(this.shown().map((r) => r.local).filter(Boolean));
    const out: LocalWorkbook[] = [];
    for (const name of names) {
      let dir: string;
      try {
        dir = this.localDir(name);
      } catch {
        continue;
      }
      // Cheap: reading every workbook's content just to fill a list would be slow.
      if (!fs.existsSync(path.join(dir, 'chapters'))) continue;
      out.push({ name, title: cheapTitle(dir) ?? name, git: fs.existsSync(path.join(dir, '.git')), added: added.has(name) });
    }
    return out;
  }

  /** The folder behind a name in the workbooks folder; a name is one plain child that stays inside it after links are resolved. */
  private localDir(name: string): string {
    if (!name || name !== path.basename(name) || name.startsWith('.') || name.includes('\0')) throw new CourseError('not-a-course');
    try {
      const root = fs.realpathSync(this.o.config.workbooksDir);
      const dir = fs.realpathSync(path.join(root, name));
      if (path.dirname(dir) !== root || !fs.statSync(dir).isDirectory()) throw new Error('outside');
      return dir;
    } catch {
      throw new CourseError('not-a-course');
    }
  }

  /** Looks for news in every repository. Without a network the answer is simply "unknown". */
  async checkUpdates(): Promise<void> {
    await Promise.all(
      this.shown().map(async (r) => {
        const { id } = r;
        let update: CourseUpdate = 'unknown';
        try {
          if (r.local && r.fingerprint !== undefined) update = fingerprintOf(this.localDir(r.local)) === r.fingerprint ? 'current' : 'available';
          else {
            const remote = await git.remoteHead(this.repo(id));
            if (remote) update = remote === (await git.localHead(this.repo(id))) ? 'current' : 'available';
          }
        } catch {
          /* stays unknown */
        }
        this.updates.set(id, update);
      }),
    );
  }

  /** Answers and notes are stored by exercise id, so they stay even when an update removes their exercise. */
  async update(id: string): Promise<CoursesResponse> {
    if (id === MOUNTED) throw new CourseError('mounted');
    const record = this.shown().find((r) => r.id === id);
    if (!record) throw new CourseError('unknown-course');
    let fingerprint: string | undefined;
    try {
      if (record.local && record.fingerprint !== undefined) fingerprint = await this.download(this.localDir(record.local), id, true);
      else await git.pull(this.repo(id));
    } catch (e) {
      throw e instanceof CourseError && e.code === 'not-a-course' ? e : new CourseError('update-failed');
    }
    this.updates.set(id, 'current');
    this.open.get(id)?.content.reload();
    const title = loadContent(this.repo(id)).outline.title;
    this.saveRecords(this.records().map((r) => (r.id === id ? { ...r, title, ...(fingerprint ? { fingerprint } : {}) } : r)));
    return this.list();
  }

  /**
   * The only way to a fresh start in a course: deletes every row of its work and its copy. The mounted folder is not
   * ours to delete, so it stays as a course with no work.
   */
  deleteData(id: string): CoursesResponse {
    if (!this.ids().includes(id)) throw new CourseError('unknown-course');
    this.global.forCourse(this.key(id)).resetWork();
    if (id === MOUNTED) {
      // Whatever still runs was started with the old work.
      if (id === this.activeId) this.o.onSwitch?.();
      return this.list();
    }
    this.saveRecords(this.records().filter((r) => r.id !== id));
    this.leave(id);
    fs.rmSync(this.home(id), { recursive: true, force: true });
    return this.list();
  }

  /**
   * Starts over: the work in every course (removed ones too), all flashcards, and the settings. The courses
   * themselves stay downloaded.
   */
  resetAll(): CoursesResponse {
    // Removed courses too: their work is still here.
    for (const id of [...(this.hasMount ? [MOUNTED] : []), ...this.records().map((r) => r.id)]) this.global.forCourse(this.key(id)).resetWork();
    this.global.resetHighlights();
    this.flashcards.reset();
    this.resources.reset();
    this.global.resetSettings();
    this.o.onSwitch?.();
    return this.list();
  }

  /** Hides a course. Its copy and its work stay, so adding the same address again brings both back. */
  remove(id: string): CoursesResponse {
    if (id === MOUNTED) throw new CourseError('mounted');
    if (!this.shown().some((r) => r.id === id)) throw new CourseError('unknown-course');
    this.key(id); // settled while the copy is surely here
    this.saveRecords(this.records().map((r) => (r.id === id ? { ...r, hidden: true } : r)));
    this.leave(id);
    return this.list();
  }

  /** After a course left the list: another one opens, and nothing of it stays loaded. */
  private leave(id: string): void {
    if (this.activeId === id) {
      const [next] = this.ids();
      if (next) this.setActive(next);
      else this.clearActive();
    }
    this.open.get(id)?.renderer.stopWarming();
    this.open.delete(id);
    this.updates.delete(id);
  }

  /**
   * What a flashcard's `from: "course/exercise"` points at, in any of this student's
   * courses. Courses are named by their stable `id`, so a deck works across machines.
   */
  findExercise(ref: string): ExerciseRef | null {
    const slash = ref.indexOf('/');
    if (slash <= 0) return null;
    const course = ref.slice(0, slash);
    const itemId = ref.slice(slash + 1);
    for (const id of this.ids()) {
      const c = this.openCourse(id).content.current;
      if (c.outline.id !== course) continue;
      const item = c.get(itemId);
      if (!item) continue;
      return {
        title: item.meta.title,
        courseTitle: c.outline.title,
        language: item.codeLanguage,
        href: id === this.activeId ? `#/item/${itemId}` : null,
        course,
        chapterId: item.meta.chapterId,
        tags: 'tags' in item.meta ? item.meta.tags : [],
        courseTags: c.outline.tags.map((t) => ({ id: t.id, label: t.label })),
        exams: c.outline.exams,
      };
    }
    return null;
  }

  /** What a `#pdf-ref` points at: the material and, for a highlight or a page, its page (1-based); undefined if either is gone. */
  pdfRef(resource: string, target: string | null): { title: string; page: number | null } | undefined {
    let title: string;
    try {
      title = this.resources.get(resource).title;
    } catch {
      return undefined;
    }
    if (!target) return { title, page: null };
    const h = this.resources.getHighlight(target);
    if (h) return h.resource === resource ? { title, page: h.pageIndex + 1 } : undefined;
    const p = this.resources.getPage(target);
    return p && p.resource === resource ? { title, page: p.pageIndex + 1 } : undefined;
  }

  /** What a card's `highlight: "course/<annotation id>"` points at; null once the highlight is gone. */
  findHighlight(ref: string): CardHighlight | null {
    const slash = ref.indexOf('/');
    if (slash <= 0) return null;
    const course = ref.slice(0, slash);
    const annotationId = ref.slice(slash + 1);
    for (const id of this.ids()) {
      const open = this.openCourse(id);
      if (open.content.current.outline.id !== course) continue;
      // Two courses may share an id; the annotation's own id is unique.
      const a = open.store.getAnnotation(annotationId);
      if (!a) continue;
      return { id: a.id, quote: a.quote, courseTitle: open.content.current.outline.title, href: id === this.activeId ? `#${targetHref(a.target)}` : null };
    }
    return null;
  }

  /** How a card made from a highlight in the open course names it. */
  highlightRef(annotationId: string): string | null {
    const course = this.active;
    return course && course.store.getAnnotation(annotationId) ? `${course.content.current.outline.id}/${annotationId}` : null;
  }

  /** How a card made in the open course names the exercise it came from. */
  exerciseRef(itemId: string): string | null {
    const course = this.active;
    return course ? `${course.content.current.outline.id}/${itemId}` : null;
  }

  /**
   * Puts all student data back as it was in a snapshot (after taking one of how it is now) and starts over from it:
   * the course list, the open course and everything loaded come from the restored database. A course in it whose
   * copy is gone since counts as removed, so adding it again downloads it with that work.
   */
  async restoreSnapshot(id: string): Promise<CoursesResponse> {
    if (!this.snapshots.list().some((s) => s.id === id)) throw new CourseError('unknown-snapshot');
    await this.snapshots.restore(id);
    for (const c of this.open.values()) c.renderer.stopWarming();
    this.open.clear();
    this.updates.clear();
    this.saveRecords(this.records().map((r) => (r.hidden || isCourse(this.repo(r.id)) ? r : { ...r, hidden: true })));
    const known = this.ids();
    const saved = this.global.getValue<string | null>(ACTIVE_KEY, null);
    this.activeId = saved && known.includes(saved) ? saved : (known[0] ?? null);
    this.global.setValue(ACTIVE_KEY, this.activeId);
    this.o.onSwitch?.();
    void this.active;
    this.resources.indexText();
    return this.list();
  }

  close(): void {
    for (const c of this.open.values()) c.renderer.stopWarming();
    this.open.clear();
    this.global.close();
  }

  /** A key for a new course's work that no other course has. */
  private freeKey(base: string, records = this.records()): string {
    const taken = new Set([MOUNTED, ...records.map((r) => r.key).filter((k): k is string => !!k)]);
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
    return key;
  }

  /** The `course` a course's work is stored under. */
  private key(id: string): string {
    if (id === MOUNTED) return MOUNTED;
    const records = this.records();
    const record = records.find((r) => r.id === id);
    if (!record) throw new CourseError('unknown-course');
    if (record.key) return record.key;
    record.key = this.freeKey(loadContent(this.repo(id)).outline.id, records);
    this.saveRecords(records);
    return record.key;
  }

  /**
   * Once: the work in the per-course database files of earlier versions moves into the one database. The mounted
   * folder's work was in the main file already and is moved by its migration. A file that cannot be imported
   * stays as it is; the old files are renamed, never deleted.
   */
  private importLegacy(): void {
    if (this.global.getValue<boolean>('importedLegacy', false)) return;
    for (const { id } of this.records()) {
      const file = path.join(this.home(id), 'workbook.db');
      if (!fs.existsSync(file)) continue;
      try {
        this.global.forCourse(this.key(id)).importLegacy(file);
        fs.rmSync(`${file}-shm`, { force: true });
        for (const p of ['-wal', '']) if (fs.existsSync(file + p)) fs.renameSync(file + p, `${file}.imported${p}`);
      } catch (e) {
        console.error(`Could not import the work in ${file}; it stays where it is.`, e);
      }
    }
    this.global.setValue('importedLegacy', true);
  }

  private ids(): string[] {
    return [...(this.hasMount ? [MOUNTED] : []), ...this.shown().map((r) => r.id)];
  }

  /** The courses in the list; `records()` also has the removed ones, whose keys stay taken. */
  private shown(): CourseRecord[] {
    return this.records().filter((r) => !r.hidden);
  }

  private records(): CourseRecord[] {
    return this.global.getValue<CourseRecord[]>(COURSES_KEY, []);
  }

  private saveRecords(records: CourseRecord[]): void {
    this.global.setValue(COURSES_KEY, records);
  }

  private setActive(id: string): void {
    const changed = id !== this.activeId;
    this.activeId = id;
    this.global.setValue(ACTIVE_KEY, id);
    if (changed) this.o.onSwitch?.();
  }

  private clearActive(): void {
    this.activeId = null;
    this.global.setValue(ACTIVE_KEY, null);
    this.o.onSwitch?.();
  }

  private home(id: string): string {
    return path.join(this.o.config.dataDir, 'courses', id);
  }

  private repo(id: string): string {
    return path.join(this.home(id), 'repo');
  }

  private openCourse(id: string): OpenCourse {
    const existing = this.open.get(id);
    if (existing) return existing;
    const mounted = id === MOUNTED;
    const contentDir = mounted ? this.o.config.contentDir : this.repo(id);
    const dataDir = mounted ? this.o.config.dataDir : this.home(id);
    const renderer = new TypstRenderer({ bin: this.o.config.typstBin, contentDir, dataDir, assetsDir: this.o.typstAssets, language: 'en' });
    renderer.pdfRefs = (res, target) => this.pdfRef(res, target);
    renderer.libraryWorks = (ids) => this.libraryWorks(ids);
    const content = new ContentService(contentDir, (c) => {
      renderer.titles = (itemId) => c.get(itemId)?.meta.title;
      renderer.language = c.outline.language;
      // On start, after adding or updating, and when an author edits: what is in the cache already is skipped.
      if (this.o.warm) renderer.warm([...c.allDocs(), ...c.all()]);
      this.o.onLoad?.(c.outline.title, c);
    });
    const store = this.global.forCourse(this.key(id));
    const course = { store, content, renderer };
    this.open.set(id, course);
    return course;
  }
}
