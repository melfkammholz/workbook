import { MIN_CONFIDENCE, normalizeTitle, type LibraryWork, Resource, WorkState } from '@wb/shared';

/** A material was opened this often in the last 14 days (`Resource.recentOpens`) to count as relevant. */
export const RELEVANT_OPENS = 3;

/** One line of the library: a work with its linked material, or a material that is no work's (slides, notes). */
export interface LibraryRow {
  key: string;
  kind: 'work' | 'material';
  work: LibraryWork | null;
  resource: Resource | null;
  title: string;
  authors: string;
  year: number | null;
  tags: string[];
  /** Only works have a state; materials without a work have none. */
  state: WorkState | null;
  unsorted: boolean;
  hasFile: boolean;
  /** State Later, or opened often lately. */
  relevant: boolean;
}

/** Works that were only found in a PDF's list and that the student has not sorted. */
const isUnsorted = (w: LibraryWork) => w.state === null && w.citedOn.length === 0 && w.citedBy.length > 0;

const yearOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
};

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** Built on the client from `/api/works` and `/api/resources`. */
export function buildRows(works: LibraryWork[], resources: Resource[]): LibraryRow[] {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const linked = new Set<string>();
  const rows: LibraryRow[] = [];
  for (const w of works) {
    const r = w.resource ? byId.get(w.resource) : undefined;
    if (r) linked.add(r.id);
    const sure = w.confidence >= MIN_CONFIDENCE && !!w.title;
    rows.push({
      key: `w-${w.id}`,
      kind: 'work',
      work: w,
      resource: r ?? null,
      title: sure ? w.title : w.raw,
      authors: sure ? w.authors : r?.author ?? '',
      year: w.year ?? (r ? yearOf(r.date) : null),
      tags: r ? union(w.tags, r.labels) : w.tags,
      state: w.state,
      unsorted: isUnsorted(w),
      hasFile: !!r,
      relevant: w.state === 'later' || (!!r && r.recentOpens >= RELEVANT_OPENS),
    });
  }
  // A material that is the file of a reference, though nobody linked them, is shown as that reference's row: same
  // title (8+ letters and digits) as a work that has no file. Nothing is saved; unlinking stays hidden for such a row.
  const open = new Map<string, LibraryRow>();
  for (const row of rows) {
    const key = row.work && !row.resource && row.title === row.work.title ? normalizeTitle(row.title) : '';
    if (key.length >= 8 && !open.has(key)) open.set(key, row);
  }
  for (const r of resources) {
    if (linked.has(r.id)) continue;
    const twin = open.get(normalizeTitle(r.title));
    if (twin && normalizeTitle(r.title).length >= 8) {
      open.delete(normalizeTitle(r.title));
      linked.add(r.id);
      twin.resource = r;
      twin.tags = union(twin.tags, r.labels);
      twin.authors ||= r.author;
      twin.year ??= yearOf(r.date);
      twin.hasFile = true;
      twin.relevant = twin.relevant || r.recentOpens >= RELEVANT_OPENS;
      continue;
    }
    rows.push({ key: `r-${r.id}`, kind: 'material', work: null, resource: r, title: r.title, authors: r.author, year: yearOf(r.date), tags: r.labels, state: null, unsorted: false, hasFile: true, relevant: r.recentOpens >= RELEVANT_OPENS });
  }
  return rows;
}
