import type { PDFDocumentProxy } from 'pdfjs-dist';

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

/**
 * The whole file is sent in one response (`disableRange`): the server is on this computer, and the browser keeps the
 * file because a version of it never changes.
 */
export async function openPdf(url: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ url, disableRange: true, disableStream: false, disableAutoFetch: true }).promise;
}

export const isPdf = (filename: string) => /\.pdf$/i.test(filename);

/** Title and author a PDF carries itself, for the upload dialog. Reads little of the file: `blobUrl` supports ranges. */
export async function pdfMetadata(file: File): Promise<{ title: string; author: string }> {
  const pdfjs = await loadPdfjs();
  const url = URL.createObjectURL(file);
  const task = pdfjs.getDocument({ url, disableAutoFetch: true });
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
