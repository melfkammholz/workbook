import { useEffect, useRef } from 'react';
import { Prose } from './Prose';
import { clsx } from './ui';

/**
 * One side of a card. For a cloze, `gap` is the gap that is asked: hidden behind a
 * placeholder until `revealed`, then marked. The other gaps read as plain text.
 */
export function CardFace({ html, css, gap, revealed, lang, className }: { html: string; css: string; gap: number | null; revealed: boolean; lang?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Runs after Prose has highlighted the code and wrapped the gaps.
  useEffect(() => {
    const root = ref.current;
    if (!root || gap === null) return;
    const asked = [...root.querySelectorAll<HTMLElement>(`[data-gap="${gap}"]`)];
    for (const el of asked) {
      el.classList.add('wb-gap-asked');
      el.classList.toggle('wb-gap-hidden', !revealed);
    }
    if (revealed || !asked[0]) return;
    const placeholder = document.createElement('span');
    placeholder.className = 'wb-gap-placeholder';
    placeholder.textContent = '…';
    asked[0].before(placeholder);
    return () => placeholder.remove();
  }, [html, gap, revealed]);

  return (
    <div ref={ref} className={clsx('wb-card-face', className)}>
      <Prose html={html} css={css} className="prose-note" {...(lang ? { lang } : {})} />
    </div>
  );
}
