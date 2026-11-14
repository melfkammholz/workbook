import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkEdit, WorkState, WorkFields, ImportCandidate, ImportChoice, ImportPreview, BibEntry, BibEntryInput, LibraryWork, SimilarWork, Work, Anchor, Placed, Reanchored, StaleItems, UnplacedItems, AnnotationColor, AnnotationReview, NewPdfAnnotation, PageRect, PdfAnnotation, PdfPageFields, PdfPageItem, Resource, TocEdit, TocEditFields, ResourceFields, ResourceSeries, ResourcesResponse, ResourceType } from '@wb/shared';
import { WORK_STATES, MIN_CONFIDENCE, MAX_TOC_LEVEL, MAX_TOC_TITLE, MAX_ENTRY_TEXT, normalizeTitle, workFields, fieldsConfidence, workKeys } from '@wb/shared';
import type { Store } from '../db/store.js';
import { crossrefByDoi, crossrefLookup, LOOKUP_PAUSE_MS, type FetchFn } from './crossref.js';
import { parseBibText, type ImportedWork } from './bibimport.js';
import { extractPdfText } from './text.js';

export class ResourceError extends Error {
  constructor(readonly code: 'unknown-resource' | 'unknown-series' | 'unknown-item' | 'same-file' | 'page-taken' | 'no-file' | 'bad-merge') {
    super(code);
  }
}

/** What a stored file is sent as. Anything else (HTML and SVG above all) is a download, never shown by the app's origin. */
const SAFE_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export function mimeOf(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return SAFE_MIME[ext] ?? 'application/octet-stream';
}

type UnplacedKind = 'highlight' | 'page' | 'toc' | 'question';
const TABLES: Record<UnplacedKind, string> = { highlight: 'pdf_annotations', page: 'pdf_pages', toc: 'pdf_toc', question: 'questions' };
/** A question asked on a page of the resource; the resource id is the parameter. */
const ON_RESOURCE = "json_extract(anchor, '$.kind') = 'page' AND json_extract(anchor, '$.resource') = ?";

const COLUMNS = `r.id, r.title, r.type, r.author, r.date, r.series, r.position, r.last_page, r.created_at, r.updated_at,
  v.sha256, v.filename, v.mime, v.size, v.uploaded_at,
  (SELECT group_concat(course, char(31)) FROM resource_courses WHERE resource = r.id) AS courses,
  (SELECT group_concat(tag_id, char(31)) FROM tag_links WHERE kind = 'resource' AND ref = r.id) AS labels,
  (SELECT COUNT(*) FROM resource_versions WHERE resource = r.id) AS versions,
  (SELECT COUNT(*) FROM pdf_annotations WHERE resource = r.id AND version <> v.sha256)
    + (SELECT COUNT(*) FROM pdf_pages WHERE resource = r.id AND version <> v.sha256)
    + (SELECT COUNT(*) FROM pdf_toc WHERE resource = r.id AND embedded_key IS NULL AND version <> v.sha256)
    + (SELECT COUNT(*) FROM questions WHERE json_extract(anchor, '$.kind') = 'page' AND json_extract(anchor, '$.resource') = r.id AND json_extract(anchor, '$.version') <> v.sha256) AS stale,
  (SELECT COUNT(*) FROM pdf_annotations WHERE resource = r.id AND unplaced = 1)
    + (SELECT COUNT(*) FROM pdf_pages WHERE resource = r.id AND unplaced = 1)
    + (SELECT COUNT(*) FROM pdf_toc WHERE resource = r.id AND unplaced = 1)
    + (SELECT COUNT(*) FROM questions WHERE json_extract(anchor, '$.kind') = 'page' AND json_extract(anchor, '$.resource') = r.id AND unplaced = 1) AS unplaced`;

type Row = Record<string, unknown>;

