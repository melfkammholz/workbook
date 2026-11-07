import type { CardConfidence } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { clsx } from './ui';

const SEGMENTS = [
  ['shaky', 'bg-confidence-low wb-stripes'],
  ['solid', 'bg-confidence-high'],
  // Not yet known either way: an outline, so it does not read as "okay".
  ['fresh', 'border border-dashed border-ink-3'],
] as const;

/**
 * How well a deck's cards are known: solid, shaky, new. The same colours as the
 * confidence overview, with stripes on "shaky", so nobody has to tell them apart by hue.
 */
export function CardConfidenceBar({ value, className, legend }: { value: CardConfidence; className?: string; legend?: boolean }) {
  const t = useT();
  const total = value.solid + value.shaky + value.fresh;
  const names = { solid: t.cardsSolid, shaky: t.cardsShaky, fresh: t.cardsFresh };
  if (!total) return null;
  const summary = SEGMENTS.map(([k]) => `${names[k]} ${value[k]}`).join(', ');
  return (
    <div className={className}>
      <div role="img" aria-label={summary} title={summary} className="flex h-2.5 gap-0.5">
        {SEGMENTS.map(([k, color]) => (value[k] > 0 ? <span key={k} className={clsx('rounded-sm', color)} style={{ flexGrow: value[k], flexBasis: 0 }} /> : null))}
      </div>
      {legend ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
          {SEGMENTS.map(([k, color]) =>
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
