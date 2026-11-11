import { useMemo } from 'react';
import { Link } from 'wouter';
import type { CardConfidence, CourseCards, Outline, ReviewData } from '@wb/shared';
import { confidenceRows, type Row as RatingRow } from '@/lib/confidence';
import { useT } from '@/lib/i18n';
import { CARD_SEGMENTS, CardConfidenceBar } from './CardConfidenceBar';
import { clsx } from './ui';

const RATING_SEGMENTS = [
  ['low', 'bg-confidence-low wb-stripes'],
  ['okay', 'bg-confidence-mid'],
  ['high', 'bg-confidence-high'],
] as const;


interface Row {
  key: string;
  label: string;
  href: string | null;
  rating: RatingRow | null;
  cards: CardConfidence | null;
}

/** How weak a group looks, 0 to 1, in each measure on its own. They are never added up. */
const ratingWeakness = (r: RatingRow) => (5 - r.average) / 4;
const cardWeakness = (v: CardConfidence) => (v.shaky + (v.learning + v.fresh) * 0.5) / Math.max(1, v.solid + v.learning + v.shaky + v.fresh);
const weakness = (r: Row) => Math.max(r.rating ? ratingWeakness(r.rating) : 0, r.cards ? cardWeakness(r.cards) : 0);
const cardTotal = (v: CardConfidence) => v.solid + v.learning + v.shaky + v.fresh;

/**
 * Where it feels solid and where it does not, by chapter and by topic, in one place:
 * how the student rated themselves and, next to it, how well their flashcards are
 * remembered. Two measures side by side, never merged into one number; a group comes
 * first when either of them is weak.
 * Red to green by default; with the colour vision setting orange and blue, and stripes on the weak end.
 */
