import type { EmbeddedTocEntry } from '@wb/shared';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type Pdfjs = typeof import('pdfjs-dist');

let lib: Promise<Pdfjs> | null = null;
let workerUrl: string | null = null;

/** pdf.js, loaded on first use (a chunk of its own, never part of the entry). */
export function loadPdfjs(): Promise<Pdfjs> {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, w]) => {
    workerUrl = w.default;
    m.GlobalWorkerOptions.workerSrc = w.default;
    return m;
  });
  return lib;
}

/** The materials page calls this once it has a PDF in its list, so opening one finds the library and the worker in the cache. */
export function preloadPdf(): void {
  void loadPdfjs().then(() => {
    if (!workerUrl || document.querySelector(`link[href="${workerUrl}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = workerUrl;
    document.head.append(link);
  });
}

/** Fonts and character maps for PDFs that do not embed them: without these their math symbols and CJK text are not drawn; the wasm decoders draw JBIG2 and JPEG 2000 images (scanned text, bitmap-font math). */
const FONT_ASSETS = { standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, wasmUrl: '/pdfjs/wasm/' };

/**
 * The whole file is sent in one response (`disableRange`): the server is on this computer, and the browser keeps the
 * file because a version of it never changes.
 */
export async function openPdf(url: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ ...FONT_ASSETS, url, disableRange: true, disableStream: false, disableAutoFetch: true }).promise;
}

/** An open PDF with what the viewer needs before its first paint. */
export interface OpenedPdf {
  doc: PDFDocumentProxy;
  labels: string[] | null;
  /** Page 1's size at scale 1. */
  guess: { w: number; h: number };
  /** The embedded outline, once read (`undefined` until then). */
  outline?: EmbeddedTocEntry[] | null;
}

/** How many PDFs stay open after the viewer leaves them, so going back (or A → B → A) shows them at once. */
const KEEP_DOCS = 3;
interface Kept {
  id: string;
  promise: Promise<OpenedPdf>;
  done?: OpenedPdf;
}
/** By `id@sha256`; insertion order is the order of use (oldest first). */
const kept = new Map<string, Kept>();
const keyOf = (id: string, sha256: string) => `${id}@${sha256}`;

/** Keys of the PDFs a viewer shows right now: never evicted, whatever else is opened (a hover on a reference opens others). */
const shown = new Set<string>();
export function holdPdf(id: string, sha256: string): () => void {
  const key = keyOf(id, sha256);
  shown.add(key);
  return () => void shown.delete(key);
}

function drop(key: string): void {
  const k = kept.get(key);
  if (!k) return;
  kept.delete(key);
  void k.promise.then((o) => {
    perDoc.delete(o.doc);
    dropBitmaps(o.doc);
    void o.doc.loadingTask.destroy();
  }, () => undefined);
}

/** The PDF if it is open already: the viewer starts from it without waiting a frame. */
export function openedPdf(id: string, sha256: string): OpenedPdf | undefined {
  return kept.get(keyOf(id, sha256))?.done;
}

/** Opens a resource's PDF, or takes it from the ones kept open. The viewer never destroys it; eviction does. */
export function keepPdf(id: string, sha256: string, url: string): Promise<OpenedPdf> {
  const key = keyOf(id, sha256);
  const have = kept.get(key);
  if (have) {
    kept.delete(key);
    kept.set(key, have);
    return have.promise;
  }
  // Another version of the same resource is not coming back.
  for (const [k, v] of kept) if (v.id === id) drop(k);
  const entry: Kept = {
    id,
    promise: openPdf(url).then(async (doc) => {
      const [labels, first] = await Promise.all([doc.getPageLabels().catch(() => null), doc.getPage(1)]);
      const v = first.getViewport({ scale: 1 });
      pagesOf(doc).set(1, first);
      const o: OpenedPdf = { doc, labels: labels && labels.some(Boolean) ? labels : null, guess: { w: v.width, h: v.height } };
      entry.done = o;
      return o;
    }),
  };
  entry.promise.catch(() => kept.get(key) === entry && kept.delete(key));
  kept.set(key, entry);
  for (const k of [...kept.keys()]) {
    if (kept.size <= KEEP_DOCS) break;
    if (k !== key && !shown.has(k)) drop(k);
  }
  return entry.promise;
}

/** A resource's file was replaced or deleted: its open PDFs go. */
export function forgetPdf(id: string): void {
  for (const [k, v] of kept) if (v.id === id) drop(k);
}

const perDoc = new WeakMap<PDFDocumentProxy, Map<number, PDFPageProxy>>();
/** The pages loaded so far, so a page shown again has its size and can draw without waiting for `getPage`. */
export function pagesOf(doc: PDFDocumentProxy): Map<number, PDFPageProxy> {
  let m = perDoc.get(doc);
  if (!m) perDoc.set(doc, (m = new Map()));
  return m;
}

/**
 * The drawn pages that were in view when the viewer left (or a slide was left), painted again at once on return while
 * pdf.js draws them anew. A few only, across all PDFs: each can be many megabytes.
 */
const KEEP_BITMAPS = 8;
const bitmaps = new Map<string, { doc: PDFDocumentProxy; canvas: HTMLCanvasElement }>();
const docIds = new WeakMap<PDFDocumentProxy, number>();
let nextDocId = 0;
const bitmapKey = (doc: PDFDocumentProxy, n: number) => {
  let id = docIds.get(doc);
  if (id === undefined) docIds.set(doc, (id = nextDocId++));
  return `${id}:${n}`;
};
export function keepBitmap(doc: PDFDocumentProxy, n: number, canvas: HTMLCanvasElement): void {
  if (![...kept.values()].some((k) => k.done?.doc === doc)) return;
  const key = bitmapKey(doc, n);
  bitmaps.delete(key);
  bitmaps.set(key, { doc, canvas });
  while (bitmaps.size > KEEP_BITMAPS) bitmaps.delete(bitmaps.keys().next().value!);
}
export function takeBitmap(doc: PDFDocumentProxy, n: number): HTMLCanvasElement | null {
  const key = bitmapKey(doc, n);
  const b = bitmaps.get(key);
  if (!b) return null;
  bitmaps.delete(key);
  return b.canvas;
}
function dropBitmaps(doc: PDFDocumentProxy): void {
  for (const [k, b] of bitmaps) if (b.doc === doc) bitmaps.delete(k);
}

export const isPdf = (filename: string) => /\.pdf$/i.test(filename);

/** Title and author a PDF carries itself, for the upload dialog. Reads little of the file: `blobUrl` supports ranges. */
export async function pdfMetadata(file: File): Promise<{ title: string; author: string }> {
  const pdfjs = await loadPdfjs();
  const url = URL.createObjectURL(file);
  const task = pdfjs.getDocument({ ...FONT_ASSETS, url, disableAutoFetch: true });
  try {
    const doc = await task.promise;
    const info = ((await doc.getMetadata()).info ?? {}) as { Title?: unknown; Author?: unknown };
    const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    let title = clean(info.Title).replace(/^Microsoft Word - /i, '').trim();
    // Tools leave their own names behind; those say nothing.
    if (/^(untitled|unbenannt|document\d*)(\.\w+)?$/i.test(title) || /\.(tex|dvi|docx?|odt|pptx?|indd)$/i.test(title)) title = '';
    return { title, author: clean(info.Author) };
  } finally {
    void task.destroy();
    URL.revokeObjectURL(url);
  }
}
