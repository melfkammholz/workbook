import { createElement, type ReactNode } from 'react';
import { readMath, splitMath, type MathNode } from '@/lib/titleMath';

/**
 * A title in which `backticks` mark code, as in the course text: shown in the code font, without highlighting,
 * since a title is not a program. `$x^2$` is math, written as in Typst. `plainTitle` is the same title as text,
 * for window titles and labels.
 */
export function Title({ text }: { text: string }) {
  if (!text.includes('`') && !text.includes('$')) return <>{text}</>;
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <code key={i} className="wb-title-code">
            {p}
          </code>
        ) : (
          <TitleText key={i} text={p} />
        ),
      )}
    </>
  );
}

function TitleText({ text }: { text: string }) {
  if (!text.includes('$')) return <>{text}</>;
  return (
    <>
      {splitMath(text).map((s, i) => {
        if (!s.math) return s.v;
        const m = readMath(s.v);
        return m ? <span key={i} className="wb-title-math">{render(m)}</span> : `$${s.v}$`;
      })}
    </>
  );
}

function render(n: MathNode, key?: number): ReactNode {
  const props = { key, ...n.attrs };
  if (n.attrs?.['data-group']) delete (props as Record<string, unknown>)['data-group'];
  return createElement(n.tag, props, n.text ?? n.kids?.map((k, i) => render(k, i)));
}

export const plainTitle = (text: string) =>
  text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\\$/g, '\0')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\0/g, '$');