export function ConfidenceOverview({ outline, data, cards }: { outline: Outline; data: ReviewData; cards: CourseCards | null }) {
  const t = useT();
  const ratings = useMemo(() => confidenceRows(outline, data), [outline, data]);
  const showCards = !!cards && (Object.keys(cards.chapters).length > 0 || Object.keys(cards.tags).length > 0);

  const { chapters, topics } = useMemo(() => {
    const ratingBy = new Map([...ratings.chapters, ...ratings.topics].map((r) => [r.key, r]));
    const cardsOf = (map: Record<string, CardConfidence> | undefined, id: string) => (showCards ? (map?.[id] ?? null) : null);
    const sorted = (rows: Row[]) => rows.filter((r) => r.rating || r.cards).sort((a, b) => weakness(b) - weakness(a));
    return {
      chapters: sorted(
        outline.chapters.map((c) => ({ key: c.id, label: c.title, href: `/chapter/${c.id}`, rating: ratingBy.get(`chapter/${c.id}`) ?? null, cards: cardsOf(cards?.chapters, c.id) })),
      ),
      topics: sorted(
        outline.tags
          .filter((tag) => tag.type === 'topic' && tag.review)
          .map((tag) => ({ key: tag.id, label: tag.label, href: null, rating: ratingBy.get(`topic/${tag.id}`) ?? null, cards: cardsOf(cards?.tags, tag.id) })),
      ),
    };
  }, [outline, ratings, cards, showCards]);

  if (chapters.length === 0 && topics.length === 0) return null;
  const names = { low: t.confidenceLow, okay: t.confidenceOkay, high: t.confidenceHigh };
  // The same words as the ratings beside them: one scale, measured two ways.
  const cardNames = { solid: t.confidenceHigh, learning: t.confidenceOkay, shaky: t.confidenceLow, fresh: t.cardsFresh };
  const grid = clsx('grid items-center gap-x-4 gap-y-1', showCards ? 'sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)]' : 'sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]');

  const Legend = ({ items }: { items: readonly (readonly [string, string, string])[] }) => (
    <ul className="flex flex-wrap gap-x-3 text-xs font-normal text-ink-3">
      {items.map(([key, name, color]) => (
        <li key={key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={clsx('size-2.5 rounded-sm', color)} /> {name}
        </li>
      ))}
    </ul>
  );
  const ratingLegend = RATING_SEGMENTS.map(([k, c]) => [k, names[k], c] as const);
  const cardLegend = CARD_SEGMENTS.map(([k, c]) => [k, cardNames[k], c] as const);

  const RatingCell = ({ row }: { row: Row }) => {
    const r = row.rating;
    if (!r) return <span className="text-xs text-ink-3">{t.notRatedYet}</span>;
    const rated = r.low + r.okay + r.high;
    const summary = `${row.label}: ${names.low} ${r.low}, ${names.okay} ${r.okay}, ${names.high} ${r.high}`;
    return (
      <div>
        <div role="img" aria-label={summary} title={summary} className="flex h-2.5 gap-0.5">
          {RATING_SEGMENTS.map(([name, color]) => (r[name] > 0 ? <span key={name} className={clsx('rounded-sm', color)} style={{ flexGrow: r[name], flexBasis: 0 }} /> : null))}
        </div>
        <span className="mt-1 block text-xs tabular-nums text-ink-3">{r.total ? t.ratedOf(rated, r.total) : t.ratedCount(rated)}</span>
      </div>
    );
  };

  const CardsCell = ({ row }: { row: Row }) =>
    row.cards && cardTotal(row.cards) ? (
      <div>
        <CardConfidenceBar value={row.cards} />
        <span className="mt-1 block text-xs tabular-nums text-ink-3">{t.deckCounts(cardTotal(row.cards))}</span>
      </div>
    ) : (
      <span className="text-xs text-ink-3">{t.noCardsHere}</span>
    );

  const Group = ({ title, rows }: { title: string; rows: Row[] }) => (
    <div>
      <h3 className="mb-1.5 text-[13px] font-medium text-ink-2">{title}</h3>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className={grid}>
            {r.href ? (
              <Link href={r.href} title={r.label} className="truncate text-sm hover:underline">
                {r.label}
              </Link>
            ) : (
              <span title={r.label} className="truncate text-sm">
                {r.label}
              </span>
            )}
            <div className="flex items-start gap-2">
              {showCards ? <span className="w-16 shrink-0 text-xs text-ink-3 sm:hidden">{t.yourRating}</span> : null}
              <div className="min-w-0 flex-1">
                <RatingCell row={r} />
              </div>
            </div>
            {showCards ? (
              <div className="flex items-start gap-2">
                <span className="w-16 shrink-0 text-xs text-ink-3 sm:hidden">{t.flashcards}</span>
                <div className="min-w-0 flex-1">
                  <CardsCell row={r} />
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">{t.confidenceOverview}</h2>
      <p className="mt-1 text-[13px] text-ink-2">{showCards ? t.confidenceHintWithCards : t.confidenceHint}</p>
      {showCards ? (
        <div className={clsx(grid, 'mt-4 hidden border-b border-line pb-2 sm:grid')}>
          <span />
          <div>
            <span className="mb-1 block text-[13px] font-medium">{t.yourRating}</span>
            <Legend items={ratingLegend} />
          </div>
          <div>
            <span className="mb-1 block text-[13px] font-medium">{t.yourFlashcards}</span>
            <Legend items={cardLegend} />
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <Legend items={ratingLegend} />
        </div>
      )}
      {showCards ? (
        // The legends above are only on wide screens.
        <dl className="mt-3 space-y-1.5 sm:hidden">
          {(
            [
              [t.yourRating, ratingLegend],
              [t.flashcards, cardLegend],
            ] as const
          ).map(([label, items]) => (
            <div key={label} className="flex items-baseline gap-2">
              <dt className="w-16 shrink-0 text-xs font-medium text-ink-2">{label}</dt>
              <dd>
                <Legend items={items} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="mt-3 space-y-5">
        {chapters.length ? <Group title={t.byChapter} rows={chapters} /> : null}
        {topics.length ? <Group title={t.byTopic} rows={topics} /> : null}
      </div>
    </section>
  );
}
