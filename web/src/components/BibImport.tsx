import { useEffect, useRef, type ReactNode } from 'react';
import { isTyping } from '@/lib/keys';

/** Looks like BibTeX (an `@type{` entry) or Hayagriva (a key with type/title/author under it). */
export function looksLikeBibliography(text: string): boolean {
  return /(^|\n)\s*@[A-Za-z]+\s*[{(]/.test(text) || /^[\w.:-]+:[ \t]*\n[ \t]+(?:type|title|author):/m.test(text);
}

/**
 * Pasting BibTeX or Hayagriva (Ctrl+V outside a text field) or choosing a file hands its text to `onText`, which opens
 * the add dialog on it. The clipboard is only read by the paste event, never asked for. Put `node` into the page.
 */
export function useBibImport(onText: (text: string) => void): { node: ReactNode; pickFile: () => void } {
  const input = useRef<HTMLInputElement>(null);
  const handler = useRef(onText);
  handler.current = onText;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[role=dialog]')) return;
      const pasted = e.clipboardData?.getData('text/plain') ?? '';
      if (!looksLikeBibliography(pasted)) return;
      e.preventDefault();
      handler.current(pasted);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  const node = (
    <input
      ref={input}
      type="file"
      accept=".bib,.bibtex,.yml,.yaml,.txt,text/plain"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f && f.size < 3_000_000) void f.text().then((x) => handler.current(x));
      }}
    />
  );
  return { node, pickFile: () => input.current?.click() };
}
