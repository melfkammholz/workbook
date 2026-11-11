import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { targetHref, type CardHighlight, type CourseErrorCode, type CourseInfo, type CoursesResponse, type CourseUpdate } from '@wb/shared';
import type { Config } from '../config.js';
import { loadContent, type Content } from '../content/loader.js';
import { ContentService } from '../content/service.js';
import { TypstRenderer } from '../content/typst.js';
import { Store } from '../db/store.js';
import { Flashcards } from '../flashcards/service.js';
import * as git from './git.js';

export class CourseError extends Error {
  constructor(readonly code: CourseErrorCode) {
    super(code);
  }
}

/** A course the student added. What a mounted folder needs is known from the config. */
interface CourseRecord {
  id: string;
  url: string;
  title: string;
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

const MOUNTED = 'mounted';
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

interface Options {
  config: Config;
  /** Directory holding the shipped Typst helpers. */
  typstAssets: string;
  /** Ends what still runs against the course being left. */
  onSwitch?: () => void;
  onLoad?: (title: string, c: Content) => void;
}

/**
 * The courses of this student. Each has its own copy and its own database, because
 * exercise ids of two courses may clash. Settings and the list of courses live in
 * the main database, which also holds the work done in a mounted folder.
 */
export class CourseManager {
  /** Settings and the list of courses. */
  readonly global: Store;
  /** The student's decks. They belong to no course. */
  readonly flashcards: Flashcards;
  private deckRenderer: TypstRenderer | null = null;
  private readonly open = new Map<string, OpenCourse>();
  private readonly updates = new Map<string, CourseUpdate>();
  private readonly hasMount: boolean;
  private activeId: string | null;

  constructor(private readonly o: Options) {
    this.global = new Store(path.join(o.config.dataDir, 'workbook.db'));
    this.hasMount = isCourse(o.config.contentDir);
    const known = this.ids();
    const saved = this.global.getValue<string | null>(ACTIVE_KEY, null);
    this.activeId = saved && known.includes(saved) ? saved : (known[0] ?? null);
    this.flashcards = new Flashcards(this.global, () => this.decksRenderer(), {
      find: (ref) => {
        const found = this.findExercise(ref);
        return found ? { ref, ...found } : null;
      },
      findHighlight: (ref) => this.findHighlight(ref),
      courses: () => this.ids().map((id) => ({ id: this.openCourse(id).content.current.outline.id, title: this.openCourse(id).content.current.outline.title })),
      language: () => {
        const ui = this.global.getSettings().uiLanguage;
        return ui !== 'auto' ? ui : (this.active?.content.current.outline.language ?? 'en');
      },
    });
  }

  /** Decks are compiled in a root of their own, with no course content to reach. */
  private decksRenderer(): TypstRenderer {
    if (!this.deckRenderer) {
      const dataDir = path.join(this.o.config.dataDir, 'flashcards');
      const contentDir = path.join(dataDir, 'no-content');
      fs.mkdirSync(contentDir, { recursive: true });
      this.deckRenderer = new TypstRenderer({ bin: this.o.config.typstBin, contentDir, dataDir, assetsDir: this.o.typstAssets, language: 'en' });
    }
    return this.deckRenderer;
  }

  get active(): OpenCourse | null {
    return this.activeId ? this.openCourse(this.activeId) : null;
  }

  list(): CoursesResponse {
    const courses: CourseInfo[] = this.records().map((r) => ({ id: r.id, title: r.title, source: 'git', url: r.url, update: this.updates.get(r.id) ?? 'unknown' }));
    if (this.hasMount) {
      const { title } = this.openCourse(MOUNTED).content.current.outline;
      courses.unshift({ id: MOUNTED, title, source: 'mounted', url: null, update: 'unknown' });
    }
    return { courses, activeId: this.activeId };
  }

  activate(id: string): CoursesResponse {
    if (!this.ids().includes(id)) throw new CourseError('unknown-course');
    this.setActive(id);
    return this.list();
  }

