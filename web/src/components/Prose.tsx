import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutline } from '@/lib/api';
import { highlightToHtml } from '@/lib/highlight';
import { useT } from '@/lib/i18n';
import { clsx } from './ui';
import { Widget, takeWidgets, type WidgetHost } from './widgets';

/**
 * Renders server-sanitised Typst HTML. Code is highlighted here (the server
 * leaves it plain) and blocks get a copy button. Typst's global CSS (math
 * layout) is injected once.
 */
export function Prose({ html, css, className, lang: langProp }: { html: string; css?: string; className?: string; lang?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const copyLabel = useT().copyCode;
  // The text is in the language of the course, whatever the app is set to: hyphenation depends on it.
  const courseLang = useOutline().data?.language;
  const lang = langProp ?? courseLang;
  useTypstCss(css);
  const [widgets, setWidgets] = useState<WidgetHost[]>([]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Widgets first: their parts are rendered by a Prose of their own, and highlighted there.
    setWidgets(takeWidgets(root));
    const cleanups: (() => void)[] = [];
    // Once per element: highlighting again would start from text whose gap marks are already spans.
    root.querySelectorAll<HTMLElement>('code[data-lang]:not([data-hl])').forEach((code) => {
      if (code.closest('pre')) return;
      code.dataset.hl = '';
      const h = highlightToHtml(code.textContent ?? '', code.getAttribute('data-lang') ?? '');
      if (h !== null) code.innerHTML = h;
    });
    // A link out of the app says so, and opens beside it: following it must not close the workbook.
    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      if (!/^(https?:)?\/\//i.test(a.getAttribute('href') ?? '') || a.host === location.host) return;
      a.classList.add('wb-external');
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (!a.title) a.title = a.host;
    });
    const pres = root.querySelectorAll<HTMLElement>('pre');
    pres.forEach((pre) => {
      const code = pre.querySelector('code') ?? pre;
      const text = code.textContent ?? '';
      const lang = code.getAttribute('data-lang') ?? pre.getAttribute('data-lang') ?? '';
      if (!code.hasAttribute('data-hl')) {
        code.dataset.hl = '';
        const h = lang ? highlightToHtml(text, lang) : null;
        if (h !== null) code.innerHTML = h;
      }

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
    // After highlighting, which works on plain text: gaps in code are marks in that text.
    wrapGaps(root);
    return () => cleanups.forEach((c) => c());
  }, [html, copyLabel]);

  return (
    <>
      <div ref={ref} {...(lang ? { lang } : {})} className={clsx('prose-task', className)} dangerouslySetInnerHTML={{ __html: html }} />
      {widgets.map((w) => createPortal(<Widget host={w} />, w.el, w.key))}
    </>
  );
}

const GAP_CLOSE = 0xe0ff;
const isGapOpen = (c: number) => c > 0xe100 && c <= 0xe1fe;

/**
 * Cloze gaps arrive as marks in the text: U+E100 + n opens gap n, U+E0FF closes it.
 * A gap may run across highlighted tokens, so every piece of text inside it gets a
 * `span[data-gap]` of its own. Math or a picture inside a gap is marked as a whole.
 */
function wrapGaps(root: HTMLElement): void {
  if (!/[\ue0ff-\ue1fe]/.test(root.textContent ?? '')) return;
  let gap: number | null = null;
  const texts: Text[] = [];
  // Called in document order, so `gap` is the gap open at that point.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n instanceof Element && (n.tagName.toLowerCase() === 'math' || n.tagName.toLowerCase() === 'svg')) {
        if (gap !== null) n.setAttribute('data-gap', String(gap));
        return NodeFilter.FILTER_REJECT;
      }
      if (n instanceof Text) {
        for (let i = 0; i < n.data.length; i++) {
          const c = n.data.charCodeAt(i);
          if (c === GAP_CLOSE) gap = null;
          else if (isGapOpen(c)) gap = c - 0xe100;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  // Now the text itself, from the start again.
  gap = null;
  for (const text of texts) {
    const value = text.data;
    const pieces: { text: string; gap: number | null }[] = [];
    let start = 0;
    let changed = gap !== null;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (!isGapOpen(c) && c !== GAP_CLOSE) continue;
      if (i > start) pieces.push({ text: value.slice(start, i), gap });
      gap = c === GAP_CLOSE ? null : c - 0xe100;
      start = i + 1;
      changed = true;
    }
    if (start < value.length) pieces.push({ text: value.slice(start), gap });
    if (!changed) continue;
    const frag = document.createDocumentFragment();
    for (const p of pieces) {
      if (p.gap === null) {
        frag.appendChild(document.createTextNode(p.text));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'wb-gap';
      span.setAttribute('data-gap', String(p.gap));
      span.textContent = p.text;
      frag.appendChild(span);
    }
    text.replaceWith(frag);
  }
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

