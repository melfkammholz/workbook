import { randomUUID } from 'node:crypto';
import {
  type Tag,
  type TagKind,
} from '@wb/shared';
import type { Store } from '../store.js';

export class TagsPart {
  // ───────────────────────── tags ─────────────────────────

  /** The student's tags in their order. Global, like decks: a tag is not tied to a course. */
  listTags(this: Store): Tag[] {
    return this.all('SELECT id, name, color FROM tags ORDER BY sort, id').map((r) => ({ id: r.id as string, name: r.name as string, color: r.color as string }));
  }

  /** The tag of this name (any case), made if there is none. Returns its id. */
  ensureTag(this: Store, name: string): string {
    name = name.trim().slice(0, 60);
    const found = this.get('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', name);
    if (found) return found.id as string;
    return this.createTag(name, '').id;
  }

  createTag(this: Store, name: string, color: string): Tag {
    const t = this.now();
    const id = `tg-${randomUUID()}`;
    const sort = Number(this.get('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM tags')!.n);
    this.run('INSERT INTO tags (id, name, color, sort, created_at, updated_at) VALUES (?,?,?,?,?,?)', id, name.trim().slice(0, 60), color, sort, t, t);
    return { id, name: name.trim().slice(0, 60), color };
  }

  /** Changes a tag's name or color. False when it is unknown or the name is another tag's (any case). */
  updateTag(this: Store, id: string, patch: { name?: string; color?: string }): boolean {
    const cur = this.get('SELECT name, color FROM tags WHERE id = ?', id);
    if (!cur) return false;
    const name = (patch.name ?? (cur.name as string)).trim().slice(0, 60);
    if (!name) return false;
    if (this.get('SELECT 1 AS x FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?', name, id)) return false;
    this.run('UPDATE tags SET name = ?, color = ?, updated_at = ? WHERE id = ?', name, patch.color ?? (cur.color as string), this.now(), id);
    return true;
  }

  /** Deletes a tag from everything it is on. */
  deleteTag(this: Store, id: string): boolean {
    return this.tx(() => {
      const had = this.get('SELECT 1 AS x FROM tags WHERE id = ?', id) !== null;
      this.run('DELETE FROM tag_links WHERE tag_id = ?', id);
      this.run('DELETE FROM tags WHERE id = ?', id);
      return had;
    });
  }

  /** Everything `from` is on gets `into` instead; `from` goes. */
  mergeTags(this: Store, from: string, into: string): boolean {
    if (from === into || !this.get('SELECT 1 AS x FROM tags WHERE id = ?', from) || !this.get('SELECT 1 AS x FROM tags WHERE id = ?', into)) return false;
    this.tx(() => {
      this.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, ref, created_at) SELECT ?, kind, ref, created_at FROM tag_links WHERE tag_id = ?', into, from);
      this.deleteTag(from);
    });
    return true;
  }

  /** The ids of the tags on one thing, oldest link first. */
  tagsOf(this: Store, kind: TagKind, ref: string): string[] {
    return this.all('SELECT tag_id FROM tag_links WHERE kind = ? AND ref = ? ORDER BY created_at, tag_id', kind, ref).map((r) => r.tag_id as string);
  }

  /** The tags on every thing of one kind: ref to tag ids. */
  tagLinks(this: Store, kind: TagKind): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const r of this.all('SELECT tag_id, ref FROM tag_links WHERE kind = ? ORDER BY created_at, tag_id', kind)) {
      const ref = r.ref as string;
      (out.get(ref) ?? out.set(ref, []).get(ref)!).push(r.tag_id as string);
    }
    return out;
  }

  /** Makes the tags on one thing exactly these (unknown ids are skipped). */
  setTags(this: Store, kind: TagKind, ref: string, ids: string[]): void {
    this.tx(() => {
      const keep = [...new Set(ids)];
      for (const id of this.tagsOf(kind, ref)) if (!keep.includes(id)) this.run('DELETE FROM tag_links WHERE tag_id = ? AND kind = ? AND ref = ?', id, kind, ref);
      const t = this.now();
      for (const id of keep) this.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, ref, created_at) SELECT id, ?, ?, ? FROM tags WHERE id = ?', kind, ref, t, id);
    });
  }

  /** Takes every tag off one thing, for when it is deleted. */
  unlinkAll(this: Store, kind: TagKind, ref: string): void {
    this.run('DELETE FROM tag_links WHERE kind = ? AND ref = ?', kind, ref);
  }

}
