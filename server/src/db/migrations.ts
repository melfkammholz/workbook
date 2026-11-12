/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many
 * have run. Never edit a released migration: append a new one.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** SQL, or a function for a step that has to look at the database first. */
export type Migration = string | ((db: DatabaseSync) => void);

export const MIGRATIONS: Migration[] = [
  /* 1: initial schema */ `
  CREATE TABLE progress (
    exercise_id   TEXT PRIMARY KEY,
    status        TEXT NOT NULL CHECK (status IN ('todo','in_progress','done','review')),
    updated_at    INTEGER NOT NULL,
    review_due_at INTEGER,
    review_count  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE answers (
    exercise_id TEXT NOT NULL,
    slot        TEXT NOT NULL,           -- "text" or the code file's path
    content     TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (exercise_id, slot)
  );

  CREATE TABLE answer_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id TEXT NOT NULL,
    slot        TEXT NOT NULL,
    content     TEXT NOT NULL,
    reason      TEXT NOT NULL,           -- autosave | run | check | done | reset | restore
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX answer_versions_lookup ON answer_versions (exercise_id, slot, id);

  CREATE TABLE notes (
    exercise_id TEXT PRIMARY KEY,
    format      TEXT NOT NULL CHECK (format IN ('typst','markdown')),
    content     TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE reflections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id TEXT NOT NULL,
    confidence  INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5),
    how         TEXT NOT NULL,           -- JSON array
    comment     TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX reflections_lookup ON reflections (exercise_id, id);

  CREATE TABLE stats (
    exercise_id        TEXT PRIMARY KEY,
    active_seconds     INTEGER NOT NULL DEFAULT 0,
    check_runs         INTEGER NOT NULL DEFAULT 0,
    check_passes       INTEGER NOT NULL DEFAULT 0,
    hints_revealed     INTEGER NOT NULL DEFAULT 0,
    solution_viewed_at INTEGER,
    first_opened_at    INTEGER,
    last_opened_at     INTEGER
  );

  CREATE TABLE check_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id TEXT NOT NULL,
    at          INTEGER NOT NULL,
    passed      INTEGER NOT NULL,
    total       INTEGER NOT NULL
  );
  CREATE INDEX check_history_lookup ON check_history (exercise_id, id);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL                  -- JSON
  );

  -- Full-text index over answers and notes. Maintained by the store.
  CREATE VIRTUAL TABLE search USING fts5(
    exercise_id UNINDEXED,
    source      UNINDEXED,               -- "note" | "answer"
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
  /* 2: open questions and AI reviews */ `
  CREATE TABLE open_questions (
    exercise_id TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE ai_reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id TEXT NOT NULL,
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX ai_reviews_lookup ON ai_reviews (exercise_id, id);
  `,
  /* 3: direct AI services and author mode are gone, and with them saved reviews and any API key */ `
  DROP TABLE ai_reviews;
  DELETE FROM settings WHERE key = 'aiKey';
  UPDATE settings
     SET value = json_remove(value, '$.aiEnabled', '$.aiProvider', '$.aiModel', '$.aiBaseUrl', '$.aiConfirmBeforeSend', '$.authorMode')
   WHERE key = 'settings';
  `,
  /* 4: answers to checklists */ `
  CREATE TABLE checklist_answers (
    checklist_id TEXT NOT NULL,
    question_id  TEXT NOT NULL,
    confidence   INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 5),
    note         TEXT NOT NULL DEFAULT '',
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (checklist_id, question_id)
  );
  `,
  /* 5: what was earned, and every checklist rating (a comeback needs the earlier ones) */ `
  CREATE TABLE achievements (
    key       TEXT PRIMARY KEY,
    earned_at INTEGER NOT NULL,
    seen      INTEGER NOT NULL DEFAULT 0,
    event     TEXT NOT NULL              -- JSON
  );

  CREATE TABLE checklist_ratings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id TEXT NOT NULL,
    question_id  TEXT NOT NULL,
    confidence   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
  );
  `,
  /* 6: flashcards. Used in the main database only: decks belong to the student, not to a course. */ `
  CREATE TABLE decks (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    source     TEXT NOT NULL,            -- Typst; the text is the deck
    settings   TEXT NOT NULL DEFAULT '{}', -- JSON
    position   INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- One row per card id, direction or gap ("k3f9", "k3f9:back", "k3f9:2"). Not tied to a deck, so cards can move.
  CREATE TABLE card_schedule (
    key          TEXT PRIMARY KEY,
    card         TEXT NOT NULL,          -- JSON, the FSRS state
    due          INTEGER NOT NULL,
    buried_until INTEGER,
    updated_at   INTEGER NOT NULL
  );

  CREATE TABLE card_reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT NOT NULL,
    deck_id     TEXT NOT NULL,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
    was_new     INTEGER NOT NULL,
    state       INTEGER NOT NULL,        -- FSRS state after the review
    stability   REAL NOT NULL,
    difficulty  REAL NOT NULL,
    due         INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL
  );
  CREATE INDEX card_reviews_lookup ON card_reviews (key, id);
  CREATE INDEX card_reviews_day ON card_reviews (reviewed_at);
  `,
  /*
   * 7: the deck "Make a card" adds to, and cards kept as they are after being forgotten often.
   * Development builds of migration 6 already had one or both, so this looks before it adds.
   */
  (db) => {
    const columns = (db.prepare('PRAGMA table_info(decks)').all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes('used_at')) {
      db.exec('ALTER TABLE decks ADD COLUMN used_at INTEGER NOT NULL DEFAULT 0'); // last time a card was added
      db.exec('UPDATE decks SET used_at = updated_at');
    }
    // "Keep as is" for a card that kept being forgotten: it is offered again only after the next lapse.
    db.exec('CREATE TABLE IF NOT EXISTS card_kept (card_id TEXT PRIMARY KEY, kept_at INTEGER NOT NULL)');
  },
  /* 8: highlights and comments on the course's text, found again by their quote */ `
  CREATE TABLE annotations (
    id         TEXT PRIMARY KEY,
    target     TEXT NOT NULL,             -- item id, or a text that is not one: "chapter/<id>", "thread/<id>", "landing"
    part       TEXT NOT NULL,             -- "task", "remark-<n>", "hint-<n>"
    quote      TEXT NOT NULL,
    prefix     TEXT NOT NULL,
    suffix     TEXT NOT NULL,
    color      TEXT NOT NULL,
    comment    TEXT NOT NULL DEFAULT '',
    review     TEXT CHECK (review IS NULL OR review IN ('open','resolved')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX annotations_target ON annotations (target);
  `,
  /* 9: a highlight may carry one of the student's own labels */ `
  ALTER TABLE annotations ADD COLUMN label TEXT;
  `,
  /*
   * 10: one database for all courses. Every course-bound table gets `course` as the first column of its key and
   * indexes, so every scoped query is an index lookup. Rows already here are the mounted folder's work, which is
   * now the course `content`. Settings get a course too: '' for what belongs to the student, not to a course.
   */
  (db) => {
    const tables: [string, string, string[]][] = [
      [
        'progress',
        `exercise_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('todo','in_progress','done','review')),
         updated_at INTEGER NOT NULL, review_due_at INTEGER, review_count INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (course, exercise_id)`,
        [],
      ],
      ['answers', 'exercise_id TEXT NOT NULL, slot TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (course, exercise_id, slot)', []],
      [
        'answer_versions',
        'id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT NOT NULL, slot TEXT NOT NULL, content TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL',
        ['CREATE INDEX answer_versions_lookup ON answer_versions (course, exercise_id, slot, id)'],
      ],
      ['notes', "exercise_id TEXT NOT NULL, format TEXT NOT NULL CHECK (format IN ('typst','markdown')), content TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (course, exercise_id)", []],
      [
        'reflections',
        "id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT NOT NULL, confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5), how TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL",
        ['CREATE INDEX reflections_lookup ON reflections (course, exercise_id, id)'],
      ],
      [
        'stats',
        `exercise_id TEXT NOT NULL, active_seconds INTEGER NOT NULL DEFAULT 0, check_runs INTEGER NOT NULL DEFAULT 0,
         check_passes INTEGER NOT NULL DEFAULT 0, hints_revealed INTEGER NOT NULL DEFAULT 0, solution_viewed_at INTEGER,
         first_opened_at INTEGER, last_opened_at INTEGER, PRIMARY KEY (course, exercise_id)`,
        [],
      ],
      [
        'check_history',
        'id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT NOT NULL, at INTEGER NOT NULL, passed INTEGER NOT NULL, total INTEGER NOT NULL',
        ['CREATE INDEX check_history_lookup ON check_history (course, exercise_id, id)'],
      ],
      ['open_questions', 'exercise_id TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (course, exercise_id)', []],
      [
        'checklist_answers',
        `checklist_id TEXT NOT NULL, question_id TEXT NOT NULL, confidence INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 5),
         note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, PRIMARY KEY (course, checklist_id, question_id)`,
        [],
      ],
      [
        'checklist_ratings',
        'id INTEGER PRIMARY KEY AUTOINCREMENT, checklist_id TEXT NOT NULL, question_id TEXT NOT NULL, confidence INTEGER NOT NULL, created_at INTEGER NOT NULL',
        ['CREATE INDEX checklist_ratings_lookup ON checklist_ratings (course, id)'],
      ],
      ['achievements', 'key TEXT NOT NULL, earned_at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0, event TEXT NOT NULL, PRIMARY KEY (course, key)', []],
      [
        'annotations',
        `id TEXT PRIMARY KEY, target TEXT NOT NULL, part TEXT NOT NULL, quote TEXT NOT NULL, prefix TEXT NOT NULL, suffix TEXT NOT NULL,
         color TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', review TEXT CHECK (review IS NULL OR review IN ('open','resolved')),
         created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, label TEXT`,
        ['CREATE INDEX annotations_target ON annotations (course, target)'],
      ],
      ['settings', 'key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (course, key)', []],
    ];
    const settingsCourse = `CASE WHEN key IN (${GLOBAL_KEYS.map((k) => `'${k}'`).join(',')}) THEN '' ELSE '${MOUNTED_COURSE}' END`;
    for (const [table, columns, indexes] of tables) {
      const old = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).join(', ');
      db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`);
      db.exec(`CREATE TABLE ${table} (course TEXT NOT NULL, ${columns})`);
      db.exec(`INSERT INTO ${table} (course, ${old}) SELECT ${table === 'settings' ? settingsCourse : `'${MOUNTED_COURSE}'`}, ${old} FROM ${table}_old ORDER BY rowid`);
      db.exec(`DROP TABLE ${table}_old`);
      for (const index of indexes) db.exec(index);
    }
    db.exec(`
      CREATE VIRTUAL TABLE search_new USING fts5(
        course UNINDEXED, exercise_id UNINDEXED, source UNINDEXED, content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      INSERT INTO search_new (course, exercise_id, source, content) SELECT '${MOUNTED_COURSE}', exercise_id, source, content FROM search;
      DROP TABLE search;
      ALTER TABLE search_new RENAME TO search;
    `);
  },
  /*
   * 11: materials (files the student uploads). Global, like decks; courses are referenced by their id. The files
   * are in `<data>/files/<sha256>`. `current_version` points at the version row in use, so lists need no subquery.
   */ `
  CREATE TABLE resource_series (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('notes','slides','other')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE resources (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('notes','slides','other')),
    author          TEXT NOT NULL DEFAULT '',
    date            TEXT NOT NULL DEFAULT '',
    series          TEXT REFERENCES resource_series(id) ON DELETE SET NULL,
    position        INTEGER NOT NULL DEFAULT 0,
    last_page       INTEGER,
    current_version INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX resources_series ON resources (series, position);
  CREATE TABLE resource_courses (
    resource TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    course   TEXT NOT NULL,
    PRIMARY KEY (resource, course)
  ) WITHOUT ROWID;
  CREATE INDEX resource_courses_course ON resource_courses (course, resource);
  CREATE TABLE resource_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    resource    TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    sha256      TEXT NOT NULL,
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    uploaded_at INTEGER NOT NULL
  );
  CREATE INDEX resource_versions_resource ON resource_versions (resource, uploaded_at);
  CREATE INDEX resource_versions_sha ON resource_versions (sha256);
  `,
  /*
   * 12: highlights in PDFs. Global, like materials: they belong to the resource (and the version of the file they were
   * made on), not to a course. `rects` are JSON, in fractions of the page.
   */ `
  CREATE TABLE pdf_annotations (
    id         TEXT PRIMARY KEY,
    resource   TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    version    TEXT NOT NULL,
    page_index INTEGER NOT NULL,
    rects      TEXT NOT NULL,
    quote      TEXT NOT NULL,
    prefix     TEXT NOT NULL DEFAULT '',
    suffix     TEXT NOT NULL DEFAULT '',
    color      TEXT NOT NULL,
    label      TEXT,
    comment    TEXT NOT NULL DEFAULT '',
    review     TEXT CHECK (review IN ('open','resolved')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX pdf_annotations_page ON pdf_annotations (resource, page_index);
  `,
  /*
   * 13: notes on whole pages and slides of PDFs. Global, like highlights. `marks` is a JSON array of the student's page
   * mark ids; `fingerprint` is what finds the page again in a new version of the file. One row per page.
   */ `
  CREATE TABLE pdf_pages (
    id          TEXT PRIMARY KEY,
    resource    TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    version     TEXT NOT NULL,
    page_index  INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    marks       TEXT NOT NULL DEFAULT '[]',
    review      TEXT CHECK (review IN ('open','resolved')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    UNIQUE (resource, page_index)
  );
  `,
  /*
   * 14: the student's table of contents of a PDF, on top of the outline the file has. A row is an entry of their own
   * (`embedded_key` NULL) or a change to an embedded one (rename, hide, level). `fingerprint` finds the page again in a
   * new version, like page notes.
   */ `
  CREATE TABLE pdf_toc (
    id           TEXT PRIMARY KEY,
    resource     TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    version      TEXT NOT NULL,
    page_index   INTEGER NOT NULL,
    fingerprint  TEXT NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    level        INTEGER,
    hidden       INTEGER NOT NULL DEFAULT 0,
    embedded_key TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX pdf_toc_resource ON pdf_toc (resource);
  CREATE UNIQUE INDEX pdf_toc_embedded ON pdf_toc (resource, embedded_key) WHERE embedded_key IS NOT NULL;
  `,
  /*
   * 15: new versions of a file. A highlight, page item or own TOC entry the new file could not place keeps its old
   * page and is `unplaced` until the student fixes or drops it; such rows are out of every list. Page items lose their
   * one-per-page key for the same reason: it holds for placed ones only.
   */ `
  ALTER TABLE pdf_annotations ADD COLUMN unplaced INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE pdf_toc ADD COLUMN unplaced INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE pdf_pages_new (
    id          TEXT PRIMARY KEY,
    resource    TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    version     TEXT NOT NULL,
    page_index  INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    marks       TEXT NOT NULL DEFAULT '[]',
    review      TEXT CHECK (review IN ('open','resolved')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    unplaced    INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO pdf_pages_new SELECT id, resource, version, page_index, fingerprint, note, marks, review, created_at, updated_at, 0 FROM pdf_pages;
  DROP TABLE pdf_pages;
  ALTER TABLE pdf_pages_new RENAME TO pdf_pages;
  CREATE UNIQUE INDEX pdf_pages_place ON pdf_pages (resource, page_index) WHERE unplaced = 0;
  `,
  /*
   * 16: the student's labels get a table of their own: names for highlights (any scope, with a color) and for kinds
   * of PDF pages (scope `page`). They were two lists in the settings row; ids are kept, so stored references stay valid.
   */ (db) => {
    db.exec(`
    CREATE TABLE labels (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '',
      scope      TEXT NOT NULL CHECK (scope IN ('any','page')),
      sort       INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX labels_scope ON labels (scope, sort);
    `);
    const row = db.prepare("SELECT value FROM settings WHERE course = '' AND key = 'settings'").get() as { value: string } | undefined;
    if (!row) return;
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(row.value) as Record<string, unknown>;
    } catch {
      return;
    }
    const t = Date.now();
    const insert = db.prepare('INSERT OR IGNORE INTO labels (id, name, color, scope, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
    const lists: [string, 'any' | 'page'][] = [['highlightLabels', 'any'], ['pdfPageMarks', 'page']];
    for (const [key, scope] of lists) {
      const list = Array.isArray(settings[key]) ? (settings[key] as { id?: unknown; name?: unknown; color?: unknown }[]) : [];
      list.forEach((l, i) => {
        if (typeof l?.id === 'string') insert.run(l.id, typeof l.name === 'string' ? l.name : '', typeof l.color === 'string' ? l.color : '', scope, i, t, t);
      });
      delete settings[key];
    }
    db.prepare("UPDATE settings SET value = ? WHERE course = '' AND key = 'settings'").run(JSON.stringify(settings));
  },
  /*
   * 17: open questions become a list of their own, global like highlights: a question stores where it was asked
   * (`anchor`, JSON) and the course it belongs to, so a reset of a course's work keeps it. The one question per
   * exercise becomes one row each. `pass_id` groups captures made in one sitting (a new pass after a pause).
   */ (db) => {
    db.exec(`
    CREATE TABLE question_passes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      last_at    INTEGER NOT NULL
    );
    CREATE TABLE questions (
      id           TEXT PRIMARY KEY,
      text         TEXT NOT NULL DEFAULT '',
      anchor       TEXT NOT NULL,
      course       TEXT NOT NULL DEFAULT '',
      highlight_id TEXT,
      pass_id      INTEGER REFERENCES question_passes(id),
      status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
      answer       TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      done_at      INTEGER
    );
    CREATE INDEX questions_course ON questions (course, status);
    CREATE INDEX questions_pass ON questions (pass_id);
    `);
    const insert = db.prepare(
      'INSERT INTO questions (id, text, anchor, course, highlight_id, pass_id, status, answer, created_at, updated_at, done_at) VALUES (?,?,?,?,NULL,NULL,\'open\',NULL,?,?,NULL)',
    );
    const rows = db.prepare('SELECT course, exercise_id, content, updated_at FROM open_questions ORDER BY updated_at').all() as { course: string; exercise_id: string; content: string; updated_at: number }[];
    for (const r of rows) {
      const anchor = JSON.stringify({ kind: 'exercise', course: r.course, id: r.exercise_id });
      insert.run(`q-${randomUUID()}`, r.content, anchor, r.course, r.updated_at, r.updated_at);
    }
    db.exec('DROP TABLE open_questions');
  },
  /*
   * 18: a question on a page of a PDF follows a new version of the file like a highlight; one the new file could not
   * place waits (`unplaced`) to be put on a page or dropped.
   */ (db) => {
    db.exec(`
    ALTER TABLE questions ADD COLUMN unplaced INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX questions_resource ON questions (json_extract(anchor, '$.resource')) WHERE json_extract(anchor, '$.kind') = 'page';
    `);
  },
  /*
   * 19: "come back to" on a highlight or a page is a question without text, linked by `highlight_id` (the id of the
   * highlight or page item), open or done; the `review` columns go. The question keeps a copy of the anchor.
   */ (db) => {
    const insert = db.prepare(
      "INSERT INTO questions (id, text, anchor, course, highlight_id, pass_id, status, answer, created_at, updated_at, done_at, unplaced) VALUES (?,'',?,?,?,NULL,?,NULL,?,?,?,?)",
    );
    const add = (course: string, source: string, anchor: object, review: string, created: number, updated: number, unplaced: number) =>
      insert.run(`q-${randomUUID()}`, JSON.stringify(anchor), course, source, review === 'resolved' ? 'done' : 'open', created, updated, review === 'resolved' ? updated : null, unplaced);
    type R = Record<string, string | number>;
    for (const a of db.prepare('SELECT * FROM annotations WHERE review IS NOT NULL').all() as R[]) {
      const course = String(a.course ?? '');
      add(course, String(a.id), { kind: 'text', course, target: a.target, part: a.part, quote: a.quote, prefix: a.prefix, suffix: a.suffix }, String(a.review), Number(a.created_at), Number(a.updated_at), 0);
    }
    const fingerprint = db.prepare('SELECT fingerprint FROM pdf_pages WHERE resource = ? AND page_index = ? AND unplaced = 0');
    for (const a of db.prepare('SELECT * FROM pdf_annotations WHERE review IS NOT NULL').all() as R[]) {
      const page = fingerprint.get(String(a.resource), Number(a.page_index)) as { fingerprint: string } | undefined;
      const anchor = { kind: 'page', resource: a.resource, version: a.version, pageIndex: a.page_index, fingerprint: page?.fingerprint ?? '', rects: JSON.parse(String(a.rects)), quote: a.quote, prefix: a.prefix, suffix: a.suffix };
      add('', String(a.id), anchor, String(a.review), Number(a.created_at), Number(a.updated_at), Number(a.unplaced ?? 0));
    }
    for (const p of db.prepare('SELECT * FROM pdf_pages WHERE review IS NOT NULL').all() as R[]) {
      add('', String(p.id), { kind: 'page', resource: p.resource, version: p.version, pageIndex: p.page_index, fingerprint: p.fingerprint }, String(p.review), Number(p.created_at), Number(p.updated_at), Number(p.unplaced ?? 0));
    }
    db.exec(`
    ALTER TABLE annotations DROP COLUMN review;
    ALTER TABLE pdf_annotations DROP COLUMN review;
    ALTER TABLE pdf_pages DROP COLUMN review;
    CREATE INDEX questions_source ON questions (highlight_id) WHERE highlight_id IS NOT NULL;
    `);
  },
  /*
   * 20: one search index over everything, global. `search_docs` has one row per searchable text (`ref_kind` + `ref_id`
   * is its key, `course` NULL for what belongs to no course, `anchor` says where it is); `search` is the FTS5 index
   * over it. Triggers on the source tables keep it current, so no write path can forget it. A migration that rebuilds
   * one of these tables must create its triggers again. `resource_text` is the text of a material's pages, extracted
   * by the server once per version (`resource_text_state` says it was tried, so a failure is not retried).
   */ (db) => {
    db.exec(`
    CREATE TABLE resource_text (
      resource   TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      version    TEXT NOT NULL,
      page_index INTEGER NOT NULL,
      text       TEXT NOT NULL,
      PRIMARY KEY (resource, version, page_index)
    ) WITHOUT ROWID;
    CREATE TABLE resource_text_state (
      resource TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      version  TEXT NOT NULL,
      status   TEXT NOT NULL CHECK (status IN ('done','failed')),
      PRIMARY KEY (resource, version)
    ) WITHOUT ROWID;
    DROP TABLE search;
    CREATE TABLE search_docs (
      id       INTEGER PRIMARY KEY,
      ref_kind TEXT NOT NULL,
      ref_id   TEXT NOT NULL,
      course   TEXT,
      anchor   TEXT NOT NULL,
      source   TEXT NOT NULL,
      content  TEXT NOT NULL
    );
    CREATE UNIQUE INDEX search_docs_ref ON search_docs (ref_kind, ref_id);
    CREATE VIRTUAL TABLE search USING fts5(
      content, content = 'search_docs', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER search_docs_ai AFTER INSERT ON search_docs BEGIN
      INSERT INTO search (rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER search_docs_ad AFTER DELETE ON search_docs BEGIN
      INSERT INTO search (search, rowid, content) VALUES ('delete', old.id, old.content);
    END;
    `);
    const page = (r: string) => `json_object('kind','page','resource',${r}.resource,'pageIndex',${r}.page_index,'id',${r}.id)`;
    const sources: { table: string; kind: string; ref: (r: string) => string; course: (r: string) => string; anchor: (r: string) => string; source: string; content: (r: string) => string; when: (r: string) => string; touch: string }[] = [
      { table: 'notes', kind: 'note', ref: (r) => `${r}.course || '/' || ${r}.exercise_id`, course: (r) => `NULLIF(${r}.course, '')`, anchor: (r) => `json_object('kind','exercise','course',${r}.course,'id',${r}.exercise_id)`, source: 'note', content: (r) => `${r}.content`, when: () => '1', touch: 'content' },
      { table: 'answers', kind: 'answer', ref: (r) => `${r}.course || '/' || ${r}.exercise_id || '#' || ${r}.slot`, course: (r) => `NULLIF(${r}.course, '')`, anchor: (r) => `json_object('kind','exercise','course',${r}.course,'id',${r}.exercise_id,'slot',${r}.slot)`, source: 'answer', content: (r) => `${r}.content`, when: () => '1', touch: 'content' },
      { table: 'annotations', kind: 'highlight', ref: (r) => `${r}.course || '/' || ${r}.id`, course: (r) => `NULLIF(${r}.course, '')`, anchor: (r) => `json_object('kind','text','course',${r}.course,'target',${r}.target,'id',${r}.id)`, source: 'annotation', content: (r) => `${r}.quote || char(10) || ${r}.comment`, when: () => '1', touch: 'quote' },
      { table: 'pdf_annotations', kind: 'pdf-highlight', ref: (r) => `${r}.id`, course: () => 'NULL', anchor: page, source: 'annotation', content: (r) => `${r}.quote || char(10) || ${r}.comment`, when: (r) => `${r}.unplaced = 0`, touch: 'quote' },
      { table: 'pdf_pages', kind: 'pdf-page', ref: (r) => `${r}.id`, course: () => 'NULL', anchor: page, source: 'note', content: (r) => `${r}.note`, when: (r) => `${r}.unplaced = 0`, touch: 'note' },
      { table: 'questions', kind: 'question', ref: (r) => `${r}.id`, course: (r) => `NULLIF(${r}.course, '')`, anchor: (r) => `json_set(${r}.anchor, '$.questionId', ${r}.id)`, source: 'question', content: (r) => `${r}.text || char(10) || COALESCE(${r}.answer, '')`, when: (r) => `${r}.unplaced = 0`, touch: 'text' },
      { table: 'resource_text', kind: 'material', ref: (r) => `${r}.resource || '/' || ${r}.page_index`, course: () => 'NULL', anchor: (r) => `json_object('kind','page','resource',${r}.resource,'pageIndex',${r}.page_index)`, source: 'material', content: (r) => `${r}.text`, when: () => '1', touch: 'text' },
    ];
    for (const s of sources) {
      const drop = (r: string) => `DELETE FROM search_docs WHERE ref_kind = '${s.kind}' AND ref_id = ${s.ref(r)};`;
      const add = (r: string) => `INSERT INTO search_docs (ref_kind, ref_id, course, anchor, source, content) SELECT '${s.kind}', ${s.ref(r)}, ${s.course(r)}, ${s.anchor(r)}, '${s.source}', ${s.content(r)} WHERE ${s.when(r)} AND trim(${s.content(r)}) <> '';`;
      db.exec(`
      CREATE TRIGGER ${s.table}_search_ai AFTER INSERT ON ${s.table} BEGIN ${drop('new')} ${add('new')} END;
      CREATE TRIGGER ${s.table}_search_au AFTER UPDATE ON ${s.table} BEGIN ${drop('old')} ${drop('new')} ${add('new')} END;
      CREATE TRIGGER ${s.table}_search_ad AFTER DELETE ON ${s.table} BEGIN ${drop('old')} END;
      UPDATE ${s.table} SET ${s.touch} = ${s.touch};
      `);
    }
  },
  /*
   * 21: what an assistant (through the bridge) keeps for itself: digests per material or workbook. Never shown as
   * the student's content; the student can read and delete them in settings.
   */ `
  CREATE TABLE assistant_digests (
    id         TEXT PRIMARY KEY,
    resource   TEXT,
    course     TEXT,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];

/** The course a mounted `/content` folder is. */
export const MOUNTED_COURSE = 'content';

/** Settings rows that belong to the student, not to a course (stored with course ''). */
export const GLOBAL_KEYS = ['settings', 'courses', 'activeCourse', 'importedLegacy'];

/**
 * Tables with a `course` column that a reset of the course's work keeps: what the student made on the course's text
 * (highlights) belongs to the student, the column only says where it was made. Old files are still imported with them.
 */
export const COURSE_REFERENCE_TABLES = ['annotations'];

/** Tables whose rows belong to one course, all with `course` as their first column. */
export const COURSE_TABLES = [
  'progress',
  'answers',
  'answer_versions',
  'notes',
  'reflections',
  'stats',
  'check_history',
  'checklist_answers',
  'checklist_ratings',
  'achievements',
  'settings',
];

/** Brings a database up to the current schema. */
export function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      const step = MIGRATIONS[v]!;
      if (typeof step === 'string') db.exec(step);
      else step(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