  /** Downloads a repository and opens it. Adding one that is already here just opens it. */
  async add(input: string): Promise<CoursesResponse> {
    const url = normalizeUrl(input);
    const id = `c-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
    if (this.records().some((r) => r.id === id)) return this.activate(id);

    const home = this.home(id);
    const tmp = `${home}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await git.clone(url, tmp);
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new CourseError(e instanceof git.GitError && e.missing ? 'git-missing' : 'clone-failed');
    }
    if (!isCourse(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new CourseError('not-a-course');
    }
    fs.mkdirSync(home, { recursive: true });
    fs.renameSync(tmp, this.repo(id));

    this.saveRecords([...this.records(), { id, url, title: loadContent(this.repo(id)).outline.title }]);
    this.updates.set(id, 'current');
    this.setActive(id);
    return this.list();
  }

  /** Looks for news in every repository. Without a network the answer is simply "unknown". */
  async checkUpdates(): Promise<void> {
    await Promise.all(
      this.records().map(async ({ id }) => {
        let update: CourseUpdate = 'unknown';
        try {
          const remote = await git.remoteHead(this.repo(id));
          if (remote) update = remote === (await git.localHead(this.repo(id))) ? 'current' : 'available';
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
    if (!this.records().some((r) => r.id === id)) throw new CourseError('unknown-course');
    try {
      await git.pull(this.repo(id));
    } catch {
      throw new CourseError('update-failed');
    }
    this.updates.set(id, 'current');
    this.open.get(id)?.content.reload();
    const title = loadContent(this.repo(id)).outline.title;
    this.saveRecords(this.records().map((r) => (r.id === id ? { ...r, title } : r)));
    return this.list();
  }

  /** Forgets the work done in a course. The course itself stays. */
  reset(id: string): CoursesResponse {
    if (!this.ids().includes(id)) throw new CourseError('unknown-course');
    this.openCourse(id).store.resetWork();
    // Whatever still runs was started with the old work.
    if (id === this.activeId) this.o.onSwitch?.();
    return this.list();
  }

  /**
   * Starts over: the work in every course, all flashcards, and the settings. The courses
   * themselves stay downloaded.
   */
  resetAll(): CoursesResponse {
    for (const id of this.ids()) this.openCourse(id).store.resetWork();
    this.flashcards.reset();
    this.global.resetSettings();
    this.o.onSwitch?.();
    return this.list();
  }

  /** Deletes the copy and the work done in it. */
  async remove(id: string): Promise<CoursesResponse> {
    if (id === MOUNTED) throw new CourseError('mounted');
    if (!this.records().some((r) => r.id === id)) throw new CourseError('unknown-course');
    this.saveRecords(this.records().filter((r) => r.id !== id));
    if (this.activeId === id) {
      const [next] = this.ids();
      if (next) this.setActive(next);
      else this.clearActive();
    }
    this.open.get(id)?.store.close();
    this.open.delete(id);
    this.updates.delete(id);
    fs.rmSync(this.home(id), { recursive: true, force: true });
    return this.list();
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

  /** What a card's `highlight: "course/<annotation id>"` points at; null once the highlight is gone. */
  findHighlight(ref: string): CardHighlight | null {
    const slash = ref.indexOf('/');
    if (slash <= 0) return null;
    const course = ref.slice(0, slash);
    const annotationId = ref.slice(slash + 1);
    for (const id of this.ids()) {
      const open = this.openCourse(id);
      if (open.content.current.outline.id !== course) continue;
      const a = open.store.getAnnotation(annotationId);
      if (!a) return null;
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

  close(): void {
    for (const c of this.open.values()) if (c.store !== this.global) c.store.close();
    this.open.clear();
    this.global.close();
  }

  private ids(): string[] {
    return [...(this.hasMount ? [MOUNTED] : []), ...this.records().map((r) => r.id)];
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
    const content = new ContentService(contentDir, (c) => {
      renderer.titles = (itemId) => c.get(itemId)?.meta.title;
      renderer.language = c.outline.language;
      this.o.onLoad?.(c.outline.title, c);
    });
    const store = mounted ? this.global : new Store(path.join(dataDir, 'workbook.db'));
    const course = { store, content, renderer };
    this.open.set(id, course);
    return course;
  }
}
