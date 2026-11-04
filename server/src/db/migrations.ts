/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many
 * have run. Never edit a released migration: append a new one.
 */
export const MIGRATIONS: string[] = [
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
];
