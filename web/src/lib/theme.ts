import type { Settings } from '@wb/shared';

/** Applies the theme to <html> and remembers it so the next load paints correctly. */
export function applyTheme(theme: Settings['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('wb-theme', theme);
  } catch {
    /* private mode */
  }
}
