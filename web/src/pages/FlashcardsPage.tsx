import { useQueryClient } from '@tanstack/react-query';
import type { DeckSummary } from '@wb/shared';
import { Pencil, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CardConfidenceBar } from '@/components/CardConfidenceBar';
import { Button, Empty, IconButton, Segmented, Spinner } from '@/components/ui';
import { readPref, writePref } from '@/lib/shell';
import { useOutline } from '@/lib/api';
import { cardKeys, createDeck, useFlashcards } from '@/lib/flashcards';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';

const SORTS = ['order', 'shaky', 'due'] as const;
type Sort = (typeof SORTS)[number];
const SORT_KEY = 'wb-deck-sort';

/** Not solid yet, as a share: new cards count half, they are not known to be shaky. */
const shakiness = (d: DeckSummary) => {
  const { solid, learning, shaky, fresh } = d.confidence;
  return (shaky + (learning + fresh) * 0.5) / Math.max(1, solid + learning + shaky + fresh);
};

function sortDecks(decks: DeckSummary[], sort: Sort): DeckSummary[] {
  if (sort === 'order') return decks;
  const key = sort === 'shaky' ? shakiness : (d: DeckSummary) => d.due + d.fresh;
  return [...decks].sort((a, b) => key(b) - key(a));
}

/**
 * The student's decks. Those of the open course come first. A session is one deck,
 * or a few picked together: never everything at once, so it is clear what it is about.
 */
export function FlashcardsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const list = useFlashcards();
  const course = useOutline().data;
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [sort, setSortState] = useState<Sort>(() => readPref(SORT_KEY, SORTS, 'order'));
  const setSort = (s: Sort) => {
    setSortState(s);
    writePref(SORT_KEY, s);
  };

  if (!list.data) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  const { decks } = list.data;
  const ordered = sortDecks(decks, sort);
  const mine = course ? ordered.filter((d) => d.settings.courses.includes(course.id)) : [];
  const others = ordered.filter((d) => !mine.includes(d));
  const struggling = decks.reduce((n, d) => n + d.struggling, 0);
  const pickedWaiting = decks.filter((d) => picked.includes(d.id)).reduce((n, d) => n + d.due + d.fresh, 0);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const deck = await createDeck(title.trim(), !!course);
      void qc.invalidateQueries({ queryKey: cardKeys.all });
      navigate(`/flashcards/deck/${deck.id}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const group = (heading: string | null, items: DeckSummary[]) =>
    items.length ? (
      <section className="mt-8">
        {heading ? <h2 className="mb-2 text-[15px] font-semibold">{heading}</h2> : null}
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-sheet">
          {items.map((d) => (
            <DeckRow key={d.id} deck={d} picked={picked.includes(d.id)} onPick={() => toggle(d.id)} onEdit={() => navigate(`/flashcards/deck/${d.id}`)} />
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="settle mx-auto max-w-3xl px-6 pb-24 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.flashcards}</h1>
        <p className="mt-2 max-w-prose text-ink-2">{t.flashcardsIntro}</p>

        {struggling ? (
          <Link href="/flashcards/look" className="mt-5 flex items-center gap-2.5 rounded-lg border border-review/40 bg-review-soft px-4 py-2.5 text-sm text-review hover:brightness-[0.98]">
            <TriangleAlert size={16} className="shrink-0" />
            <span className="flex-1">{t.strugglingBanner(struggling)}</span>
            <span className="font-medium">{t.lookAtThem}</span>
          </Link>
        ) : null}

        {decks.length ? (
          <>
            {decks.length > 1 ? (
              <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-2">{t.sortDecks}</span>
                <Segmented<Sort> value={sort} onChange={setSort} options={SORTS.map((s) => [s, t.deckSort[s]])} />
              </div>
            ) : null}
            {group(mine.length && course ? t.decksFor(course.title) : null, mine)}
            {group(mine.length ? t.otherDecks : null, others)}
            {picked.length ? (
              <div className="sticky bottom-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-sheet px-4 py-3 shadow-[var(--shadow)]">
                <span className="flex-1 text-sm text-ink-2">{t.pickedDecks(picked.length, pickedWaiting)}</span>
                <Button variant="ghost" onClick={() => setPicked([])}>
                  {t.cancel}
                </Button>
                <Button variant="primary" disabled={!pickedWaiting} onClick={() => navigate(`/flashcards/review/${picked.join(',')}`)}>
                  {t.reviewTogether}
                </Button>
              </div>
            ) : decks.length > 1 ? (
              <p className="mt-3 text-[12.5px] text-ink-3">{t.pickDecksHint}</p>
            ) : null}
          </>
        ) : (
          <div className="mt-8">
            <Empty title={t.noDecks}>{t.noDecksBody}</Empty>
          </div>
        )}

        <form onSubmit={(e) => void create(e)} className="mt-8 rounded-xl border border-line bg-sheet p-4">
          <label className="block text-sm font-medium" htmlFor="wb-new-deck">
            {t.newDeck}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="wb-new-deck"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={t.deckTitlePlaceholder}
              className="h-8.5 min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-3 text-sm focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!title.trim() || busy}
              aria-label={t.createDeck}
              title={t.createDeck}
              className="inline-flex size-8.5 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink hover:brightness-110 disabled:opacity-40"
            >
              <Plus size={17} />
            </button>
          </div>
          {course ? <p className="mt-1.5 text-[12.5px] text-ink-3">{t.newDeckForCourse(course.title)}</p> : null}
        </form>
      </div>
    </div>
  );
}

/** The name starts a review, the button opens the deck for editing. */
function DeckRow({ deck: d, picked, onPick, onEdit }: { deck: DeckSummary; picked: boolean; onPick: () => void; onEdit: () => void }) {
  const t = useT();
  const big = d.settings.maxCards > 0 && d.cards > d.settings.maxCards;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <input type="checkbox" checked={picked} onChange={onPick} aria-label={t.pickDeck(d.title)} className="size-4 shrink-0 accent-[var(--accent)]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <Link href={`/flashcards/review/${d.id}`} className="truncate font-medium hover:text-accent" title={t.reviewDeck}>
            {d.title}
          </Link>
          <span className="text-[13px] text-ink-3">
            {t.deckCounts(d.cards)} · {t.dueCounts(d.due, d.fresh)}
          </span>
          {big ? <span className="text-[12.5px] text-review">{t.deckIsBigShort}</span> : null}
        </div>
        <CardConfidenceBar value={d.confidence} legend className="mt-2 max-w-md" />
      </div>
      <IconButton label={t.editCard} onClick={onEdit} className="shrink-0">
        <Pencil size={15} />
      </IconButton>
    </li>
  );
}
