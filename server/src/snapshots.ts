import fs from 'node:fs';
import path from 'node:path';
import type { SnapshotInfo } from '@wb/shared';
import type { Store } from './db/store.js';

/** How many days and weeks of snapshots stay. */
export const KEEP_DAILY = 7;
export const KEEP_WEEKLY = 4;

const DB_FILE = 'workbook.db';
const MANIFEST = 'files.json';
const ID = /^(\d{4}-\d{2}-\d{2})(-\d{6})?$/;

interface Manifest {
  takenAt: number;
  reason: SnapshotInfo['reason'];
  /** The names (sha256) of the uploaded files at the time, kept once in `snapshots/files/`. */
  files: string[];
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The student's local day, which is what "the first start of each day" means. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The Monday of a day's week, so weeks can be told apart without week numbers. */
function weekOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * Which snapshots stay: the newest of each of the last `KEEP_DAILY` days that have one, and the newest of each of the
 * last `KEEP_WEEKLY` weeks that have one (the two may overlap). Days without a start simply have no snapshot, so
 * "the last 7 days" are the last 7 days the app ran.
 */
export function retained(ids: string[]): Set<string> {
  const newest = (key: (id: string) => string, count: number) => {
    const byKey = new Map<string, string>();
    for (const id of [...ids].sort()) byKey.set(key(id), id);
    return [...byKey.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, count).map(([, id]) => id);
  };
  const day = (id: string) => id.slice(0, 10);
  return new Set([...newest(day, KEEP_DAILY), ...newest((id) => weekOf(day(id)), KEEP_WEEKLY)]);
}

/**
 * Automatic backups inside the data folder: the whole database (`VACUUM INTO`) and the uploaded files in
 * `<data>/files/`, which are named by their hash and so kept once for all snapshots in `snapshots/files/`.
 */
export class Snapshots {
  readonly dir: string;
  private readonly filesDir: string;
  private readonly keptFiles: string;

  constructor(
    private readonly dataDir: string,
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {
    this.dir = path.join(dataDir, 'snapshots');
    this.filesDir = path.join(dataDir, 'files');
    this.keptFiles = path.join(this.dir, 'files');
  }

  /** Newest first. */
  list(): SnapshotInfo[] {
    const out: SnapshotInfo[] = [];
    for (const id of this.ids()) {
      const manifest = this.manifest(id);
      if (!manifest) continue;
      let bytes = fs.statSync(path.join(this.dir, id, DB_FILE)).size;
      for (const f of manifest.files) bytes += fs.statSync(path.join(this.keptFiles, f), { throwIfNoEntry: false })?.size ?? 0;
      out.push({ id, takenAt: manifest.takenAt, bytes, reason: manifest.reason });
    }
    return out.sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  /** Once a day: a snapshot unless today has one, then the old ones go. Returns the new one's id. */
  daily(): string | null {
    const today = dayOf(this.now());
    if (this.ids().some((id) => id.startsWith(today))) return null;
    const id = this.take(today, 'daily');
    this.prune();
    return id;
  }

  /**
   * Puts the database back as it was in a snapshot, after taking one more of how it is now. Uploaded files the
   * snapshot had come back; files added since stay. The caller reloads whatever it built from the database.
   */
  async restore(id: string): Promise<string> {
    const manifest = ID.test(id) ? this.manifest(id) : null;
    if (!manifest) throw new Error('unknown-snapshot');
    const t = new Date(this.now());
    const before = this.take(`${dayOf(t.getTime())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`, 'before-restore');
    await this.store.restoreFrom(path.join(this.dir, id, DB_FILE));
    fs.mkdirSync(this.filesDir, { recursive: true });
    for (const f of manifest.files) {
      const target = path.join(this.filesDir, f);
      if (!fs.existsSync(target)) linkOrCopy(path.join(this.keptFiles, f), target);
    }
    return before;
  }

  /** Removes what `retained` does not keep, and kept files no snapshot names any more. */
  prune(): void {
    const ids = this.ids();
    const keep = retained(ids);
    for (const id of ids) if (!keep.has(id)) fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
    if (!fs.existsSync(this.keptFiles)) return;
    const used = new Set([...keep].flatMap((id) => this.manifest(id)?.files ?? []));
    for (const f of fs.readdirSync(this.keptFiles)) if (!used.has(f)) fs.rmSync(path.join(this.keptFiles, f), { force: true });
  }

  /** Written into a temporary folder and then moved, so a half-written snapshot never shows up. */
  private take(id: string, reason: SnapshotInfo['reason']): string {
    const final = path.join(this.dir, id);
    if (fs.existsSync(final)) return id;
    const tmp = `${final}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    this.store.snapshotTo(path.join(tmp, DB_FILE));
    const files = fs.existsSync(this.filesDir) ? fs.readdirSync(this.filesDir).filter((f) => fs.statSync(path.join(this.filesDir, f)).isFile()) : [];
    if (files.length) fs.mkdirSync(this.keptFiles, { recursive: true });
    for (const f of files) {
      const kept = path.join(this.keptFiles, f);
      if (!fs.existsSync(kept)) linkOrCopy(path.join(this.filesDir, f), kept);
    }
    const manifest: Manifest = { takenAt: this.now(), reason, files };
    fs.writeFileSync(path.join(tmp, MANIFEST), JSON.stringify(manifest));
    fs.renameSync(tmp, final);
    return id;
  }

  private ids(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((n) => ID.test(n));
  }

  private manifest(id: string): Manifest | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, id, MANIFEST), 'utf8')) as Manifest;
    } catch {
      return null;
    }
  }
}

/** A hard link costs no space; across file systems it has to be a copy. */
function linkOrCopy(from: string, to: string): void {
  try {
    fs.linkSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
  }
}
