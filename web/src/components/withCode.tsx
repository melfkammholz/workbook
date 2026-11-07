import { Fragment, type ReactNode } from 'react';

/** `code` in a sentence of the app's own text. */
export function withCode(text: string): ReactNode {
  return text.split('`').map((part, i) =>
    i % 2 ? (
      <code key={i} className="rounded bg-sunk px-1 font-mono text-[0.92em]">
        {part}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
