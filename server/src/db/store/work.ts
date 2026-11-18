import {
  type AnswerVersion,
  type ChecklistAnswer,
  type Focus,
  type HowSolved,
  type NoteDoc,
  type NoteFormat,
  type ProgressEntry,
  type Reflection,
  type Stats,
  type Status,
  type StudentState,
} from '@wb/shared';
import type { Store } from '../store.js';
import { DAY, REVIEW_DAYS, VERSION_MIN_GAP, MAX_VERSIONS, MAX_TICK_SECONDS, rowToProgress, rowToReflection, emptyStats, rowToStats } from './shared.js';

export class WorkPart {
  // ───────────────────────── state ─────────────────────────

  getState(this: Store): StudentState {
    const c = this.course;
    const progress: Record<string, ProgressEntry> = {};
    for (const r of this.all('SELECT * FROM progress WHERE course = ?', c)) progress[r.exercise_id as string] = rowToProgress(r);

    const reflections: Record<string, Reflection> = {};
    for (const r of this.all(
      'SELECT * FROM reflections WHERE id IN (SELECT MAX(id) FROM reflections WHERE course = ? GROUP BY exercise_id)',
      c,
    ))
      reflections[r.exercise_id as string] = rowToReflection(r);

    const stats: Record<string, Stats> = {};
    for (const r of this.all('SELECT * FROM stats WHERE course = ?', c)) stats[r.exercise_id as string] = rowToStats(r);

    const checklists: StudentState['checklists'] = {};
    for (const r of this.all('SELECT * FROM checklist_answers WHERE course = ?', c))
      (checklists[r.checklist_id as string] ??= {})[r.question_id as string] = {
        confidence: r.confidence === null ? null : (Number(r.confidence) as ChecklistAnswer['confidence']),
        note: r.note as string,
        updatedAt: Number(r.updated_at),
      };

    return {
      progress,
      checklists,
      landingSeen: this.getSettingRaw<boolean>('landingSeen', false),
      focus: this.getSettingRaw<Focus | null>('focus', null),
      questions: this.listTickets({ course: this.course }),
      reflections,
      stats,
      lastOpenedId: this.getSettingRaw<string | null>('lastOpenedId', null),
    };
  }

  // ───────────────────────── progress ─────────────────────────

  getProgress(this: Store, id: string): ProgressEntry | null {
    const r = this.get('SELECT * FROM progress WHERE course = ? AND exercise_id = ?', this.course, id);
    return r ? rowToProgress(r) : null;
  }

  setStatus(this: Store, id: string, status: Status): ProgressEntry {
    const prev = this.getProgress(id);
    const t = this.now();
    let reviewCount = prev?.reviewCount ?? 0;
    let due: number | null = null;
    if (status === 'review') {
      reviewCount += 1;
      due = t + REVIEW_DAYS[Math.min(reviewCount - 1, REVIEW_DAYS.length - 1)]! * DAY;
    }
    this.run(
      `INSERT INTO progress (course, exercise_id, status, updated_at, review_due_at, review_count) VALUES (?,?,?,?,?,?)
       ON CONFLICT(course, exercise_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at,
         review_due_at=excluded.review_due_at, review_count=excluded.review_count`,
      this.course,
      id,
      status,
      t,
      due,
      reviewCount,
    );
    return this.getProgress(id)!;
  }

  /** Called when the student starts working: a "todo" exercise becomes "in progress". */
  noteActivity(this: Store, id: string): void {
    const p = this.getProgress(id);
    if (!p) this.setStatus(id, 'in_progress');
    else if (p.status === 'todo') this.setStatus(id, 'in_progress');
  }

  // ───────────────────────── answers ─────────────────────────

