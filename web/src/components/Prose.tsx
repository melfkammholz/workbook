import { useEffect, useRef } from 'react';
import { useOutline } from '@/lib/api';
import { highlightToHtml } from '@/lib/highlight';
import { useT } from '@/lib/i18n';
import { clsx } from './ui';

/**
 * Renders server-sanitised Typst HTML. Code is highlighted here (the server
 * leaves it plain) and blocks get a copy button. Typst's global CSS (math
 * layout) is injected once.
 */
export function Prose({ html, css, className }: { html: string; css?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const copyLabel = useT().copyCode;
  // The text is in the language of the course, whatever the app is set to: hyphenation depends on it.
  const lang = useOutline().data?.language;
  useTypstCss(css);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cleanups: (() => void)[] = [];
    root.querySelectorAll<HTMLElement>('code[data-lang]').forEach((code) => {
      if (code.closest('pre')) return;
      const h = highlightToHtml(code.textContent ?? '', code.getAttribute('data-lang') ?? '');
      if (h !== null) code.innerHTML = h;
    });
    root.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
      const code = pre.querySelector('code') ?? pre;
      const text = code.textContent ?? '';
      const lang = code.getAttribute('data-lang') ?? pre.getAttribute('data-lang') ?? '';
      const h = lang ? highlightToHtml(text, lang) : null;
      if (h !== null) code.innerHTML = h;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wb-copy';
      btn.setAttribute('aria-label', copyLabel);
      btn.innerHTML = COPY_ICON;
      let t: ReturnType<typeof setTimeout>;
      btn.onclick = () => {
        void navigator.clipboard?.writeText(text).then(() => {
          btn.innerHTML = CHECK_ICON;
          clearTimeout(t);
          t = setTimeout(() => (btn.innerHTML = COPY_ICON), 1400);
        });
      };
      pre.appendChild(btn);
      cleanups.push(() => {
        clearTimeout(t);
        btn.remove();
      });
    });
    return () => cleanups.forEach((c) => c());
  }, [html, copyLabel]);

  return <div ref={ref} {...(lang ? { lang } : {})} className={clsx('prose-task', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

let injected = '';
function useTypstCss(css: string | undefined) {
  useEffect(() => {
    if (!css || css === injected) return;
    injected = css;
    let el = document.getElementById('typst-css') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'typst-css';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [css]);
}

