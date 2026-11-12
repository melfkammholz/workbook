import { useQueryClient } from '@tanstack/react-query';
import type { CardRating, ReviewNext, StrugglingCard } from '@wb/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CardFace } from '@/components/CardFace';
import { Quiz, partsOfHtml } from '@/components/widgets';
import { StrugglingCardView } from '@/components/StrugglingCardView';
import { Button, Chip, Dialog, Spinner, clsx } from '@/components/ui';
import { api } from '@/lib/api';
import { CardAnchorLink } from '@/lib/cardAnchor';
import { showAnnotationOnArrival } from '@/lib/annotations';
import { buryCard, cardKeys, nextCard, rateCard } from '@/lib/flashcards';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { Title } from '@/components/Title';

const RATINGS: CardRating[] = [1, 2, 3, 4];

/**
 * One card at a time, in the middle of the window. The server decides what comes
 * next, so cards that were forgotten come back within the session. Leaving at any
 * point is fine: there is no streak to break and nothing is lost.
 */
export function FlashcardReview({ deckIds }: { deckIds: string[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [next, setNext] = useState<ReviewNext | null>(null);
  const [revealed, setRevealed] = useState(false);
  /** For a quiz card: the rating its first pick suggests. */
  const [suggested, setSuggested] = useState<CardRating | null>(null);
  /** A number key's pick on a quiz card, handed to the quiz (n makes the same number pressed twice count). */
  const [pick, setPick] = useState<{ i: number; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** A card that was just forgotten once too often. */
  const [slipping, setSlipping] = useState<{ deckId: string; cardId: string } | null>(null);
  const [fixing, setFixing] = useState<StrugglingCard | null>(null);
  const ahead = useRef(false);
  const key = deckIds.join(',');

  const load = useCallback(async () => {
    try {
      setNext(await nextCard(key.split(','), ahead.current));
      setRevealed(false);
      setSuggested(null);
      setPick(null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [key]);

  useEffect(() => {
    void load();
    // What the deck list shows has changed.
    return () => void qc.invalidateQueries({ queryKey: cardKeys.list });
  }, [load, qc]);

  const card = next?.card ?? null;

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        await load();
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );
  const rate = useCallback(
    (r: CardRating) =>
      card &&
      void act(async () => {
        const res = await rateCard(card.key, r);
        setSlipping(res.struggling ? { deckId: card.deckId, cardId: card.cardId } : null);
      }),
    [act, card],
  );

  const fixNow = async () => {
    if (!slipping) return;
    const list = await api.get<StrugglingCard[]>(`/api/flashcards/struggling?deck=${encodeURIComponent(slipping.deckId)}`);
    setFixing(list.find((s) => s.card.id === slipping.cardId) ?? null);
    setSlipping(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role=dialog]')) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable=true]')) return;
      // A quiz card: before the first pick, a number picks an answer; after it, numbers rate as for any card.
      if (!revealed && card.kind === 'quiz' && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        setPick({ i: Number(e.key) - 1, n: Date.now() });
      } else if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        rate(Number(e.key) as CardRating);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [card, revealed, rate]);

  const back = deckIds.length === 1 ? `/flashcards/deck/${deckIds[0]}` : '/flashcards';

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-6 pt-5 text-sm text-ink-2 sm:px-8">
        <BackLink fallback={back} label={t.back} />
        <span className="truncate font-medium text-ink">{card?.deckTitle ?? t.flashcards}</span>
        {next && card ? <span className="ml-auto tabular-nums">{t.reviewLeft(next.due, next.fresh)}</span> : null}
      </div>

      {/* Centred in the window, a little above the middle, where the eye rests. */}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-[12vh] pt-6 sm:px-8">

        {failed ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {t.serverGoneBody}
          </p>
        ) : !next ? (
          <div className="grid place-items-center">
            <Spinner />
          </div>
        ) : !card ? (
          <div className="settle text-center">
            <h1 className="text-xl font-semibold tracking-tight">{t.sessionDone}</h1>
            <p className="mx-auto mt-2 max-w-md text-ink-2">{t.sessionDoneBody}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href={back} className="inline-flex h-8.5 items-center rounded-md border border-line-strong bg-sheet px-3.5 text-sm hover:bg-sunk">
                {t.backToDecks}
              </Link>
              {next.ahead > 0 ? (
                <Button
                  onClick={() => {
                    ahead.current = true;
                    void load();
                  }}
                  title={t.reviewAheadHint}
                >
                  {t.reviewAhead(next.ahead)}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div key={card.key} className="settle">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {card.isNew ? <Chip tone="accent">{t.cardNew}</Chip> : null}
              {card.reversed ? <Chip>{t.cardReversed}</Chip> : null}
              {card.gap !== null ? <Chip>{t.cardGap(card.gap)}</Chip> : null}
              {deckIds.length > 1 ? <span className="ml-auto text-[12.5px] text-ink-3">{card.deckTitle}</span> : null}
            </div>
            <div className="rounded-xl border border-line bg-sheet shadow-sm">
              {card.kind === 'quiz' ? (
                <div className="min-h-24 px-6 py-5">
                  <Quiz
                    bare
                    parts={partsOfHtml(card.front)}
                    reveal={revealed}
                    pick={pick}
                    onPick={(right) => {
                      setSuggested(right ? 3 : 1);
                      setRevealed(true);
                    }}
                  />
                </div>
              ) : (
                <CardFace html={card.front} css={card.css} gap={card.gap} revealed={revealed && card.kind === 'cloze'} className="min-h-24 px-6 py-5 text-[15px]" />
              )}
              {revealed && card.kind !== 'cloze' && card.kind !== 'quiz' ? <CardFace html={card.back} css={card.css} gap={null} revealed className="border-t border-line bg-paper px-6 py-5 text-[15px]" /> : null}
              {revealed && card.anchor ? (
                <p className="border-t border-line px-6 py-2 text-[12.5px] text-ink-3">
                  <CardAnchorLink anchor={card.anchor} />
                </p>
              ) : null}
              {revealed && (card.origin || card.highlight) ? (
                <p className="border-t border-line px-6 py-2 text-[12.5px] text-ink-3">
                  {t.cardFrom}{' '}
                  {card.origin ? (
                    card.origin.href ? (
                      <a href={card.origin.href} className="text-accent hover:underline">
                        <Title text={card.origin.title} />
                      </a>
                    ) : (
                      <Title text={card.origin.title} />
                    )
                  ) : null}
                  {card.highlight ? (
                    <>
                      {card.origin ? ', ' : ''}
                      {card.highlight.href ? (
                        <a href={card.highlight.href} onClick={() => showAnnotationOnArrival(card.highlight!.id)} className="text-accent hover:underline">
                          “{card.highlight.quote.trim().slice(0, 80)}”
                        </a>
                      ) : (
                        <>“{card.highlight.quote.trim().slice(0, 80)}”</>
                      )}
                    </>
                  ) : null}{' '}
                  · {(card.origin ?? card.highlight)!.courseTitle}
                </p>
              ) : null}
            </div>

            <div className="mt-5">
              {!revealed ? (
                <Button variant="primary" className="w-full justify-center" onClick={() => setRevealed(true)}>
                  {t.showAnswer}
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={t.reviewKeys}>
                  {RATINGS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={busy}
                      onClick={() => rate(r)}
                      className={clsx(
                        'flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors disabled:opacity-50',
                        r === 1 ? 'border-line-strong bg-sheet hover:border-review hover:bg-review-soft' : 'border-line-strong bg-sheet hover:border-accent hover:bg-accent-soft',
                        r === suggested && 'ring-3 ring-accent-soft border-accent',
                      )}
                    >
                      {t.rating[r]}
                      <span className="text-[12px] font-normal tabular-nums text-ink-3">{t.interval(card.intervals[r])}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-3">
                <span className="hidden sm:inline">{card.kind === 'quiz' && !revealed ? t.reviewKeysQuiz : t.reviewKeys}</span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={busy} title={t.notTodayHint} onClick={() => void act(() => buryCard(card.key))}>
                    {t.notToday}
                  </Button>
                  <Link href={`/flashcards/deck/${card.deckId}/card/${card.cardId}`} className="rounded-md px-2.5 py-1 hover:bg-sunk hover:text-ink">
                    {t.editCard}
                  </Link>
                </span>
              </div>
            </div>
          </div>
        )}
        {/* After the card that slipped, under the next one: the offer never comes between a student and the question. */}
        {slipping ? (
          <div className="settle mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-review/40 bg-review-soft px-4 py-2.5 text-sm text-review" role="status">
            <span className="flex-1">{t.slippingOffer}</span>
            <Button size="sm" onClick={() => void fixNow()}>
              {t.fixNow}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSlipping(null)}>
              {t.later}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={fixing !== null} onOpenChange={(o) => !o && setFixing(null)} title={t.cardsToLookAt} width="max-w-2xl">
        {fixing ? (
          <StrugglingCardView
            item={fixing}
            onDone={() => {
              setFixing(null);
              void load();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