  getAnswers(this: Store, id: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.all('SELECT slot, content FROM answers WHERE course = ? AND exercise_id = ?', this.course, id)) out[r.slot as string] = r.content as string;
    return out;
  }

  /**
   * Saves the current content of an answer slot. History entries are only
   * written for meaningful moments (`reason` ≠ autosave) or when the last one
   * is old enough, so typing does not flood the history.
   */
  saveAnswer(this: Store, id: string, slot: string, content: string, reason = 'autosave'): void {
    const c = this.course;
    const t = this.now();
    const prev = this.get('SELECT content FROM answers WHERE course = ? AND exercise_id = ? AND slot = ?', c, id, slot);
    if (prev?.content === content && reason === 'autosave') return;
    this.tx(() => {
      this.run(
        `INSERT INTO answers (course, exercise_id, slot, content, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(course, exercise_id, slot) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at`,
        c,
        id,
        slot,
        content,
        t,
      );
      const last = this.get(
        'SELECT content, created_at FROM answer_versions WHERE course = ? AND exercise_id = ? AND slot = ? ORDER BY id DESC LIMIT 1',
        c,
        id,
        slot,
      );
      const changed = last?.content !== content;
      const due = reason !== 'autosave' || !last || t - Number(last.created_at) >= VERSION_MIN_GAP;
      // An attempt set aside for trying again is always kept as such, even if it is the same as the last version.
      if ((changed && due) || reason === 'retry') {
        this.run('INSERT INTO answer_versions (course, exercise_id, slot, content, reason, created_at) VALUES (?,?,?,?,?,?)', c, id, slot, content, reason, t);
        this.run(
          `DELETE FROM answer_versions WHERE course = ? AND exercise_id = ? AND slot = ? AND id NOT IN
             (SELECT id FROM answer_versions WHERE course = ? AND exercise_id = ? AND slot = ? ORDER BY id DESC LIMIT ?)`,
          c,
          id,
          slot,
          c,
          id,
          slot,
          MAX_VERSIONS,
        );
      }
    });
  }

  listVersions(this: Store, id: string, slot: string): AnswerVersion[] {
    return this.all(
      'SELECT id, slot, content, reason, created_at FROM answer_versions WHERE course = ? AND exercise_id = ? AND slot = ? ORDER BY id DESC',
      this.course,
      id,
      slot,
    ).map((r) => ({
      id: Number(r.id),
      slot: r.slot as string,
      content: r.content as string,
      reason: r.reason as string,
      createdAt: Number(r.created_at),
    }));
  }

  // ───────────────────────── notes ─────────────────────────

  getNote(this: Store, id: string): NoteDoc | null {
    const r = this.get('SELECT format, content, updated_at FROM notes WHERE course = ? AND exercise_id = ?', this.course, id);
    return r ? { format: r.format as NoteFormat, content: r.content as string, updatedAt: Number(r.updated_at) } : null;
  }

  saveNote(this: Store, id: string, format: NoteFormat, content: string): void {
    this.tx(() => {
      if (content.trim() === '') {
        this.run('DELETE FROM notes WHERE course = ? AND exercise_id = ?', this.course, id);
      } else {
        this.run(
          `INSERT INTO notes (course, exercise_id, format, content, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(course, exercise_id) DO UPDATE SET format=excluded.format, content=excluded.content, updated_at=excluded.updated_at`,
          this.course,
          id,
          format,
          content,
          this.now(),
        );
      }
    });
  }

  // ───────────────────────── reflections ─────────────────────────

  addReflection(this: Store, id: string, confidence: number, how: HowSolved[], comment: string): Reflection {
    if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) throw new RangeError('confidence must be 1–5');
    this.run(
      'INSERT INTO reflections (course, exercise_id, confidence, how, comment, created_at) VALUES (?,?,?,?,?,?)',
      this.course,
      id,
      confidence,
      JSON.stringify(how),
      comment.slice(0, 2000),
      this.now(),
    );
    return rowToReflection(this.get('SELECT * FROM reflections WHERE course = ? AND exercise_id = ? ORDER BY id DESC LIMIT 1', this.course, id)!);
  }

  listReflections(this: Store, id?: string): Reflection[] {
    const rows = id
      ? this.all('SELECT * FROM reflections WHERE course = ? AND exercise_id = ? ORDER BY id', this.course, id)
      : this.all('SELECT * FROM reflections WHERE course = ? ORDER BY id', this.course);
    return rows.map(rowToReflection);
  }

  // ───────────────────────── checklists ─────────────────────────

  /** Clearing both the rating and the note removes the answer. */
  saveChecklistAnswer(this: Store, checklistId: string, questionId: string, confidence: number | null, note: string): void {
    if (confidence !== null && (!Number.isInteger(confidence) || confidence < 1 || confidence > 5)) throw new RangeError('confidence must be 1–5');
    const c = this.course;
    const text = note.slice(0, 4000);
    // Kept whatever the settings say, so a comeback can be noticed if achievements are turned on later.
    const previous = this.get('SELECT confidence FROM checklist_answers WHERE course = ? AND checklist_id = ? AND question_id = ?', c, checklistId, questionId);
    if (confidence !== null && previous?.confidence !== confidence)
      this.run('INSERT INTO checklist_ratings (course, checklist_id, question_id, confidence, created_at) VALUES (?,?,?,?,?)', c, checklistId, questionId, confidence, this.now());
    if (confidence === null && !text.trim()) {
      this.run('DELETE FROM checklist_answers WHERE course = ? AND checklist_id = ? AND question_id = ?', c, checklistId, questionId);
      return;
    }
    this.run(
      `INSERT INTO checklist_answers (course, checklist_id, question_id, confidence, note, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(course, checklist_id, question_id) DO UPDATE SET confidence=excluded.confidence, note=excluded.note, updated_at=excluded.updated_at`,
      c,
      checklistId,
      questionId,
      confidence,
      text,
      this.now(),
    );
  }

  listChecklistRatings(this: Store): { checklistId: string; questionId: string; confidence: number }[] {
    return this.all('SELECT checklist_id, question_id, confidence FROM checklist_ratings WHERE course = ? ORDER BY id', this.course).map((r) => ({
      checklistId: r.checklist_id as string,
      questionId: r.question_id as string,
      confidence: Number(r.confidence),
    }));
  }

  // ───────────────────────── stats ─────────────────────────

  ensureStats(this: Store, id: string): void {
    this.run('INSERT OR IGNORE INTO stats (course, exercise_id) VALUES (?,?)', this.course, id);
  }

  getStats(this: Store, id: string): Stats {
    const r = this.get('SELECT * FROM stats WHERE course = ? AND exercise_id = ?', this.course, id);
    return r ? rowToStats(r) : emptyStats();
  }

  recordOpen(this: Store, id: string): void {
    const t = this.now();
    this.tx(() => {
      this.ensureStats(id);
      this.run('UPDATE stats SET last_opened_at = ?, first_opened_at = COALESCE(first_opened_at, ?) WHERE course = ? AND exercise_id = ?', t, t, this.course, id);
      this.setSetting('lastOpenedId', id);
    });
  }

  addActiveSeconds(this: Store, id: string, seconds: number): void {
    const s = Math.max(0, Math.min(MAX_TICK_SECONDS, Math.floor(seconds)));
    if (s === 0) return;
    this.ensureStats(id);
    this.run('UPDATE stats SET active_seconds = active_seconds + ? WHERE course = ? AND exercise_id = ?', s, this.course, id);
  }

  /** The student's own choice, from the timer. Nothing else about the exercise changes. */
  resetActiveTime(this: Store, id: string): void {
    this.run('UPDATE stats SET active_seconds = 0 WHERE course = ? AND exercise_id = ?', this.course, id);
  }

  /** `count` is how many hints are now visible; only ever grows. */
  recordHints(this: Store, id: string, count: number): void {
    this.ensureStats(id);
    this.run('UPDATE stats SET hints_revealed = MAX(hints_revealed, ?) WHERE course = ? AND exercise_id = ?', Math.max(0, Math.floor(count)), this.course, id);
  }

  recordSolutionViewed(this: Store, id: string): void {
    this.ensureStats(id);
    this.run('UPDATE stats SET solution_viewed_at = COALESCE(solution_viewed_at, ?) WHERE course = ? AND exercise_id = ?', this.now(), this.course, id);
  }

  recordCheckRun(this: Store, id: string, passed: number, total: number): void {
    this.tx(() => {
      this.ensureStats(id);
      this.run('INSERT INTO check_history (course, exercise_id, at, passed, total) VALUES (?,?,?,?,?)', this.course, id, this.now(), passed, total);
      this.run(
        'UPDATE stats SET check_runs = check_runs + 1, check_passes = check_passes + ? WHERE course = ? AND exercise_id = ?',
        total > 0 && passed === total ? 1 : 0,
        this.course,
        id,
      );
    });
  }

}
