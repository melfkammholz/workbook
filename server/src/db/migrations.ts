/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many
 * have run. Never edit a released migration: append a new one.
 */
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
];
