import { randomUUID } from 'node:crypto';
import {
  type AchievementEvent,
  type Annotation,
  type AnnotationColor,
  type AnnotationPlace,
  type AnnotationReview,
  type EarnedEvent,
  type Focus,
  type TextQuote,
} from '@wb/shared';
import type { Store } from '../store.js';
import { rowToAnnotation } from './shared.js';

export class AnnotationsPart {
  // ───────────────────────── annotations ─────────────────────────

  listAnnotations(this: Store, target?: string): Annotation[] {
    const rows = target
      ? this.all('SELECT * FROM annotations WHERE course = ? AND target = ? ORDER BY created_at, id', this.course, target)
      : this.all('SELECT * FROM annotations WHERE course = ? ORDER BY created_at, id', this.course);
    const reviews = this.reviews();
    const tags = this.tagLinks('highlight');
    return rows.map((r) => rowToAnnotation(r, reviews, tags.get(r.id as string) ?? []));
  }

  getAnnotation(this: Store, id: string): Annotation | null {
    const r = this.get('SELECT * FROM annotations WHERE id = ? AND course = ?', id, this.course);
    return r ? rowToAnnotation(r, this.reviews(), this.tagsOf('highlight', id)) : null;
  }

  addAnnotation(this: Store, a: AnnotationPlace & TextQuote & { id?: string; color: AnnotationColor; tags?: string[]; comment?: string; review?: AnnotationReview | null }): Annotation {
    const id = a.id ?? randomUUID();
    const t = this.now();
    this.tx(() => {
      this.run(
        'INSERT INTO annotations (course, id, target, part, quote, prefix, suffix, color, comment, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        this.course,
        id,
        a.target,
        a.part,
        a.quote,
        a.prefix,
        a.suffix,
        a.color,
        (a.comment ?? '').slice(0, 4000),
        t,
        t,
      );
      if (a.tags?.length) this.setTags('highlight', id, a.tags);
      if (a.review) this.setReview(id, a.review, this.textAnchor(id));
    });
    return this.getAnnotation(id)!;
  }

  /** Null when there is no such annotation. */
  updateAnnotation(this: Store, id: string, patch: { color?: AnnotationColor; tags?: string[]; comment?: string; review?: AnnotationReview | null }): Annotation | null {
    const prev = this.getAnnotation(id);
    if (!prev) return null;
    const next = { ...prev, ...patch, comment: (patch.comment ?? prev.comment).slice(0, 4000) };
    this.tx(() => {
      this.run(
        'UPDATE annotations SET color = ?, comment = ?, updated_at = ? WHERE id = ? AND course = ?',
        next.color,
        next.comment,
        this.now(),
        id,
        this.course,
      );
      if (patch.tags) this.setTags('highlight', id, patch.tags);
      if (patch.review !== undefined) this.setReview(id, patch.review, this.textAnchor(id));
    });
    return this.getAnnotation(id);
  }

  deleteAnnotation(this: Store, id: string): boolean {
    const prev = this.getAnnotation(id);
    if (!prev) return false;
    this.tx(() => {
      this.run('DELETE FROM annotations WHERE id = ? AND course = ?', id, this.course);
      this.unlinkAll('highlight', id);
    });
    return true;
  }

  resolvedMarkCount(this: Store): number {
    return Number(this.get("SELECT COUNT(*) AS n FROM tickets q JOIN annotations a ON a.id = q.highlight_id AND a.course = q.course WHERE q.course = ? AND q.archived = 1 AND q.merged_into IS NULL", this.course)!.n);
  }

  noteCount(this: Store): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM notes WHERE course = ?', this.course)!.n);
  }

  // ───────────────────────── achievements ─────────────────────────

  /**
   * Records what was newly earned. Earned stays earned: nothing is ever removed here.
   * The first time in a course, what already qualifies counts as seen, so turning
   * this on does not set off a burst of celebrations.
   */
  syncAchievements(this: Store, qualifying: Map<string, AchievementEvent>): void {
    const first = !this.getSettingRaw<boolean>('achievementsStarted', false);
    this.tx(() => {
      for (const [key, event] of qualifying)
        this.run('INSERT OR IGNORE INTO achievements (course, key, earned_at, seen, event) VALUES (?,?,?,?,?)', this.course, key, this.now(), first ? 1 : 0, JSON.stringify(event));
      if (first) this.setSetting('achievementsStarted', true);
    });
  }

  listAchievements(this: Store): (EarnedEvent & { seen: boolean })[] {
    return this.all('SELECT * FROM achievements WHERE course = ? ORDER BY earned_at, key', this.course).map((r) => ({
      key: r.key as string,
      earnedAt: Number(r.earned_at),
      seen: Number(r.seen) === 1,
      event: JSON.parse(r.event as string) as AchievementEvent,
    }));
  }

  markAchievementsSeen(this: Store): void {
    this.run('UPDATE achievements SET seen = 1 WHERE course = ? AND seen = 0', this.course);
  }

  markLandingSeen(this: Store): void {
    this.setSetting('landingSeen', true);
  }

  /** Per course, like all work: a student may want all of one course and the essentials of another. */
  setFocus(this: Store, focus: Focus): void {
    this.setSetting('focus', focus);
  }

}
