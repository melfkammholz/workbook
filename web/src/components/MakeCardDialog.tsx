import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { addCard, cardKeys, createDeck, useFlashcards } from '@/lib/flashcards';
import { useT } from '@/lib/i18n';
import { CardForm } from './CardForm';
import { Dialog } from './ui';

/**
 * The quick way to a card: it only appends one card to the deck's text, the same
 * as typing it there. The card remembers the exercise it was made in.
 */
export function MakeCardDialog({ open, onClose, exerciseId }: { open: boolean; onClose: () => void; exerciseId: string | null }) {
  const t = useT();
  const qc = useQueryClient();
  const list = useFlashcards();
  const decks = list.data?.decks ?? [];
  const [deckId, setDeckId] = useState<string | null>(null);
  const [added, setAdded] = useState<{ deckId: string; title: string } | null>(null);

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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.makeCard} description={t.makeCardHint} width="max-w-xl">
      <CardForm
        autoFocus
        submitLabel={t.addCard}
        onSubmit={async (f) => {
          // The first deck is made on the way, and belongs to the course it was made in.
          const target = deckId ?? (await createDeck(t.defaultDeckTitle, true)).id;
          await addCard(target, { ...f, exercise: exerciseId });
          setDeckId(target);
          setAdded({ deckId: target, title: deck?.title ?? t.defaultDeckTitle });
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
      {added ? (
        <p className="mt-3 text-sm text-done" role="status">
          {t.cardAdded(added.title)}{' '}
          <Link href={`/flashcards/deck/${added.deckId}`} onClick={onClose} className="font-medium text-accent hover:underline">
            {t.openDeck}
          </Link>
        </p>
      ) : null}
    </Dialog>
  );
}
