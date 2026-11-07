import { useQueryClient } from '@tanstack/react-query';
import type { StrugglingCard } from '@wb/shared';
import { Check, Pencil, Scissors, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { addCard, cardKeys, deleteCard, editCard, keepCard } from '@/lib/flashcards';
import { useT } from '@/lib/i18n';
import { CardFace } from './CardFace';
import { CardForm } from './CardForm';
import { Button, clsx } from './ui';
import { Title } from '@/components/Title';

type Mode = 'look' | 'rewrite' | 'split-new' | 'split-old' | 'drop';

/**
 * A card that keeps being forgotten. Usually the card is the problem, not the
 * student: it asks too much at once, or its answer can be guessed without knowing.
 * So it is offered to be rewritten, split or dropped, or kept on purpose.
 */
export function StrugglingCardView({ item, onDone }: { item: StrugglingCard; onDone: (what: 'rewritten' | 'split' | 'dropped' | 'kept') => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('look');
  const c = item.card;
  const refresh = () => void qc.invalidateQueries({ queryKey: cardKeys.all });

  const ratingClass = (r: number) => (r === 1 ? 'bg-confidence-low wb-stripes' : r === 2 ? 'bg-confidence-low/50' : r === 3 ? 'bg-confidence-high/70' : 'bg-confidence-high');

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-sheet">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-[12.5px] text-ink-3">
        <span className="font-medium text-ink-2">{item.deckTitle}</span>
        {item.origin ? <span>{t.cardFrom} <Title text={item.origin.title} /></span> : null}
        <span className="ml-auto">{t.forgottenTimes(item.lapses)}</span>
        <span className="flex items-center gap-0.5" role="img" aria-label={item.ratings.map((r) => t.rating[r.rating]).join(', ')}>
          {item.ratings.map((r, i) => (
            <span key={i} title={`${t.rating[r.rating]} · ${new Date(r.at).toLocaleDateString()}`} className={clsx('h-3 w-1.5 rounded-sm', ratingClass(r.rating))} />
          ))}
        </span>
      </div>

      {mode === 'look' || mode === 'drop' ? (
        <>
          {item.rendered ? (
            <div className={clsx('grid', c.kind !== 'cloze' && 'sm:grid-cols-2')}>
              <CardFace html={item.rendered.front} css={item.css} gap={null} revealed className="min-w-0 px-4 py-3" />
              {c.kind !== 'cloze' ? <CardFace html={item.rendered.back} css={item.css} gap={null} revealed className="min-w-0 border-t border-line bg-paper px-4 py-3 sm:border-l sm:border-t-0" /> : null}
            </div>
          ) : null}
          <div className="border-t border-line px-4 py-3">
            {mode === 'drop' ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 text-ink-2">{t.dropCardBody}</span>
                <Button variant="ghost" onClick={() => setMode('look')}>
                  {t.cancel}
                </Button>
                <Button
                  onClick={async () => {
                    await deleteCard(item.deckId, c.id);
                    refresh();
                    onDone('dropped');
                  }}
                >
                  {t.dropCard}
                </Button>
              </div>
            ) : (
              <>
                <p className="mb-2 text-[13px] text-ink-2">{t.strugglingWhy}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setMode('rewrite')}>
                    <Pencil size={13} /> {t.rewriteCard}
                  </Button>
                  <Button size="sm" onClick={() => setMode('split-new')}>
                    <Scissors size={13} /> {t.splitCard}
                  </Button>
                  <Button size="sm" onClick={() => setMode('drop')}>
                    <Trash2 size={13} /> {t.dropCard}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t.keepCardHint}
                    onClick={async () => {
                      await keepCard(c.id);
                      refresh();
                      onDone('kept');
                    }}
                  >
                    <Check size={13} /> {t.keepCard}
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="p-4">
          <p className="mb-3 text-[13px] text-ink-2">{mode === 'rewrite' ? t.rewriteHint : mode === 'split-new' ? t.splitNewHint : t.splitOldHint}</p>
          <CardForm
            key={mode}
            autoFocus
            initial={mode === 'split-new' ? { kind: c.kind, front: c.front, back: c.back, tags: c.tags } : c}
            submitLabel={mode === 'split-new' ? t.addSecondCard : t.save}
            onCancel={() => setMode('look')}
            onSubmit={async (f) => {
              if (mode === 'split-new') {
                await addCard(item.deckId, { ...f, exercise: null, after: c.id, from: c.from });
                setMode('split-old');
                return;
              }
              await editCard(item.deckId, c.id, f);
              // Rewritten: the old history no longer says much about the new card, but it is kept.
              await keepCard(c.id);
              refresh();
              onDone(mode === 'split-old' ? 'split' : 'rewritten');
            }}
          />
        </div>
      )}
    </article>
  );
}
