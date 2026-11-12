// The picker for `#pdf-ref(…)` in Typst editors. Apart from the dialog so that an editor can ask for it without
// loading it: the app mounts one `PdfRefPicker` (components/PdfRefPicker.tsx) that registers itself here.

export type InsertText = (text: string) => void;
let opener: ((insert: InsertText) => void) | null = null;

export const registerPdfRefPicker = (f: ((insert: InsertText) => void) | null): void => {
  opener = f;
};

/** Opens the picker; what the student chooses goes to `insert`. Returns false if materials are off (nothing to pick). */
export const openPdfRefPicker = (insert: InsertText): boolean => {
  if (!opener) return false;
  opener(insert);
  return true;
};
