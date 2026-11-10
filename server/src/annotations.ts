import { locateQuote, type Annotation, type AnnotationEntry, type RenderedItem } from '@wb/shared';
import { HTMLElement, TextNode, parse, type Node } from 'node-html-parser';

/**
 * What can be highlighted, the same as in the browser (`web/src/lib/annotations.ts`): the text nodes in document
 * order, leaving out code blocks, math, pictures, widgets and buttons. Keep the two lists alike.
 */
export const SKIPPED = new Set(['pre', 'math', 'svg', 'button', 'script', 'style']);

export function textOfHtml(html: string): string {
  let out = '';
  const walk = (n: Node) => {
    if (n instanceof TextNode) {
      out += n.text;
      return;
    }
    if (n instanceof HTMLElement && (SKIPPED.has(n.rawTagName?.toLowerCase() ?? '') || n.hasAttribute('data-widget'))) return;
    for (const c of n.childNodes) walk(c);
  };
  walk(parse(html));
  return out;
}

/** The HTML a part of a rendered text stands for: `task`, `remark-<n>`, `hint-<n>`. */
export function htmlOfPart(rendered: Pick<RenderedItem, 'task' | 'remarks' | 'hints'>, part: string): string | null {
  if (part === 'task') return rendered.task;
  const m = /^(remark|hint)-(\d+)$/.exec(part);
  if (!m) return null;
  return (m[1] === 'remark' ? rendered.remarks : rendered.hints)[Number(m[2])] ?? null;
}

export const isPart = (part: string): boolean => part === 'task' || /^(remark|hint)-\d{1,3}$/.test(part);

/** Each annotation, and whether its quote can still be found in the text it belongs to. */
export async function withFound(list: Annotation[], render: (target: string) => Promise<Pick<RenderedItem, 'task' | 'remarks' | 'hints'> | null>): Promise<AnnotationEntry[]> {
  const texts = new Map<string, string | null>();
  const out: AnnotationEntry[] = [];
  for (const a of list) {
    const key = `${a.target}\0${a.part}`;
    if (!texts.has(key)) {
      const rendered = await render(a.target).catch(() => null);
      const html = rendered ? htmlOfPart(rendered, a.part) : null;
      texts.set(key, html === null ? null : textOfHtml(html));
    }
    const text = texts.get(key);
    out.push({ ...a, found: text != null && locateQuote(text, a) !== null });
  }
  return out;
}
