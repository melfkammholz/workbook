import { createContext, createElement, useContext, useEffect, type ReactNode } from 'react';
import type { UiLanguage } from '@wb/shared';
import { useOutline, useSettings } from '../api';
import { en as en0, de as de0 } from './common';
import { en as en1, de as de1 } from './workspace';
import { en as en2, de as de2 } from './help';
import { en as en3, de as de3 } from './review';
import { en as en4, de as de4 } from './search';
import { en as en5, de as de5 } from './flashcards';
import { en as en6, de as de6 } from './todos';

/**
 * The language of the app itself. Exercises stay in the language they were
 * written in. Every string a student sees lives here, so a missing translation
 * is a type error: `de` has to match `en`.
 */
const en = {
  ...en0,
  ...en1,
  ...en2,
  ...en3,
  ...en4,
  ...en5,
  ...en6,
};

export type Strings = typeof en;

const de: Strings = {
  ...de0,
  ...de1,
  ...de2,
  ...de3,
  ...de4,
  ...de5,
  ...de6,
};

const STRINGS = { en, de };

/** `auto` follows the language of the course; anything but German falls back to English. */
export function resolveLanguage(setting: UiLanguage | undefined, course: string | undefined): 'de' | 'en' {
  if (setting === 'de' || setting === 'en') return setting;
  // Before the first course is there, the browser is all there is to go by.
  return (course ?? navigator.language).toLowerCase().startsWith('de') ? 'de' : 'en';
}

const LangContext = createContext<'de' | 'en' | null>(null);

/**
 * Works out the language once for the whole app. `useT` is called by hundreds of components (every outline row,
 * several times), and two query subscriptions in each made every page change slow.
 */
export function LangProvider({ children }: { children: ReactNode }) {
  const settings = useSettings().data;
  const outline = useOutline().data;
  return createElement(LangContext.Provider, { value: resolveLanguage(settings?.uiLanguage, outline?.language) }, children);
}

export function useLang(): 'de' | 'en' {
  return useContext(LangContext) ?? resolveLanguage(undefined, undefined);
}

export function useT(): Strings {
  return STRINGS[useLang()];
}

/** Keeps the document's language in step, for screen readers. Exercise text sets its own. */
export function useDocumentLang(): void {
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}
