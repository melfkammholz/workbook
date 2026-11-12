import fs from 'node:fs';

/** A page never indexes more than this much, so one odd file cannot fill the database. */
const MAX_PAGE_CHARS = 100_000;
const MAX_PAGES = 5000;

/**
 * The text of every page of a PDF, one string per page, in reading order. Pages without text (scans) are empty.
 * Yields to the event loop between pages, so requests are answered while a big file is read.
 */
export async function extractPdfText(file: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.promises.readFile(file));
  const task = pdfjs.getDocument({ data, verbosity: 0, useSystemFonts: false, disableFontFace: true });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((i) => ('str' in i ? i.str + ('hasEOL' in i && i.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_PAGE_CHARS),
      );
      page.cleanup();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
