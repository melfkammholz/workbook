import crypto from 'node:crypto';
import type { ChecklistQuestion } from '@wb/shared';
import { HTMLElement, parse } from 'node-html-parser';

const FORBIDDEN = 'script, iframe, object, embed, link, meta, base, form, frame, frameset';

/**
 * Typst output is trusted for exercise text but students can write arbitrary
 * Typst in their notes (and `html.elem("script")` is expressible), so every
 * piece of HTML that leaves the server is stripped of anything executable.
 */
const URL_ATTRS = /^(href|src|xlink:href|action|formaction|poster)$/i;
const DANGEROUS_URL = /^(javascript|vbscript|data:text\/html)/i;

export function sanitize(root: HTMLElement): void {
  for (const el of root.querySelectorAll(FORBIDDEN)) el.remove();
  for (const el of root.querySelectorAll('*')) {
    for (const name of Object.keys(el.attributes)) {
      if (/^on/i.test(name)) {
        el.removeAttribute(name);
      } else if (URL_ATTRS.test(name)) {
        // Browsers ignore whitespace and control characters inside the scheme.
        const url = (el.getAttribute(name) ?? '').replace(/[\s\u0000-\u001f]/g, '');
        if (DANGEROUS_URL.test(url)) el.removeAttribute(name);
      }
    }
  }
}

export interface SplitHtml {
  task: string;
  remarks: string[];
  hints: string[];
  samples: string[];
  questions: ChecklistQuestion[];
  css: string;
}

/** Splits Typst HTML into the task and the marked-up parts (remarks, hints). Author notes are dropped here, so they never reach a browser. */
export function splitDocument(html: string, o: { inlineRemarks?: boolean } = {}): SplitHtml {
  const doc = parse(html, { comment: false });
  const css = doc
    .querySelectorAll('head style')
    .map((s) => s.text)
    .join('\n');
  const body = doc.querySelector('body') ?? doc;
  sanitize(body);

  const take = (kind: string) => {
    const out: string[] = [];
    for (const el of body.querySelectorAll(`aside[data-wb="${kind}"]`)) {
      out.push(el.innerHTML.trim());
      el.remove();
    }
    return out;
  };
  const remarks = o.inlineRemarks ? [] : take('remark');
  const hints = take('hint');
  const questions = take('question').map((html) => ({ id: crypto.createHash('sha1').update(html).digest('hex').slice(0, 12), html }));
  const samples = take('sample');
  take('draft');
  return { task: body.innerHTML.trim(), remarks, hints, samples, questions, css };
}

/**
 * Pictures of a student's text (a fallback page, a card side) take the theme's text colour:
 * Typst's black becomes `currentColor`. Other colours are the student's and stay.
 */
function themePictures(root: HTMLElement): void {
  for (const svg of root.querySelectorAll('.wb-as-picture > svg, [data-side] > svg')) {
    svg.set_content(svg.innerHTML.replace(/\b(fill|stroke)="#000000"/g, '$1="currentColor"'));
  }
}

/** Body HTML only, for student notes. */
export function bodyOf(html: string): { html: string; css: string } {
  const doc = parse(html, { comment: false });
  const css = doc
    .querySelectorAll('head style')
    .map((s) => s.text)
    .join('\n');
  const body = doc.querySelector('body') ?? doc;
  sanitize(body);
  themePictures(body);
  return { html: body.innerHTML.trim(), css };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const BLOCK = new Set(['p', 'div', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'aside', 'section', 'math']);

/** Readable plain text of rendered HTML: what the AI review is given as the exercise. Code keeps its layout. */
export function htmlToText(html: string): string {
  const walk = (node: HTMLElement): string => {
    let out = '';
    for (const child of node.childNodes) {
      if (!(child instanceof HTMLElement)) {
        out += child.text;
        continue;
      }
      const tag = child.tagName?.toLowerCase() ?? '';
      if (tag === 'svg') continue;
      const inner = walk(child);
      if (tag === 'li') out += `\n- ${inner.trim()}\n`;
      else if (tag === 'math' && child.getAttribute('display') !== 'block') out += inner;
      else if (BLOCK.has(tag)) out += `\n${inner.trim()}\n`;
      else out += inner;
    }
    return out;
  };
  return walk(parse(html, { comment: false, blockTextElements: {} }))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
