// Apart from `typst.ts`, which needs CodeMirror: the app fills this in long before an editor is opened.

export interface TypstContext {
  /** Stable id of the open course, for `from:`. */
  course: string | null;
  exercises: { id: string; title: string }[];
  tags: { id: string; label: string }[];
}

/** Kept current by the app as the open course changes, so every editor offers its exercises and tags. */
export const typstContext: TypstContext = { course: null, exercises: [], tags: [] };

/** A tag as students know it: its label in the open course, else the id written on the card. */
export const tagLabel = (id: string) => typstContext.tags.find((k) => k.id === id)?.label ?? id;
