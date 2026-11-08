import type { Settings } from '@wb/shared';

/** Applies the theme (and the colour of dusk) to <html> and remembers both, so the next load paints correctly. */
export function applyTheme(theme: Settings['theme'], dusk: Settings['duskColor'] = 'indigo'): void {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = theme === 'dusk' ? 'dusk' : dark ? 'dark' : 'light';
  root.dataset.dusk = dusk;
  try {
    localStorage.setItem('wb-theme', theme);
    localStorage.setItem('wb-dusk', dusk);
  } catch {
    /* private mode */
  }
}
