import { useQueryClient } from '@tanstack/react-query';
import type { DeckDoc } from '@wb/shared';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { addCard, cardKeys, createDeck, useFlashcards, type CardFields } from '@/lib/flashcards';
import { useT } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/useActiveTime';
import { CardForm, ROOMY, useCardLayout } from './CardForm';
import { Dialog } from './ui';

/**
 * The quick way to a card: it only appends one card to the deck's text, the same
 * as typing it there. The card remembers the exercise it was made in, and the highlight if it was made from one.
 */
export function MakeCardDialog({ open, onClose, exerciseId, highlightId = null, initial }: { open: boolean; onClose: () => void; exerciseId: string | null; highlightId?: string | null; initial?: Partial<CardFields> }) {
  const t = useT();
  const qc = useQueryClient();
  const list = useFlashcards();
  const decks = list.data?.decks ?? [];
  const [deckId, setDeckId] = useState<string | null>(null);
  const [added, setAdded] = useState<{ deckId: string; cardId: string; title: string; cards: number } | null>(null);
  const [layout] = useCardLayout();
  const roomy = useMediaQuery(ROOMY);
  const side = layout === 'side' && roomy;

  // The deck last added to, unless the student picks another.
  useEffect(() => {
    if (open && deckId === null && list.data) setDeckId(list.data.lastDeckId ?? list.data.decks[0]?.id ?? null);
  }, [open, deckId, list.data]);
  useEffect(() => {
    if (!open) setAdded(null);
  }, [open]);

  const deck = decks.find((d) => d.id === deckId);
  const big = deck && deck.settings.maxCards > 0 && deck.cards >= deck.settings.maxCards;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.makeCard} description={t.makeCardHint} width={side ? 'max-w-5xl' : 'max-w-xl'}>
      {added ? (
        // Keyed by card, so each new card is greeted again.
        <div key={added.cardId} role="status" className="settle mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-done/30 bg-done-soft px-3 py-2.5">
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-sheet text-done">
            <Check size={14} strokeWidth={2.5} />
          </span>
          <p className="min-w-0 flex-1 text-[13px]">
            <span className="font-medium text-ink">{t.cardAdded}</span> <span className="text-ink-2">{t.cardAddedTo(added.title, added.cards)}</span>
          </p>
          <Link
            href={`/flashcards/deck/${added.deckId}`}
            onClick={onClose}
            className="inline-flex h-7 shrink-0 items-center rounded-md border border-line-strong bg-sheet px-2.5 text-[13px] font-medium text-ink hover:bg-sunk"
          >
            {t.openDeck}
          </Link>
        </div>
      ) : null}
      <CardForm
        // A card started elsewhere (a quiz in a lesson) starts the form afresh.
        key={initial ? `${initial.kind}:${initial.front}` : 'blank'}
        initial={initial}
        fresh
        autoFocus
        submitLabel={t.addCard}
        onSubmit={async (f) => {
          // The first deck is made on the way, and belongs to the course it was made in.
          const target = deckId ?? (await createDeck(t.defaultDeckTitle, true)).id;
          const r = await addCard(target, { ...f, exercise: exerciseId, highlight: highlightId });
          setDeckId(target);
          setAdded({ deckId: target, cardId: r.cardId, title: deck?.title ?? t.defaultDeckTitle, cards: r.cards.length });
          // The deck, if it was open before, already has the card when it is opened again.
          qc.setQueryData<DeckDoc>(cardKeys.deck(target), (d) => (d ? { ...d, source: r.source, cards: r.cards } : d));
          void qc.invalidateQueries({ queryKey: cardKeys.all });
        }}
        footer={
          decks.length ? (
            <label className="block min-w-0 flex-1">
              <span className="text-sm font-medium">{t.intoDeck}</span>
              <select value={deckId ?? ''} onChange={(e) => setDeckId(e.target.value)} className="mt-1 block h-8.5 w-full rounded-md border border-line-strong bg-sheet px-2 focus:border-accent focus:outline-none">
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} ({t.deckCounts(d.cards)})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="flex-1" />
          )
        }
      />
      {big ? (
        <p className="mt-3 rounded-md bg-review-soft px-3 py-2 text-[13px] text-review" role="status">
          {t.deckIsBig(deck.cards, deck.settings.maxCards)}
        </p>
      ) : null}
    </Dialog>
  );
}
