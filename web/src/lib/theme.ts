import type { Settings } from '@wb/shared';

/** Applies the theme (the colour of dusk, warm paper) to <html> and remembers both, so the next load paints correctly. */
export function applyTheme(theme: Settings['theme'], dusk: Settings['duskColor'] = 'indigo', warm = true): void {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = theme === 'dusk' ? 'dusk' : dark ? 'dark' : 'light';
  root.dataset.dusk = dusk;
  if (warm) root.dataset.warm = '';
  else delete root.dataset.warm;
  try {
    localStorage.setItem('wb-theme', theme);
    localStorage.setItem('wb-dusk', dusk);
    localStorage.setItem('wb-warm', warm ? '1' : '0');
  } catch {
    /* private mode */
  }
}
