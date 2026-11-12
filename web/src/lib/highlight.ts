import { useSyncExternalStore } from 'react';

/**
 * Code highlighting for text, without CodeMirror in the first bundle: the engine (`highlighter.ts`, CodeMirror's
 * parsers) is loaded once, as soon as the app starts (`loadHighlighter` in `main.tsx`), and rarer languages are loaded
 * the first time they are shown. Until then `highlightToHtml` answers null, and `useHighlighter` re-renders whoever
 * asked once more of it is there.
 */
type Engine = typeof import('./highlighter');

let engine: Engine | null = null;
let enginePromise: Promise<Engine> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

export function loadHighlighter(): Promise<Engine> {
  enginePromise ??= import('./highlighter').then((e) => {
    engine = e;
    changed();
    return e;
  });
  return enginePromise;
}

/**
 * Whether code in `lang` cannot be highlighted yet but will be: the engine or the language is still on its way. Starts
 * loading what is missing.
 */
export function highlightPending(lang: string): boolean {
  if (!lang) return false;
  if (!engine) {
    void loadHighlighter();
    return true;
  }
  if (engine.languageFor(lang) || !engine.isKnown(lang)) return false;
  void engine.loadLanguage(lang).then(changed);
  return true;
}

/** Highlights `code` into an HTML string (already escaped); null for a language there is none for, or not yet. */
export function highlightToHtml(code: string, lang: string): string | null {
  if (highlightPending(lang) || !engine) return null;
  return engine.highlightToHtml(code, lang);
}

/** Re-renders the caller when the engine or another language has arrived; the number changes each time. */
export function useHighlighter(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/** The languages of the code in a piece of rendered HTML. */
export function codeLanguages(html: string): string[] {
  return [...new Set([...html.matchAll(/data-lang="([^"]*)"/g)].map((m) => m[1]!))];
}
