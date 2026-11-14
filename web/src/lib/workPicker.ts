// The picker for `#cite-work("<id>")` in Typst editors. Apart from the dialog so that an editor can ask for it without
// loading it: the app mounts one `WorkPicker` (components/WorkPicker.tsx) that registers itself here.

import type { InsertText } from './pdfRefPicker';

let opener: ((insert: InsertText) => void) | null = null;

export const registerWorkPicker = (f: ((insert: InsertText) => void) | null): void => {
  opener = f;
};

/** Opens the picker; what the student chooses goes to `insert`. Returns false if materials are off (no library to pick from). */
export const openWorkPicker = (insert: InsertText): boolean => {
  if (!opener) return false;
  opener(insert);
  return true;
};

/** The text a chosen work becomes: its id, and the work in a comment so the source stays readable. */
export function citeWorkText(w: { id: string; title: string; authors: string; year: number | null }): string {
  const first = w.authors.split(',')[0]?.replace(/\s*et al\.?$/i, '').trim().split(/\s+/).pop() ?? '';
  const label = [[first, w.year].filter(Boolean).join(' '), w.title].filter(Boolean).join(': ').replace(/\*\/|\/\*/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
  return `#cite-work("${w.id}")[]${label ? ` /* ${label} */` : ''}`;
}