function toResource(r: Row): Resource {
  return {
    id: r.id as string,
    title: r.title as string,
    type: r.type as ResourceType,
    author: r.author as string,
    date: r.date as string,
    series: (r.series as string | null) ?? null,
    position: Number(r.position),
    lastPage: r.last_page === null ? null : Number(r.last_page),
    courses: r.courses ? (r.courses as string).split('\x1f').sort() : [],
    labels: r.labels ? (r.labels as string).split('\x1f') : [],
    file: { sha256: r.sha256 as string, filename: r.filename as string, mime: r.mime as string, size: Number(r.size), uploadedAt: Number(r.uploaded_at) },
    versions: Number(r.versions),
    stale: Number(r.stale),
    unplaced: Number(r.unplaced),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

const lookupKey = (raw: string) => crypto.createHash('sha256').update(normalizeTitle(raw)).digest('hex');

function toWork(r: Row): Work {
  const stored = r.confidence === undefined || r.confidence === null ? -1 : Number(r.confidence);
  return {
    id: r.id as string,
    title: r.title as string,
    authors: r.authors as string,
    year: r.year === null ? null : Number(r.year),
    venue: r.venue as string,
    doi: r.doi as string,
    url: r.url as string,
    raw: r.raw as string,
    volume: (r.volume as string) ?? '',
    pages: (r.pages as string) ?? '',
    arxiv: (r.arxiv as string) ?? '',
    edited: Number(r.edited) === 1,
    state: WORK_STATES.find((x) => x === r.state) ?? null,
    resource: (r.resource as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    source: r.source === 'crossref' ? 'crossref' : '',
    confidence: stored >= 0 ? stored : Number(r.imported) === 1 ? 1 : fieldsConfidence({ title: r.title as string, authors: r.authors as string, year: r.year === null ? null : Number(r.year), venue: r.venue as string, doi: r.doi as string, url: r.url as string }),
  };
}

function toToc(r: Row): TocEdit {
  return {
    id: r.id as string,
    resource: r.resource as string,
    version: r.version as string,
    pageIndex: Number(r.page_index),
    fingerprint: r.fingerprint as string,
    title: r.title as string,
    level: r.level === null ? null : Number(r.level),
    hidden: Number(r.hidden) === 1,
    embeddedKey: (r.embedded_key as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toPage(r: Row, reviews: Map<string, AnnotationReview>, marks: string[]): PdfPageItem {
  return {
    id: r.id as string,
    resource: r.resource as string,
    version: r.version as string,
    pageIndex: Number(r.page_index),
    fingerprint: r.fingerprint as string,
    note: r.note as string,
    marks,
    review: reviews.get(r.id as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toHighlight(r: Row, reviews: Map<string, AnnotationReview>, tags: string[]): PdfAnnotation {
  return {
    id: r.id as string,
    resource: r.resource as string,
    version: r.version as string,
    pageIndex: Number(r.page_index),
    rects: JSON.parse(r.rects as string) as PageRect[],
    quote: r.quote as string,
    prefix: r.prefix as string,
    suffix: r.suffix as string,
    color: r.color as AnnotationColor,
    tags,
    comment: r.comment as string,
    review: reviews.get(r.id as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/**
 * The student's materials: files with a title, type, author, date, courses and series. They belong to the student, not
 * to a course. The files are `<data>/files/<sha256>`, so the same file uploaded twice is stored once.
 */
export class Resources {
  readonly filesDir: string;

  constructor(
    private readonly store: Store,
    dataDir: string,
    private readonly courses: () => { id: string; title: string }[] = () => [],
    private readonly now: () => number = Date.now,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly lookupPause = LOOKUP_PAUSE_MS,
  ) {
    this.filesDir = path.join(dataDir, 'files');
  }

  private get sql() {
    return this.store.sql;
  }

  /** Every resource (of one course, if given) and every series, in one query each. */
  list(course?: string): ResourcesResponse {
    const rows = course
      ? this.sql.all(
          `SELECT ${COLUMNS} FROM resource_courses c JOIN resources r ON r.id = c.resource JOIN resource_versions v ON v.id = r.current_version
           WHERE c.course = ? ORDER BY r.series, r.position, r.created_at`,
          course,
        )
      : this.sql.all(`SELECT ${COLUMNS} FROM resources r JOIN resource_versions v ON v.id = r.current_version ORDER BY r.series, r.position, r.created_at`);
    const resources = rows.map(toResource);
    const used = new Set(resources.map((r) => r.series).filter((s): s is string => !!s));
    const series = (this.sql.all('SELECT id, title, type FROM resource_series ORDER BY title') as unknown as ResourceSeries[]).filter((s) => !course || used.has(s.id));
    return { resources, series, courses: this.courses() };
  }

  get(id: string): Resource {
    const row = this.sql.get(`SELECT ${COLUMNS} FROM resources r JOIN resource_versions v ON v.id = r.current_version WHERE r.id = ?`, id);
    if (!row) throw new ResourceError('unknown-resource');
    return toResource(row);
  }

  has(id: string): boolean {
    return this.sql.get('SELECT 1 FROM resources WHERE id = ?', id) !== undefined;
  }

  /** The path of a stored file, or null if the hash is not a hash or the file is gone. */
  filePath(sha256: string): string | null {
    if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
    const file = path.join(this.filesDir, sha256);
    return fs.existsSync(file) ? file : null;
  }

  /** A new resource from a file that is already stored. Several in one series go in order. */
  create(fields: ResourceFields, file: { sha256: string; filename: string; size: number }): Resource {
    const id = `r-${crypto.randomBytes(5).toString('hex')}`;
    const now = this.now();
    this.sql.tx(() => {
      const series = this.seriesFor(fields);
      const position = series ? Number(this.sql.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM resources WHERE series = ?', series)!.p) : 0;
      this.sql.run(
        'INSERT INTO resources (id, title, type, author, date, series, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        id, fields.title, fields.type, fields.author, fields.date, series, position, now, now,
      );
      this.sql.run('INSERT INTO resource_versions (resource, sha256, filename, mime, size, uploaded_at) VALUES (?,?,?,?,?,?)', id, file.sha256, file.filename, mimeOf(file.filename), file.size, now);
      const version = Number(this.sql.get('SELECT last_insert_rowid() AS id')!.id);
      this.sql.run('UPDATE resources SET current_version = ? WHERE id = ?', version, id);
      this.setCourses(id, fields.courses);
      this.setLabels(id, fields.labels);
    });
    this.indexText();
    return this.get(id);
  }

  update(id: string, fields: ResourceFields): Resource {
    const before = this.get(id);
    this.sql.tx(() => {
      const series = this.seriesFor(fields);
      const position = series === before.series ? before.position : series ? Number(this.sql.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM resources WHERE series = ?', series)!.p) : 0;
      this.sql.run('UPDATE resources SET title = ?, type = ?, author = ?, date = ?, series = ?, position = ?, updated_at = ? WHERE id = ?', fields.title, fields.type, fields.author, fields.date, series, position, this.now(), id);
      this.setCourses(id, fields.courses);
      this.setLabels(id, fields.labels);
      this.dropEmptySeries();
    });
    return this.get(id);
  }

  /** Removes the resource, and its file unless another resource uses the same one. */
  delete(id: string): void {
    this.get(id);
    const shas = (this.sql.all('SELECT DISTINCT sha256 FROM resource_versions WHERE resource = ?', id) as { sha256: string }[]).map((x) => x.sha256);
    this.sql.tx(() => {
      for (const p of this.sql.all('SELECT id FROM pdf_pages WHERE resource = ?', id)) this.store.unlinkAll('pdfPage', p.id as string);
      for (const p of this.sql.all('SELECT id FROM pdf_annotations WHERE resource = ?', id)) this.store.unlinkAll('pdfHighlight', p.id as string);
      this.sql.run('DELETE FROM resources WHERE id = ?', id);
      this.store.unlinkAll('resource', id);
      // Like its highlights, the questions asked about it go with it.
      this.sql.run("DELETE FROM questions WHERE json_extract(anchor, '$.resource') = ?", id);
      this.dropEmptySeries();
    });
    for (const sha of shas) this.removeIfUnused(sha);
  }

  // ───────────────────────── text of the files, for search ─────────────────────────

  private extracting = false;
  private again = false;

  /**
   * Reads the text of every PDF in use that has not been read yet, one file at a time in the background. A file that
   * cannot be parsed is marked and not tried again. Safe to call at any time: a run in progress picks up new files.
   */
  indexText(): void {
    if (this.extracting) {
      this.again = true;
      return;
    }
    this.extracting = true;
    void (async () => {
      try {
        for (;;) {
          const next = this.sql.get(
            `SELECT r.id, v.sha256, v.mime FROM resources r JOIN resource_versions v ON v.id = r.current_version
             WHERE NOT EXISTS (SELECT 1 FROM resource_text_state s WHERE s.resource = r.id AND s.version = v.sha256) ORDER BY r.created_at LIMIT 1`,
          );
          if (!next) {
            // Something may have arrived while the last file was read.
            if (!this.again) return;
            this.again = false;
            continue;
          }
          await this.extractOne(next.id as string, next.sha256 as string, next.mime === 'application/pdf');
        }
      } catch (e) {
        console.error('Reading the text of the materials stopped.', e);
      } finally {
        this.extracting = false;
      }
    })();
  }

  private async extractOne(id: string, sha: string, pdf: boolean): Promise<void> {
    let pages: string[] | null = null;
    const file = pdf ? this.filePath(sha) : null;
    if (file) {
      try {
        pages = await extractPdfText(file);
      } catch (e) {
        console.error(`Could not read the text of a material (${id}); it is not searched.`, e instanceof Error ? e.message : e);
        pages = null;
      }
    }
    try {
      this.sql.tx(() => {
        // The resource may be gone or have a new file by now.
        const cur = this.sql.get('SELECT v.sha256 FROM resources r JOIN resource_versions v ON v.id = r.current_version WHERE r.id = ?', id);
        if (cur?.sha256 !== sha) return;
        pages?.forEach((text, i) => text && this.sql.run('INSERT OR REPLACE INTO resource_text (resource, version, page_index, text) VALUES (?,?,?,?)', id, sha, i, text));
        this.sql.run('INSERT OR REPLACE INTO resource_text_state (resource, version, status) VALUES (?,?,?)', id, sha, pages ? 'done' : 'failed');
      });
    } catch {
      // Deleted while it was read.
    }
  }

  /** The resources the student can see: those of no course and those of a course that is shown. */
  visibleIds(courseIds: string[]): Set<string> {
    const shown = new Set(courseIds);
    const ids = new Set((this.sql.all('SELECT id FROM resources') as { id: string }[]).map((r) => r.id));
    const linked = new Map<string, boolean>();
    for (const r of this.sql.all('SELECT resource, course FROM resource_courses') as { resource: string; course: string }[]) linked.set(r.resource, (linked.get(r.resource) ?? false) || shown.has(r.course));
    for (const [id, any] of linked) if (!any) ids.delete(id);
    return ids;
  }

  /** The viewer remembers where the student was. */
  setLastPage(id: string, page: number): void {
    this.get(id);
    this.sql.run('UPDATE resources SET last_page = ? WHERE id = ?', page, id);
  }

  // ───────────────────────── highlights in PDFs ─────────────────────────

  /** Every highlight of one resource, or of all of them, in the order they are on the page. */
  listHighlights(resource?: string): PdfAnnotation[] {
    const rows = resource
      ? this.sql.all('SELECT * FROM pdf_annotations WHERE resource = ? AND unplaced = 0 ORDER BY page_index, created_at, id', resource)
      : this.sql.all('SELECT * FROM pdf_annotations WHERE unplaced = 0 ORDER BY resource, page_index, created_at, id');
    const reviews = this.store.reviews();
    const tags = this.store.tagLinks('pdfHighlight');
    return rows.map((r) => toHighlight(r, reviews, tags.get(r.id as string) ?? []));
  }

  getHighlight(id: string): PdfAnnotation | null {
    const r = this.sql.get('SELECT * FROM pdf_annotations WHERE id = ?', id);
    return r ? toHighlight(r, this.store.reviews(), this.store.tagsOf('pdfHighlight', id)) : null;
  }

  addHighlight(resource: string, a: NewPdfAnnotation): PdfAnnotation {
    this.get(resource);
    const id = a.id ?? crypto.randomUUID();
    const t = this.now();
    this.sql.tx(() => {
      this.sql.run(
        'INSERT INTO pdf_annotations (id, resource, version, page_index, rects, quote, prefix, suffix, color, comment, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        id, resource, a.version, a.pageIndex, JSON.stringify(a.rects), a.quote, a.prefix, a.suffix, a.color, (a.comment ?? '').slice(0, 4000), t, t,
      );
      if (a.tags?.length) this.store.setTags('pdfHighlight', id, a.tags);
      if (a.review) this.store.setReview(id, a.review, this.highlightAnchor(id));
    });
    return this.getHighlight(id)!;
  }

  updateHighlight(id: string, patch: { color?: AnnotationColor; tags?: string[]; comment?: string; review?: AnnotationReview | null }): PdfAnnotation | null {
    const prev = this.getHighlight(id);
    if (!prev) return null;
    const next = { ...prev, ...patch };
    this.sql.tx(() => {
      this.sql.run('UPDATE pdf_annotations SET color = ?, comment = ?, updated_at = ? WHERE id = ?', next.color, next.comment.slice(0, 4000), this.now(), id);
      if (patch.tags) this.store.setTags('pdfHighlight', id, patch.tags);
      if (patch.review !== undefined) this.store.setReview(id, patch.review, this.highlightAnchor(id));
    });
    return this.getHighlight(id);
  }

  /** Where a highlight's come-back question is asked: its page and passage. The page's fingerprint is only known if the page has an item. */
  private highlightAnchor(id: string): Anchor {
    const a = this.sql.get('SELECT * FROM pdf_annotations WHERE id = ?', id)!;
    const page = this.sql.get('SELECT fingerprint FROM pdf_pages WHERE resource = ? AND page_index = ? AND unplaced = 0', a.resource as string, Number(a.page_index));
    return {
      kind: 'page',
      resource: a.resource as string,
      version: a.version as string,
      pageIndex: Number(a.page_index),
      fingerprint: (page?.fingerprint as string | undefined) ?? '',
      rects: JSON.parse(a.rects as string) as PageRect[],
      quote: a.quote as string,
      prefix: a.prefix as string,
      suffix: a.suffix as string,
    };
  }

  private pageAnchor(id: string): Anchor {
    const p = this.sql.get('SELECT resource, version, page_index, fingerprint FROM pdf_pages WHERE id = ?', id)!;
    return { kind: 'page', resource: p.resource as string, version: p.version as string, pageIndex: Number(p.page_index), fingerprint: p.fingerprint as string };
  }

  deleteHighlight(id: string): boolean {
    if (!this.getHighlight(id)) return false;
    this.sql.run('DELETE FROM pdf_annotations WHERE id = ?', id);
    this.store.unlinkAll('pdfHighlight', id);
    return true;
  }

  // ───────────────────────── notes on pages ─────────────────────────

  /** Every page item of one resource, or of all of them. */
  listPages(resource?: string): PdfPageItem[] {
    const rows = resource ? this.sql.all('SELECT * FROM pdf_pages WHERE resource = ? AND unplaced = 0 ORDER BY page_index', resource) : this.sql.all('SELECT * FROM pdf_pages WHERE unplaced = 0 ORDER BY resource, page_index');
    const reviews = this.store.reviews();
    const marks = this.store.tagLinks('pdfPage');
    return rows.map((r) => toPage(r, reviews, marks.get(r.id as string) ?? []));
  }

  getPage(id: string): PdfPageItem | null {
    const r = this.sql.get('SELECT * FROM pdf_pages WHERE id = ?', id);
    return r ? toPage(r, this.store.reviews(), this.store.tagsOf('pdfPage', r.id as string)) : null;
  }

  /**
   * Makes the page's item or changes it: what is given replaces what was there, the rest stays. `id` is only used when
   * the item is new.
   */
  savePage(resource: string, pageIndex: number, f: Partial<PdfPageFields> & Pick<PdfPageFields, 'version' | 'fingerprint'>): PdfPageItem {
    this.get(resource);
    const t = this.now();
    const prev = this.sql.get('SELECT * FROM pdf_pages WHERE resource = ? AND page_index = ? AND unplaced = 0', resource, pageIndex);
    if (!prev) {
      const id = f.id ?? crypto.randomUUID();
      this.sql.tx(() => {
        this.sql.run(
          'INSERT INTO pdf_pages (id, resource, version, page_index, fingerprint, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
          id, resource, f.version, pageIndex, f.fingerprint, f.note ?? '', t, t,
        );
        if (f.marks) this.store.setTags('pdfPage', id, f.marks);
        if (f.review) this.store.setReview(id, f.review, this.pageAnchor(id));
      });
      return this.getPage(id)!;
    }
    const cur = toPage(prev, new Map(), []);
    this.sql.tx(() => {
      this.sql.run('UPDATE pdf_pages SET note = ?, updated_at = ? WHERE id = ?', f.note ?? cur.note, t, cur.id);
      if (f.marks) this.store.setTags('pdfPage', cur.id, f.marks);
      if (f.review !== undefined) this.store.setReview(cur.id, f.review, this.pageAnchor(cur.id));
    });
    return this.getPage(cur.id)!;
  }

  // ───────────────────────── table of contents ─────────────────────────

  /** The student's entries and changes to the embedded outline, of one resource. */
  listToc(resource: string): TocEdit[] {
    return this.sql.all('SELECT * FROM pdf_toc WHERE resource = ? AND unplaced = 0 ORDER BY page_index, created_at, id', resource).map(toToc);
  }

  /**
   * Makes an entry or changes it. An embedded entry's change is found by its key, an own entry by `id`; what is given
   * replaces what was there.
   */
  saveToc(resource: string, f: TocEditFields): TocEdit {
    this.get(resource);
    const t = this.now();
    const title = (f.title ?? '').trim().slice(0, MAX_TOC_TITLE);
    const level = f.level === undefined || f.level === null ? null : Math.min(MAX_TOC_LEVEL, Math.max(0, Math.round(f.level)));
    const prev =
      f.embeddedKey != null
        ? this.sql.get('SELECT * FROM pdf_toc WHERE resource = ? AND embedded_key = ?', resource, f.embeddedKey)
        : f.id
          ? this.sql.get('SELECT * FROM pdf_toc WHERE resource = ? AND id = ? AND embedded_key IS NULL', resource, f.id)
          : undefined;
    if (!prev) {
      const id = f.id ?? crypto.randomUUID();
      this.sql.run(
        'INSERT INTO pdf_toc (id, resource, version, page_index, fingerprint, title, level, hidden, embedded_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        id, resource, f.version, f.pageIndex, f.fingerprint, title, level, f.hidden ? 1 : 0, f.embeddedKey ?? null, t, t,
      );
      return toToc(this.sql.get('SELECT * FROM pdf_toc WHERE id = ?', id)!);
    }
    const cur = toToc(prev);
    this.sql.run(
      'UPDATE pdf_toc SET title = ?, level = ?, hidden = ?, updated_at = ? WHERE id = ?',
      f.title === undefined ? cur.title : title,
      f.level === undefined ? cur.level : level,
      f.hidden === undefined ? (cur.hidden ? 1 : 0) : f.hidden ? 1 : 0,
      t,
      cur.id,
    );
    return toToc(this.sql.get('SELECT * FROM pdf_toc WHERE id = ?', cur.id)!);
  }

  deleteToc(resource: string, id: string): boolean {
    if (!this.sql.get('SELECT id FROM pdf_toc WHERE resource = ? AND id = ?', resource, id)) return false;
    this.sql.run('DELETE FROM pdf_toc WHERE id = ?', id);
    return true;
  }

  // ───────────────────────── bibliography ─────────────────────────

  /** The reference entries of a PDF in reading order, each with its work. */
  listBibliography(resource: string): BibEntry[] {
    this.get(resource);
    const similar = this.similarWorks();
    return this.sql
      .all(
        `SELECT c.id AS cid, c.resource AS cresource, c.version, c.position, c.entry_text, c.page_index, c.y, c.cited_at, w.*
           FROM work_citations c JOIN works w ON w.id = c.work WHERE c.resource = ? ORDER BY c.position`,
        resource,
      )
      .map((r) => {
        let citedAt: BibEntry['citedAt'] = [];
        try {
          const j = JSON.parse(r.cited_at as string) as unknown;
          if (Array.isArray(j)) citedAt = j.filter((x): x is { pageIndex: number; y: number } => typeof x?.pageIndex === 'number' && typeof x?.y === 'number');
        } catch {
          /* none */
        }
        return { id: r.cid as string, resource: r.cresource as string, version: r.version as string, position: Number(r.position), text: r.entry_text as string, pageIndex: Number(r.page_index), y: Number(r.y), citedAt, work: toWork(r), similar: similar.get(r.id as string) ?? [] };
      });
  }

  /**
   * Replaces the entries of a PDF with those the browser read (or the student fixed). An entry keeps its work when its
   * `id` is known, or when its text is the same as an old entry's (a new version of the file, a re-read); otherwise it
   * gets a new work. A work nothing cites, wants or is linked to goes away with its last entry.
   */
  saveBibliography(resource: string, version: string, entries: BibEntryInput[]): BibEntry[] {
    this.get(resource);
    const t = this.now();
    const old = this.sql.all('SELECT id, work, entry_text FROM work_citations WHERE resource = ?', resource) as { id: string; work: string; entry_text: string }[];
    const byId = new Map(old.map((o) => [o.id, o]));
    const byText = new Map<string, string[]>();
    for (const o of old) (byText.get(normalizeTitle(o.entry_text)) ?? byText.set(normalizeTitle(o.entry_text), []).get(normalizeTitle(o.entry_text))!).push(o.work);
    this.sql.tx(() => {
      this.sql.run('DELETE FROM work_citations WHERE resource = ?', resource);
      const used = new Set<string>();
      const removed = this.removedKeys();
      entries.forEach((e, position) => {
        const text = e.text.trim().slice(0, MAX_ENTRY_TEXT);
        if (removed.has(`text:${normalizeTitle(text)}`)) return;
        let work = e.id ? byId.get(e.id)?.work : undefined;
        if (!work) work = byText.get(normalizeTitle(text))?.shift();
        const f = workFields(text);
        const conf = fieldsConfidence(f);
        if (work && !used.has(work) && this.sql.get('SELECT id FROM works WHERE id = ?', work)) {
          // Same entry as before: the work stays (a text the student fixed re-reads its fields).
          if ((!byId.has(e.id ?? '') || byId.get(e.id!)!.entry_text !== text) && !this.sql.get('SELECT 1 AS x FROM works WHERE id = ? AND edited = 1', work)) {
            this.sql.run('UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, doi = ?, url = ?, raw = ?, confidence = ?, source = \'\', updated_at = ? WHERE id = ?', f.title, f.authors, f.year, f.venue, f.doi, f.url, text, conf, t, work);
          }
        } else {
          work = crypto.randomUUID();
          this.sql.run('INSERT INTO works (id, title, authors, year, venue, doi, url, raw, confidence, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', work, f.title, f.authors, f.year, f.venue, f.doi, f.url, text, conf, t, t);
        }
        used.add(work);
        const cited = e.citedAt.slice(0, 200).map((c) => ({ pageIndex: c.pageIndex, y: Math.round(c.y * 1000) / 1000 }));
        this.sql.run('INSERT INTO work_citations (id, resource, version, work, position, entry_text, page_index, y, cited_at) VALUES (?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), resource, version, work, position, text, e.pageIndex, e.y, JSON.stringify(cited));
      });
      // Works that lost their entry here and have no other reason to stay.
      this.sql.run(
        `DELETE FROM works WHERE state IS NULL AND edited = 0 AND imported = 0 AND resource IS NULL AND NOT EXISTS (SELECT 1 FROM work_citations c WHERE c.work = works.id)`,
      );
      this.sql.run("DELETE FROM tag_links WHERE kind = 'work' AND ref NOT IN (SELECT id FROM works)");
    });
    return this.listBibliography(resource);
  }

  /**
   * For every work the others it looks like: same DOI, or same title and year. Not the ones the student kept separate,
   * and not the ones cited by a common PDF (two entries of one list are two works, whatever they look like).
   */
  private similarWorks(): Map<string, SimilarWork[]> {
    const rows = this.sql.all('SELECT id, title, authors, year, doi FROM works') as Row[];
    const groups = new Map<string, Row[]>();
    for (const w of rows) {
      for (const k of workKeys({ title: w.title as string, year: w.year === null ? null : Number(w.year), doi: w.doi as string })) (groups.get(k) ?? groups.set(k, []).get(k)!).push(w);
    }
    const out = new Map<string, SimilarWork[]>();
    const multi = [...groups.values()].filter((g) => g.length > 1);
    if (multi.length === 0) return out;
    const cites = new Map<string, Set<string>>();
    for (const c of this.sql.all('SELECT work, resource FROM work_citations') as Row[]) (cites.get(c.work as string) ?? cites.set(c.work as string, new Set()).get(c.work as string)!).add(c.resource as string);
    const apart = new Set((this.sql.all('SELECT a, b FROM work_distinct') as Row[]).map((r) => `${r.a}|${r.b}`));
    const share = (a: string, b: string) => [...(cites.get(a) ?? [])].some((x) => cites.get(b)?.has(x));
    for (const g of multi) {
      for (const w of g) {
        for (const o of g) {
          const id = w.id as string;
          const oid = o.id as string;
          if (id === oid || apart.has(id < oid ? `${id}|${oid}` : `${oid}|${id}`) || share(id, oid)) continue;
          const list = out.get(id) ?? out.set(id, []).get(id)!;
          if (list.some((x) => x.id === oid)) continue;
          list.push({ id: oid, title: o.title as string, authors: o.authors as string, year: o.year === null ? null : Number(o.year), cited: cites.get(oid)?.size ?? 0 });
        }
      }
    }
    return out;
  }

  /** Every work of the student's library, with the PDFs that cite it. */
  listWorks(): LibraryWork[] {
    const similar = this.similarWorks();
    const by = new Map<string, LibraryWork['citedBy']>();
    for (const c of this.sql.all(
      `SELECT c.work, c.resource, r.title, COUNT(*) AS n FROM work_citations c JOIN resources r ON r.id = c.resource GROUP BY c.work, c.resource ORDER BY r.title`,
    ) as Row[]) {
      (by.get(c.work as string) ?? by.set(c.work as string, []).get(c.work as string)!).push({ resource: c.resource as string, title: c.title as string, count: Number(c.n) });
    }
    const shown = new Set(this.courses().map((c) => c.id));
    const on = new Map<string, LibraryWork['citedOn']>();
    for (const c of this.sql.all('SELECT work, course, page, title, href FROM work_page_citations ORDER BY title') as Row[]) {
      if (!shown.has(c.course as string)) continue;
      (on.get(c.work as string) ?? on.set(c.work as string, []).get(c.work as string)!).push({ course: c.course as string, page: c.page as string, title: c.title as string, href: c.href as string });
    }
    const tags = this.store.tagLinks('work');
    return (this.sql.all('SELECT * FROM works ORDER BY year DESC, title') as Row[]).map((r) => ({ ...toWork(r), citedBy: by.get(r.id as string) ?? [], citedOn: on.get(r.id as string) ?? [], similar: similar.get(r.id as string) ?? [], tags: tags.get(r.id as string) ?? [] }));
  }

  private lookupRun: Promise<void> | null = null;
  private lookupAgain = false;

  /**
   * Looks up the references the parser is unsure about, one request at a time in the background. Does nothing while the
   * setting `lookupReferences` is off. Returns the running pass (tests wait for it).
   */
  startLookups(): Promise<void> {
    if (this.lookupRun) {
      this.lookupAgain = true;
      return this.lookupRun;
    }
    if (!this.store.getSettings().lookupReferences) return Promise.resolve();
    this.lookupRun = this.lookupPass()
      .catch(() => {})
      .finally(() => {
        this.lookupRun = null;
        if (this.lookupAgain) {
          this.lookupAgain = false;
          void this.startLookups();
        }
      });
    return this.lookupRun;
  }

  private async lookupPass(): Promise<void> {
    const seen = new Set<string>();
    for (;;) {
      if (!this.store.getSettings().lookupReferences) return;
      const next = (this.sql.all("SELECT * FROM works WHERE imported = 0 AND edited = 0 AND source = '' AND raw <> ''") as Row[])
        .map((r) => ({ r, w: toWork(r) }))
        .find(({ w }) => !seen.has(w.id) && w.confidence < MIN_CONFIDENCE && !this.sql.get('SELECT key FROM work_lookups WHERE key = ? AND fields = ?', lookupKey(w.raw), ''));
      if (!next) return;
      seen.add(next.w.id);
      const key = lookupKey(next.w.raw);
      const cached = this.sql.get('SELECT fields FROM work_lookups WHERE key = ?', key);
      let fields: WorkFields | null;
      if (cached) fields = JSON.parse(cached.fields as string) as WorkFields;
      else {
        try {
          fields = await crossrefLookup(next.w.raw, this.fetchFn);
        } catch {
          return; // Unreachable or refused: silent, the entries stay raw, and the next save tries again.
        }
        this.sql.run('INSERT OR REPLACE INTO work_lookups (key, fields, looked_at) VALUES (?,?,?)', key, fields ? JSON.stringify(fields) : '', this.now());
        await new Promise((resolve) => setTimeout(resolve, this.lookupPause));
      }
      // The setting or the entry may have changed while waiting.
      if (!fields || !this.store.getSettings().lookupReferences) continue;
      const now = this.sql.get("SELECT raw FROM works WHERE id = ? AND source = ''", next.w.id);
      if (!now || now.raw !== next.w.raw) continue;
      const f = fields;
      this.sql.run("UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, doi = ?, url = ?, confidence = 1, source = 'crossref', updated_at = ? WHERE id = ? AND edited = 0", f.title, f.authors, f.year, f.venue, f.doi, f.url || next.w.url, this.now(), next.w.id);
    }
  }

  /**
   * Two works that are one: the citations of `from` move to `into`, which keeps its own link to a material (or takes
   * the other's) and the reading wish of either. Two works cited by one PDF are two entries, never one.
   */
  mergeWorks(from: string, into: string): void {
    if (from === into) throw new ResourceError('bad-merge');
    const a = this.sql.get('SELECT * FROM works WHERE id = ?', from);
    const b = this.sql.get('SELECT * FROM works WHERE id = ?', into);
    if (!a || !b) throw new ResourceError('unknown-item');
    if (this.sql.get('SELECT 1 AS x FROM work_citations x JOIN work_citations y ON y.resource = x.resource WHERE x.work = ? AND y.work = ?', from, into)) throw new ResourceError('bad-merge');
    this.sql.tx(() => {
      this.sql.run('UPDATE work_citations SET work = ? WHERE work = ?', into, from);
      this.sql.run(
        'UPDATE works SET state = ?, resource = ?, doi = ?, updated_at = ? WHERE id = ?',
        (b.state as string | null) ?? (a.state as string | null),
        (b.resource as string | null) ?? (a.resource as string | null),
        (b.doi as string) || (a.doi as string),
        this.now(),
        into,
      );
      this.store.setTags('work', into, [...new Set([...this.store.tagsOf('work', into), ...this.store.tagsOf('work', from)])]);
      this.store.unlinkAll('work', from);
      this.sql.run('DELETE FROM works WHERE id = ?', from);
    });
  }

  /** What a pasted or uploaded text holds, and for each work the ones in the library it looks like. Nothing is stored. */
  previewImport(text: string): ImportPreview {
    const { format, works } = parseBibText(text);
    if (works.length === 0) return { format, items: [] };
    const rows = this.sql.all('SELECT id, title, authors, year, doi FROM works') as Row[];
    const byKey = new Map<string, Row[]>();
    for (const w of rows) {
      for (const k of workKeys({ title: w.title as string, year: w.year === null ? null : Number(w.year), doi: w.doi as string })) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(w);
    }
    const cited = new Map<string, number>();
    for (const c of this.sql.all('SELECT work, COUNT(DISTINCT resource) AS n FROM work_citations GROUP BY work') as Row[]) cited.set(c.work as string, Number(c.n));
    const items = works.map((w): ImportCandidate => {
      const similar: SimilarWork[] = [];
      for (const k of workKeys(w)) {
        for (const o of byKey.get(k) ?? []) {
          if (similar.some((x) => x.id === o.id)) continue;
          similar.push({ id: o.id as string, title: o.title as string, authors: o.authors as string, year: o.year === null ? null : Number(o.year), cited: cited.get(o.id as string) ?? 0 });
        }
      }
      return { ...w, similar };
    });
    return { format, items };
  }

  /**
   * Adds the chosen works to the library (they stay with no PDF citing them). A choice with `into` adds nothing new:
   * it fills the fields the library's work lacks. Returns how many were added and how many were merged into others.
   */
  importWorks(choices: ImportChoice[]): { added: number; merged: number } {
    const t = this.now();
    let added = 0;
    let merged = 0;
    this.sql.tx(() => {
      for (const c of choices.slice(0, 2000)) {
        const w: ImportedWork = { title: c.title.slice(0, 300), authors: c.authors.slice(0, 400), year: c.year, venue: c.venue.slice(0, 300), doi: c.doi.slice(0, 200), url: c.url.slice(0, 500), raw: c.raw.slice(0, MAX_ENTRY_TEXT), key: '' };
        const into = c.into ? (this.sql.get('SELECT * FROM works WHERE id = ?', c.into) as Row | undefined) : undefined;
        if (into) {
          const keep = (field: string, v: string) => (into[field] as string) || v;
          this.sql.run(
            'UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, doi = ?, url = ?, imported = 1, updated_at = ? WHERE id = ?',
            keep('title', w.title), keep('authors', w.authors), into.year === null ? w.year : Number(into.year), keep('venue', w.venue), keep('doi', w.doi), keep('url', w.url), t, c.into!,
          );
          merged++;
        } else {
          this.sql.run('INSERT INTO works (id, title, authors, year, venue, doi, url, raw, imported, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)', crypto.randomUUID(), w.title, w.authors, w.year, w.venue, w.doi, w.url, w.raw, t, t);
          added++;
        }
      }
    });
    return { added, merged };
  }

  /**
   * The works a page of a workbook cites enter the library: one that is there already (same DOI, or same title and
   * year) is reused and only gets the fields it lacked; the others are added. Returns the work of each key, and records
   * that the page cites it. Nothing is removed, and opening the page again changes nothing.
   */
  citeWorks(course: string, page: { id: string; title: string; href: string }, works: ImportedWork[]): Record<string, string> {
    const t = this.now();
    const out: Record<string, string> = {};
    this.sql.tx(() => {
      const rows = this.sql.all('SELECT id, title, year, doi FROM works') as Row[];
      const byKey = new Map<string, string>();
      for (const r of rows) for (const k of workKeys({ title: r.title as string, year: r.year === null ? null : Number(r.year), doi: r.doi as string })) if (!byKey.has(k)) byKey.set(k, r.id as string);
      const removed = this.removedKeys();
      for (const w of works.slice(0, 500)) {
        const f = { title: w.title.slice(0, 300), authors: w.authors.slice(0, 400), year: w.year, venue: w.venue.slice(0, 300), doi: w.doi.slice(0, 200), url: w.url.slice(0, 500) };
        const keys = workKeys(f);
        if (keys.some((k) => removed.has(k))) continue;
        let id = keys.map((k) => byKey.get(k)).find(Boolean);
        const existing = id ? (this.sql.get('SELECT * FROM works WHERE id = ?', id) as Row | undefined) : undefined;
        if (id && existing) {
          const keep = (field: string, v: string) => (existing[field] as string) || v;
          this.sql.run(
            'UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, doi = ?, url = ?, updated_at = ? WHERE id = ?',
            keep('title', f.title), keep('authors', f.authors), existing.year === null ? f.year : Number(existing.year), keep('venue', f.venue), keep('doi', f.doi), keep('url', f.url), t, id,
          );
        } else {
          id = crypto.randomUUID();
          this.sql.run(
            'INSERT INTO works (id, title, authors, year, venue, doi, url, raw, confidence, imported, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?)',
            id, f.title, f.authors, f.year, f.venue, f.doi, f.url, (w.raw || [f.authors, f.year, f.title, f.venue].filter(Boolean).join('. ')).slice(0, MAX_ENTRY_TEXT), t, t,
          );
          for (const k of keys) byKey.set(k, id);
        }
        out[w.key] = id;
        this.sql.run('INSERT OR REPLACE INTO work_page_citations (work, course, page, title, href) VALUES (?,?,?,?,?)', id, course, page.id, page.title.slice(0, 300), page.href.slice(0, 300));
      }
    });
    return out;
  }

  private removedKeys(): Set<string> {
    return new Set((this.sql.all('SELECT key FROM work_removed') as { key: string }[]).map((r) => r.key));
  }

  /**
   * The student removes a work (a wrong entry they cannot trace): it goes with its citations and tags, and what
   * identifies it is remembered so reading the PDF again, or opening a page that cites it, does not bring it back.
   */
  removeWork(work: string): void {
    const row = this.sql.get('SELECT * FROM works WHERE id = ?', work) as Row | undefined;
    if (!row) throw new ResourceError('unknown-item');
    this.sql.tx(() => {
      const keys = new Set(workKeys({ title: row.title as string, year: row.year === null ? null : Number(row.year), doi: row.doi as string }));
      const texts = [row.raw as string, ...(this.sql.all('SELECT entry_text FROM work_citations WHERE work = ?', work) as { entry_text: string }[]).map((c) => c.entry_text)];
      for (const x of texts) if (normalizeTitle(x)) keys.add(`text:${normalizeTitle(x)}`);
      for (const k of keys) this.sql.run('INSERT OR IGNORE INTO work_removed (key) VALUES (?)', k);
      this.sql.run("DELETE FROM tag_links WHERE kind = 'work' AND ref = ?", work);
      this.sql.run('DELETE FROM works WHERE id = ?', work);
    });
  }

  /** "Not the same": the pair is not suggested again. */
  keepSeparate(a: string, b: string): void {
    if (a === b || !this.sql.get('SELECT id FROM works WHERE id = ?', a) || !this.sql.get('SELECT id FROM works WHERE id = ?', b)) throw new ResourceError('unknown-item');
    this.sql.run('INSERT OR IGNORE INTO work_distinct (a, b) VALUES (?, ?)', a < b ? a : b, a < b ? b : a);
  }

  /** "I have this": the work is that material (null: it is not). */
  linkWork(work: string, resource: string | null): Work {
    if (!this.sql.get('SELECT id FROM works WHERE id = ?', work)) throw new ResourceError('unknown-item');
    if (resource !== null) this.get(resource);
    this.sql.run('UPDATE works SET resource = ?, updated_at = ? WHERE id = ?', resource, this.now(), work);
    const row = this.sql.get('SELECT * FROM works WHERE id = ?', work)!;
    // A work nothing else needs goes when its link is taken away.
    return toWork(row);
  }

  /** Sorts a work (null: back to the Unsorted tray). */
  setWorkState(work: string, state: WorkState | null): Work {
    if (!this.sql.get('SELECT id FROM works WHERE id = ?', work)) throw new ResourceError('unknown-item');
    this.sql.run('UPDATE works SET state = ?, updated_at = ? WHERE id = ?', state, this.now(), work);
    return toWork(this.sql.get('SELECT * FROM works WHERE id = ?', work)!);
  }

  /** A work the student adds by hand: edited from the start, so no re-read or lookup changes its fields. */
  createWork(f: WorkEdit): Work {
    const id = crypto.randomUUID();
    const t = this.now();
    const c = (v: string, n: number) => v.trim().slice(0, n);
    const raw = [f.authors, f.year, f.title, f.venue].filter(Boolean).join('. ').slice(0, MAX_ENTRY_TEXT);
    this.sql.run(
      'INSERT INTO works (id, title, authors, year, venue, doi, url, volume, pages, arxiv, raw, confidence, imported, edited, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,1,1,?,?)',
      id, c(f.title, 300), c(f.authors, 400), f.year, c(f.venue, 300), c(f.doi, 200), c(f.url, 500), c(f.volume, 50), c(f.pages, 50), c(f.arxiv, 50), raw, t, t,
    );
    return toWork(this.sql.get('SELECT * FROM works WHERE id = ?', id)!);
  }

  /** The fields of a DOI or arXiv id from Crossref. Needs the online lookup setting; null: not found or offline. */
  async lookupDoi(input: string): Promise<WorkFields | null> {
    if (!this.store.getSettings().lookupReferences) throw new ResourceError('no-file');
    try {
      return await crossrefByDoi(input, this.fetchFn);
    } catch {
      return null;
    }
  }

  /** Works of the library by id, for texts that cite them (`#cite-work`); the ones that are gone are left out. */
  worksByIds(ids: string[]): Work[] {
    return ids.slice(0, 200).flatMap((id) => {
      const r = this.sql.get('SELECT * FROM works WHERE id = ?', id);
      return r ? [toWork(r)] : [];
    });
  }

  /** The student's edit of a work's fields; the work is locked from then on (re-reads and lookups leave it alone). */
  editWork(work: string, f: WorkEdit): Work {
    if (!this.sql.get('SELECT id FROM works WHERE id = ?', work)) throw new ResourceError('unknown-item');
    this.sql.run(
      'UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, doi = ?, url = ?, volume = ?, pages = ?, arxiv = ?, edited = 1, confidence = 1, updated_at = ? WHERE id = ?',
      f.title.trim().slice(0, 300), f.authors.trim().slice(0, 400), f.year, f.venue.trim().slice(0, 300), f.doi.trim().slice(0, 200), f.url.trim().slice(0, 500), f.volume.trim().slice(0, 50), f.pages.trim().slice(0, 50), f.arxiv.trim().slice(0, 50), this.now(), work,
    );
    return toWork(this.sql.get('SELECT * FROM works WHERE id = ?', work)!);
  }

  // ───────────────────────── new versions of a file ─────────────────────────

  /**
   * A new file for the resource: it becomes the current one. The old file goes unless some resource still uses it
   * (snapshots keep their own copies). The student's highlights and page items are placed on the new file afterwards,
   * by the browser (`reanchor`).
   */
  addVersion(id: string, file: { sha256: string; filename: string; size: number }): Resource {
    const before = this.get(id);
    if (before.file.sha256 === file.sha256) throw new ResourceError('same-file');
    const now = this.now();
    this.sql.tx(() => {
      this.sql.run('INSERT INTO resource_versions (resource, sha256, filename, mime, size, uploaded_at) VALUES (?,?,?,?,?,?)', id, file.sha256, file.filename, mimeOf(file.filename), file.size, now);
      const version = Number(this.sql.get('SELECT last_insert_rowid() AS id')!.id);
      this.sql.run('UPDATE resources SET current_version = ?, updated_at = ? WHERE id = ?', version, now, id);
      // Only the text of the file in use is searched.
      this.sql.run('DELETE FROM resource_text WHERE resource = ? AND version <> ?', id, file.sha256);
      this.sql.run('DELETE FROM resource_text_state WHERE resource = ? AND version <> ?', id, file.sha256);
    });
    this.removeIfSuperseded(before.file.sha256);
    this.indexText();
    return this.get(id);
  }

  /** Items made on an older file than the current one. */
  listStale(id: string): StaleItems {
    const version = this.get(id).file.sha256;
    return {
      version,
      highlights: this.sql.all('SELECT id, page_index, quote, prefix, suffix FROM pdf_annotations WHERE resource = ? AND version <> ?', id, version).map((r) => ({ id: r.id as string, pageIndex: Number(r.page_index), quote: r.quote as string, prefix: r.prefix as string, suffix: r.suffix as string })),
      pages: this.sql.all('SELECT id, page_index, fingerprint FROM pdf_pages WHERE resource = ? AND version <> ?', id, version).map((r) => ({ id: r.id as string, pageIndex: Number(r.page_index), fingerprint: r.fingerprint as string })),
      toc: this.sql.all('SELECT id, page_index, fingerprint FROM pdf_toc WHERE resource = ? AND embedded_key IS NULL AND version <> ?', id, version).map((r) => ({ id: r.id as string, pageIndex: Number(r.page_index), fingerprint: r.fingerprint as string })),
      questions: this.sql
        .all(`SELECT id, anchor FROM questions WHERE ${ON_RESOURCE} AND json_extract(anchor, '$.version') <> ?`, id, version)
        .map((r) => {
          const a = JSON.parse(r.anchor as string) as Extract<Anchor, { kind: 'page' }>;
          return { id: r.id as string, pageIndex: a.pageIndex, fingerprint: a.fingerprint, quote: a.quote ?? '', prefix: a.prefix ?? '', suffix: a.suffix ?? '' };
        }),
    };
  }

  /**
   * What the browser found out about the stale items: placed ones move to their new page and file, the rest are
   * `unplaced` (and on the new file, so nobody looks again). Returns what is left to fix.
   */
  reanchor(id: string, found: Reanchored): UnplacedItems {
    if (this.get(id).file.sha256 !== found.version) throw new ResourceError('no-file');
    const t = this.now();
    this.sql.tx(() => {
      // Page items first leave the one-per-page key, so moving them onto each other's pages cannot collide.
      for (const p of found.pages) this.sql.run('UPDATE pdf_pages SET unplaced = 1 WHERE id = ? AND resource = ?', p.id, id);
      for (const h of found.highlights) {
        if (h.place) this.sql.run('UPDATE pdf_annotations SET version = ?, page_index = ?, rects = ?, unplaced = 0, updated_at = ? WHERE id = ? AND resource = ?', found.version, h.place.pageIndex, JSON.stringify(h.place.rects), t, h.id, id);
        else this.sql.run('UPDATE pdf_annotations SET version = ?, unplaced = 1 WHERE id = ? AND resource = ?', found.version, h.id, id);
      }
      for (const p of found.pages) {
        if (p.pageIndex === null) {
          this.sql.run('UPDATE pdf_pages SET version = ? WHERE id = ? AND resource = ?', found.version, p.id, id);
          continue;
        }
        try {
          this.sql.run('UPDATE pdf_pages SET version = ?, page_index = ?, fingerprint = COALESCE(?, fingerprint), unplaced = 0, updated_at = ? WHERE id = ? AND resource = ?', found.version, p.pageIndex, p.fingerprint ?? null, t, p.id, id);
        } catch {
          // A page item made on the new file is already there: this one is left to the student.
          this.sql.run('UPDATE pdf_pages SET version = ? WHERE id = ? AND resource = ?', found.version, p.id, id);
        }
      }
      for (const q of found.questions) {
        if (q.pageIndex === null) this.sql.run(`UPDATE questions SET anchor = json_set(anchor, '$.version', ?), unplaced = 1 WHERE id = ? AND ${ON_RESOURCE}`, found.version, q.id, id);
        else this.movePageQuestion(id, q.id, found.version, q.pageIndex, q.fingerprint);
      }
      for (const e of found.toc) {
        if (e.pageIndex === null) this.sql.run('UPDATE pdf_toc SET version = ?, unplaced = 1 WHERE id = ? AND resource = ?', found.version, e.id, id);
        else this.sql.run('UPDATE pdf_toc SET version = ?, page_index = ?, fingerprint = COALESCE(?, fingerprint), unplaced = 0, updated_at = ? WHERE id = ? AND resource = ?', found.version, e.pageIndex, e.fingerprint ?? null, t, e.id, id);
      }
    });
    return this.listUnplaced(id);
  }

  /** What the new file could not place, to fix or drop. */
  listUnplaced(id: string): UnplacedItems {
    this.get(id);
    const reviews = this.store.reviews();
    return {
      highlights: this.sql.all('SELECT * FROM pdf_annotations WHERE resource = ? AND unplaced = 1 ORDER BY page_index, created_at', id).map((r) => toHighlight(r, reviews, this.store.tagsOf('pdfHighlight', r.id as string))),
      pages: this.sql.all('SELECT * FROM pdf_pages WHERE resource = ? AND unplaced = 1 ORDER BY page_index', id).map((r) => toPage(r, reviews, this.store.tagsOf('pdfPage', r.id as string))),
      toc: this.sql.all('SELECT * FROM pdf_toc WHERE resource = ? AND unplaced = 1 ORDER BY page_index', id).map(toToc),
      questions: this.store.listQuestions({ resource: id }).filter((q) => q.unplaced),
    };
  }

  /** A question's anchor on the new file: its version, page and (when known) the page's fingerprint. */
  private movePageQuestion(resource: string, question: string, version: string, pageIndex: number, fingerprint?: string): void {
    this.sql.run(
      `UPDATE questions SET anchor = json_set(anchor, '$.version', ?, '$.pageIndex', ?, '$.fingerprint', COALESCE(?, json_extract(anchor, '$.fingerprint'))), unplaced = 0 WHERE id = ? AND ${ON_RESOURCE}`,
      version, pageIndex, fingerprint ?? null, question, resource,
    );
  }

  /** Puts an unplaced item on a page of the current file. A page that has its own item already says no. */
  placeUnplaced(id: string, kind: UnplacedKind, item: string, where: { pageIndex: number; rects?: Placed['rects']; fingerprint?: string }): void {
    const version = this.get(id).file.sha256;
    const t = this.now();
    this.unplacedRow(id, kind, item);
    if (kind === 'question') {
      this.movePageQuestion(id, item, version, where.pageIndex, where.fingerprint);
    } else if (kind === 'highlight') {
      if (!where.rects?.length) throw new ResourceError('unknown-item');
      this.sql.run('UPDATE pdf_annotations SET version = ?, page_index = ?, rects = ?, unplaced = 0, updated_at = ? WHERE id = ? AND resource = ? AND unplaced = 1', version, where.pageIndex, JSON.stringify(where.rects), t, item, id);
    } else if (kind === 'page') {
      if (this.sql.get('SELECT 1 AS x FROM pdf_pages WHERE resource = ? AND page_index = ? AND unplaced = 0', id, where.pageIndex)) throw new ResourceError('page-taken');
      this.sql.run('UPDATE pdf_pages SET version = ?, page_index = ?, fingerprint = COALESCE(?, fingerprint), unplaced = 0, updated_at = ? WHERE id = ? AND resource = ? AND unplaced = 1', version, where.pageIndex, where.fingerprint ?? null, t, item, id);
    } else {
      this.sql.run('UPDATE pdf_toc SET version = ?, page_index = ?, fingerprint = COALESCE(?, fingerprint), unplaced = 0, updated_at = ? WHERE id = ? AND resource = ? AND unplaced = 1', version, where.pageIndex, where.fingerprint ?? null, t, item, id);
    }
  }

  /** Throws an unplaced item away. */
  dropUnplaced(id: string, kind: UnplacedKind, item: string): void {
    const table = TABLES[kind];
    this.unplacedRow(id, kind, item);
    this.sql.run(`DELETE FROM ${table} WHERE id = ?`, item);
  }

  /** Starts over: every resource and every file. Snapshots keep their own copies. */
  reset(): void {
    this.sql.tx(() => {
      for (const table of ['resources', 'resource_series']) this.sql.run(`DELETE FROM ${table}`);
    });
    fs.rmSync(this.filesDir, { recursive: true, force: true });
  }

  removeIfUnused(sha256: string): void {
    if (this.sql.get('SELECT 1 AS x FROM resource_versions WHERE sha256 = ? LIMIT 1', sha256)) return;
    const file = this.filePath(sha256);
    if (file) fs.rmSync(file, { force: true });
  }

  private unplacedRow(id: string, kind: UnplacedKind, item: string): void {
    const where = kind === 'question' ? ON_RESOURCE : 'resource = ?';
    if (!this.sql.get(`SELECT 1 AS x FROM ${TABLES[kind]} WHERE id = ? AND ${where} AND unplaced = 1`, item, id)) throw new ResourceError('unknown-item');
  }

  /** The file of a replaced version goes, unless some resource has it as its current file. */
  private removeIfSuperseded(sha256: string): void {
    if (this.sql.get('SELECT 1 AS x FROM resources r JOIN resource_versions v ON v.id = r.current_version WHERE v.sha256 = ? LIMIT 1', sha256)) return;
    const file = this.filePath(sha256);
    if (file) fs.rmSync(file, { force: true });
  }

  private setLabels(id: string, labels: string[]): void {
    this.store.setTags('resource', id, labels);
  }

  private setCourses(id: string, courses: string[]): void {
    this.sql.run('DELETE FROM resource_courses WHERE resource = ?', id);
    for (const c of new Set(courses)) this.sql.run('INSERT INTO resource_courses (resource, course) VALUES (?, ?)', id, c);
  }

  /** The series a resource goes into: a new one if the fields name one, else an existing one. */
  private seriesFor(f: ResourceFields): string | null {
    if (f.newSeries?.trim()) {
      const title = f.newSeries.trim();
      const found = this.sql.get('SELECT id FROM resource_series WHERE title = ? AND type = ?', title, f.type);
      if (found) return found.id as string;
      const id = `s-${crypto.randomBytes(5).toString('hex')}`;
      this.sql.run('INSERT INTO resource_series (id, title, type, created_at) VALUES (?,?,?,?)', id, title, f.type, this.now());
      return id;
    }
    if (f.series && !this.sql.get('SELECT 1 AS x FROM resource_series WHERE id = ?', f.series)) throw new ResourceError('unknown-series');
    return f.series;
  }

  private dropEmptySeries(): void {
    this.sql.run('DELETE FROM resource_series WHERE NOT EXISTS (SELECT 1 FROM resources WHERE series = resource_series.id)');
  }
}
