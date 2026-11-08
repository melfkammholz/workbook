import type { CardConfidence } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { clsx } from './ui';

/** The same three levels, colours and order as a student's own ratings, and new. */
export const CARD_SEGMENTS = [
  ['shaky', 'bg-confidence-low wb-stripes'],
  ['learning', 'bg-confidence-mid'],
  ['solid', 'bg-confidence-high'],
  // Not yet known either way: an outline, so it does not read as "okay".
  ['fresh', 'border border-dashed border-ink-3'],
] as const;

/**
 * How well a deck's cards are known: unsure, okay, sure, new. The same levels, words and colours as a student's
 * own ratings, with stripes on "unsure", so nobody has to tell them apart by hue.
 */
export function CardConfidenceBar({ value, className, legend }: { value: CardConfidence; className?: string; legend?: boolean }) {
  const t = useT();
  const total = value.solid + value.learning + value.shaky + value.fresh;
  const names = { solid: t.confidenceHigh, learning: t.confidenceOkay, shaky: t.confidenceLow, fresh: t.cardsFresh };
  if (!total) return null;
  const summary = CARD_SEGMENTS.map(([k]) => `${names[k]} ${value[k]}`).join(', ');
  return (
    <div className={className}>
      <div role="img" aria-label={summary} title={summary} className="flex h-2.5 gap-0.5">
        {CARD_SEGMENTS.map(([k, color]) => (value[k] > 0 ? <span key={k} className={clsx('rounded-sm', color)} style={{ flexGrow: value[k], flexBasis: 0 }} /> : null))}
      </div>
      {legend ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
          {CARD_SEGMENTS.map(([k, color]) =>
            value[k] > 0 ? (
              <li key={k} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={clsx('size-2.5 rounded-sm', color)} />
                {names[k]} {value[k]}
              </li>
            ) : null,
          )}
        </ul>
      ) : null}
    </div>
  );
}
