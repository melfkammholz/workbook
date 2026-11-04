import { useMemo } from 'react';
import { Link } from 'wouter';
import type { Outline, ReviewData } from '@wb/shared';
import { confidenceRows, type Row } from '@/lib/confidence';
import { useT } from '@/lib/i18n';
import { clsx } from './ui';

const SEGMENTS = [
  ['low', 'bg-confidence-low wb-stripes'],
  ['okay', 'bg-confidence-mid'],
  ['high', 'bg-confidence-high'],
] as const;

/**
 * Where it feels solid and where it does not. Shakiest first, because that is what to work on.
 * Orange and blue rather than red and green, and stripes on "unsure", so nobody has to tell them apart by hue.
 */
export function ConfidenceOverview({ outline, data }: { outline: Outline; data: ReviewData }) {
  const t = useT();
  const { chapters, topics } = useMemo(() => confidenceRows(outline, data), [outline, data]);
  if (chapters.length === 0 && topics.length === 0) return null;
  const names = { low: t.confidenceLow, okay: t.confidenceOkay, high: t.confidenceHigh };

  const Bars = ({ title, rows }: { title: string; rows: Row[] }) => (
    <div>
      <h3 className="mb-1.5 text-[13px] font-medium text-ink-2">{title}</h3>
      <ul className="space-y-2">
        {rows.map((r) => {
          const rated = r.low + r.okay + r.high;
          const summary = `${r.label}: ${names.low} ${r.low}, ${names.okay} ${r.okay}, ${names.high} ${r.high}`;
          return (
            <li key={r.key} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]">
              {r.href ? (
                <Link href={r.href} className="truncate text-sm hover:underline">
                  {r.label}
                </Link>
              ) : (
                <span className="truncate text-sm">{r.label}</span>
              )}
              <div role="img" aria-label={summary} className="flex h-3.5 gap-0.5">
                {SEGMENTS.map(([name, color]) =>
                  r[name] > 0 ? <span key={name} title={`${names[name]}: ${r[name]}`} className={clsx('rounded-sm', color)} style={{ flexGrow: r[name], flexBasis: 0 }} /> : null,
                )}
              </div>
              <span className="text-xs tabular-nums text-ink-3">{r.total ? t.ratedOf(rated, r.total) : t.ratedCount(rated)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <section className="mt-6 rounded-lg border border-line bg-sheet p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">{t.confidenceOverview}</h2>
        <ul className="flex flex-wrap gap-x-3 text-xs text-ink-2">
          {SEGMENTS.map(([name, color]) => (
            <li key={name} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={clsx('size-3 rounded-sm', color)} /> {names[name]}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-1 text-[13px] text-ink-2">{t.confidenceHint}</p>
      <div className="mt-3 space-y-4">
        {chapters.length ? <Bars title={t.byChapter} rows={chapters} /> : null}
        {topics.length ? <Bars title={t.byTopic} rows={topics} /> : null}
      </div>
    </section>
  );
}
