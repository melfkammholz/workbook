import { useEffect, useState } from 'react';
import type { HowSolved } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { Button, Dialog, clsx } from './ui';

export type ReflectionMode = 'done' | 'review';

export interface ReflectionInput {
  confidence: number | null;
  how: HowSolved[];
  comment: string;
}

/**
 * Shown after marking an exercise done or for review. Two taps for the common
 * case, every field optional, and the whole thing can be skipped. The answers
 * feed the review page.
 */
export function ReflectionDialog({
  open,
  mode,
  onClose,
  title,
  suggestedHow,
  initialComment,
  onSubmit,
}: {
  open: boolean;
  mode: ReflectionMode;
  onClose: () => void;
  title: string;
  suggestedHow: HowSolved[];
  initialComment: string;
  onSubmit: (input: ReflectionInput) => void;
}) {
  const t = useT();
  const [confidence, setConfidence] = useState<number | null>(null);
  const [how, setHow] = useState<HowSolved[]>(suggestedHow);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (open) {
      setConfidence(null);
      setHow(suggestedHow);
      setComment(initialComment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (h: HowSolved) => setHow((cur) => (cur.includes(h) ? cur.filter((x) => x !== h) : [...cur, h]));
  const HOW: [HowSolved, string][] = [
    ['alone', t.howAlone],
    ['hints', t.howHints],
    ['solution', t.howSolution],
    ['asked', t.howAsked],
    ['ai', t.howAi],
  ];
  const review = mode === 'review';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={review ? t.reviewLaterTitle : t.howDidItGo} description={review ? t.reviewLaterBody(title) : title}>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          {t.howConfident} <span className="font-normal text-ink-3">{t.optional}</span>
        </legend>
        <div className="grid grid-cols-5 gap-1.5">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={confidence === n}
              onClick={() => setConfidence(confidence === n ? null : n)}
              className={clsx('flex flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-center transition-colors', confidence === n ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-paper hover:border-line-strong')}
            >
              <span className="text-lg font-semibold leading-none tabular-nums">{n}</span>
              <span className="text-[11.5px] leading-tight text-ink-2">{t.confidence[n]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {review ? null : (
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-medium">{t.howGotThere}</legend>
          <div className="flex flex-wrap gap-1.5">
            {HOW.map(([h, label]) => (
              <button
                key={h}
                type="button"
                aria-pressed={how.includes(h)}
                onClick={() => toggle(h)}
                className={clsx('rounded-full border px-3 py-1 text-[13px]', how.includes(h) ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-paper text-ink-2 hover:border-line-strong')}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <label className="mt-5 block">
        <span className="mb-1.5 block text-sm font-medium">
          {review ? t.whatIsOpen : t.anythingUnclear} <span className="font-normal text-ink-3">{t.optional}</span>
        </span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={review ? 3 : 2}
          className="w-full resize-none rounded-md border border-line bg-paper px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          placeholder={review ? t.openPlaceholder : t.unclearPlaceholder}
        />
      </label>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t.skip}
        </Button>
        <Button
          variant="primary"
          disabled={confidence === null && !comment.trim() && comment === initialComment}
          onClick={() => {
            onSubmit({ confidence, how, comment: comment.trim() });
            onClose();
          }}
        >
          {t.save}
        </Button>
      </div>
    </Dialog>
  );
}
