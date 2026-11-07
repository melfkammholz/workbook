import type { CardConfidence, CourseCards, Outline } from '@wb/shared';
import { Link } from 'wouter';
import { useT } from '@/lib/i18n';
import { CardConfidenceBar } from './CardConfidenceBar';

interface Row {
  key: string;
  label: string;
  href: string | null;
  value: CardConfidence;
}

/** Share of what is not solid yet: shakiest first, as in the self-evaluations. */
const shakiness = (v: CardConfidence) => (v.shaky + v.fresh * 0.5) / Math.max(1, v.solid + v.shaky + v.fresh);

/**
 * How well the flashcards from this course's exercises are known, by chapter and by topic.
 * A panel of its own: it measures what is remembered, not how sure someone felt.
 */
export function CardsOverview({ outline, cards }: { outline: Outline; cards: CourseCards }) {
  const t = useT();
  const chapters: Row[] = outline.chapters.flatMap((c) => (cards.chapters[c.id] ? [{ key: c.id, label: c.title, href: `/chapter/${c.id}`, value: cards.chapters[c.id]! }] : []));
  const topics: Row[] = outline.tags.flatMap((tag) => (tag.type === 'topic' && tag.review && cards.tags[tag.id] ? [{ key: tag.id, label: tag.label, href: null, value: cards.tags[tag.id]! }] : []));
  if (!chapters.length && !topics.length) return null;
  const sorted = (rows: Row[]) => [...rows].sort((a, b) => shakiness(b.value) - shakiness(a.value));
  const total = (v: CardConfidence) => v.solid + v.shaky + v.fresh;

  const Bars = ({ title, rows }: { title: string; rows: Row[] }) => (
    <div>
      <h3 className="mb-1.5 text-[13px] font-medium text-ink-2">{title}</h3>
      <ul className="space-y-2">
        {sorted(rows).map((r) => (
          <li key={r.key} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_9rem]">
            {r.href ? (
              <Link href={r.href} className="truncate text-sm hover:underline">
                {r.label}
              </Link>
            ) : (
              <span className="truncate text-sm">{r.label}</span>
            )}
            <CardConfidenceBar value={r.value} />
            <span className="text-xs tabular-nums text-ink-3 sm:text-right">{t.deckCounts(total(r.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className="mt-4 rounded-lg border border-line bg-sheet p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">{t.yourFlashcards}</h2>
        <CardLegend />
      </div>
      <p className="mt-1 text-[13px] text-ink-2">{t.yourFlashcardsHint}</p>
      <div className="mt-3 space-y-4">
        {chapters.length ? <Bars title={t.byChapter} rows={chapters} /> : null}
        {topics.length ? <Bars title={t.byTopic} rows={topics} /> : null}
      </div>
    </section>
  );
}

function CardLegend() {
  const t = useT();
  const items: [string, string][] = [
    [t.cardsShaky, 'bg-confidence-low wb-stripes'],
    [t.cardsSolid, 'bg-confidence-high'],
    [t.cardsFresh, 'border border-dashed border-ink-3'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-3 text-xs text-ink-2">
      {items.map(([name, cls]) => (
        <li key={name} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`size-3 rounded-sm ${cls}`} /> {name}
        </li>
      ))}
    </ul>
  );
}
