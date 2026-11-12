// The table of contents of an uploaded PDF: the outline embedded in the file, with the student's edits on top. Pure.

export const MAX_TOC_LEVEL = 2;
export const MAX_TOC_TITLE = 200;

/** One entry of the outline as the file has it (levels beyond `MAX_TOC_LEVEL` are cut to it). */
export interface EmbeddedTocEntry {
  title: string;
  /** 0-based. */
  pageIndex: number;
  level: number;
}

/**
 * What the student stored: an entry of their own (`embeddedKey` null) or a change to an embedded one (`title` empty and
 * `level` null mean "as in the file").
 */
export interface TocEdit {
  id: string;
  resource: string;
  /** The sha256 of the file the entry was made on. */
  version: string;
  pageIndex: number;
  fingerprint: string;
  title: string;
  level: number | null;
  hidden: boolean;
  embeddedKey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TocEditFields {
  version: string;
  fingerprint: string;
  pageIndex: number;
  title?: string;
  level?: number | null;
  hidden?: boolean;
  embeddedKey?: string | null;
  /** Made by the client so the entry shows before the server has answered. */
  id?: string;
}

/** An entry as shown: the file's or the student's, with edits applied. */
export interface TocEntry {
  /** Of the embedded entry it stands for, or `own:` plus the id of the student's. */
  key: string;
  /** The stored edit it comes from, if any. */
  editId: string | null;
  title: string;
  pageIndex: number;
  level: number;
  hidden: boolean;
  own: boolean;
  /** The title the file gives it, for "as in the file". */
  embeddedTitle: string | null;
}

/** Identifies an embedded entry across visits; the same title on the same page twice is told by its count. */
export function embeddedKeys(embedded: readonly EmbeddedTocEntry[]): string[] {
  const seen = new Map<string, number>();
  return embedded.map((e) => {
    const base = `${e.pageIndex}:${e.title}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}

const clampLevel = (n: number) => Math.min(MAX_TOC_LEVEL, Math.max(0, Math.round(n)));

/**
 * The embedded outline with the student's edits on top, in reading order (by page; on one page the file's entries come
 * first, then the student's, each in the order they were made). Edits of entries the file no longer has are dropped.
 */
export function mergeToc(embedded: readonly EmbeddedTocEntry[] | null, edits: readonly TocEdit[]): TocEntry[] {
  const keys = embedded ? embeddedKeys(embedded) : [];
  const byKey = new Map<string, TocEdit>();
  for (const e of edits) if (e.embeddedKey !== null) byKey.set(e.embeddedKey, e);
  const out: (TocEntry & { order: number })[] = [];
  (embedded ?? []).forEach((e, i) => {
    const edit = byKey.get(keys[i]!);
    out.push({
      key: keys[i]!,
      editId: edit?.id ?? null,
      title: edit?.title.trim() ? edit.title : e.title,
      pageIndex: e.pageIndex,
      level: clampLevel(edit?.level ?? e.level),
      hidden: edit?.hidden ?? false,
      own: false,
      embeddedTitle: e.title,
      order: i,
    });
  });
  const own = edits.filter((e) => e.embeddedKey === null).sort((a, b) => a.createdAt - b.createdAt);
  own.forEach((e, i) =>
    out.push({ key: `own:${e.id}`, editId: e.id, title: e.title, pageIndex: e.pageIndex, level: clampLevel(e.level ?? 0), hidden: e.hidden, own: true, embeddedTitle: null, order: 1_000_000 + i }),
  );
  out.sort((a, b) => a.pageIndex - b.pageIndex || a.order - b.order);
  return out.map(({ order: _order, ...rest }) => rest);
}

/** The chapter a page (0-based) is in: the last visible entry that starts on or before it. */
export function chapterOf(entries: readonly TocEntry[], pageIndex: number): TocEntry | null {
  let found: TocEntry | null = null;
  for (const e of entries) {
    if (e.hidden) continue;
    if (e.pageIndex > pageIndex) break;
    found = e;
  }
  return found;
}
