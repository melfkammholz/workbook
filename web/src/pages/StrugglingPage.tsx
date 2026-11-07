import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { StrugglingCardView } from '@/components/StrugglingCardView';
import { Empty, Spinner } from '@/components/ui';
import { useStruggling } from '@/lib/flashcards';
import { useT } from '@/lib/i18n';

/** The meta review: cards that keep being forgotten, one deck or all. */
export function StrugglingPage({ deckId }: { deckId: string | null }) {
  const t = useT();
  const list = useStruggling(deckId);
  const [done, setDone] = useState<Record<string, string>>({});
  return (
    <div className="h-full overflow-y-auto">
      <div className="settle mx-auto max-w-3xl px-6 pb-24 pt-8 sm:px-8">
        <Link href={deckId ? `/flashcards/deck/${deckId}` : '/flashcards'} className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft size={15} /> {t.backToDecks}
        </Link>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.cardsToLookAt}</h1>
        <p className="mt-2 max-w-prose text-ink-2">{t.cardsToLookAtIntro}</p>
        {!list.data ? (
          <div className="mt-8">
            <Spinner />
          </div>
        ) : list.data.length === 0 ? (
          <div className="mt-8">
            <Empty title={t.noStrugglingCards}>{t.noStrugglingCardsBody}</Empty>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {list.data.map((item) =>
              done[item.card.id] ? (
                <p key={item.card.id} className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-done">
                  {t.strugglingDone(done[item.card.id]!)}
                </p>
              ) : (
                <StrugglingCardView key={item.card.id} item={item} onDone={(what) => setDone((d) => ({ ...d, [item.card.id]: what }))} />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
