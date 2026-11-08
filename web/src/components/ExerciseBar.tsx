import { ArrowRight, Bookmark, Check, ChevronLeft, ChevronRight, Layers, LifeBuoy, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { Link } from 'wouter';
import { useState } from 'react';
import type { ItemMeta, Status } from '@wb/shared';
import { formatClock } from '@/lib/attention';
import { useT } from '@/lib/i18n';
import { altKey } from '@/lib/keys';
import { Button, IconButton, clsx } from './ui';
import { StatusControl } from './StatusControl';
import { plainTitle } from '@/components/Title';
import { Title } from './Title';

/**
 * Always in view, whichever tab or pane is open: how far along this exercise is,
 * and the one-click ways to say so. Only the student decides when it is finished.
 */
export function ExerciseBar({
  status,
  onStatus,
  confidenceLabel,
  onRate,
  seconds,
  showTimer,
  finished,
  onResetTimer,
  paused,
  onTogglePause,
  previous,
  next,
  onMakeCard,
}: {
  status: Status;
  onStatus: (s: Status) => void;
  confidenceLabel: string | null;
  onRate: () => void;
  seconds: number;
  showTimer: boolean;
  /** Finished exercises do not count time, so there is nothing to pause. */
  finished: boolean;
  onResetTimer: () => void;
  paused: boolean;
  onTogglePause: () => void;
  previous: ItemMeta | undefined;
  next: ItemMeta | undefined;
  /** Flashcards are on: a card can be worth making at any moment, so it is always at hand. */
  onMakeCard?: (() => void) | undefined;
}) {
  const t = useT();
  const label = finished ? t.timerFinished : paused ? t.timerPaused : t.timeOnExercise;
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-sheet px-3">
      <nav aria-label={t.exerciseNavigation} className="flex items-center">
        <NavIcon item={previous} label={t.previousItem}>
          <ChevronLeft size={17} />
        </NavIcon>
        <NavIcon item={next} label={t.nextItem}>
          <ChevronRight size={17} />
        </NavIcon>
      </nav>
      {showTimer ? (
        <span className={clsx('inline-flex items-center gap-1.5 text-[13px] tabular-nums', paused && !finished ? 'text-review' : 'text-ink-3')} title={label} role="timer">
          <Timer size={14} aria-label={label} /> {formatClock(seconds)}
        </span>
      ) : null}
      {showTimer && !finished ? (
        <IconButton label={paused ? t.resumeTimer : t.pauseTimer} aria-pressed={paused} className="size-7" onClick={onTogglePause}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </IconButton>
      ) : null}
      {/* Always there, so nothing moves when the first second is counted. */}
      {showTimer ? (
        <IconButton label={t.resetTimer} disabled={seconds === 0} className="size-7 disabled:opacity-30" onClick={onResetTimer}>
          <RotateCcw size={13} />
        </IconButton>
      ) : null}
      {onMakeCard ? (
        <>
          {showTimer ? <span aria-hidden className="mx-1 h-4 w-px bg-line" /> : null}
          <button type="button" onClick={onMakeCard} title={`${t.makeCard} (${altKey}+C)`} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-3 hover:bg-sunk hover:text-ink">
            <Layers size={14} /> <span className="hidden sm:inline">{t.makeCard}</span>
          </button>
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {confidenceLabel ? (
          <button type="button" onClick={onRate} className="hidden rounded-md px-2 py-1 text-[13px] text-ink-2 hover:bg-sunk md:block" title={t.changeRating}>
            {t.confidenceIs(confidenceLabel)}
          </button>
        ) : null}
        {status !== 'review' ? (
          <Button size="sm" className="h-8" onClick={() => onStatus('review')} title={t.markReview} aria-label={t.markReview}>
            <Bookmark size={14} /> <span className="hidden sm:inline">{t.markReview}</span>
          </Button>
        ) : null}
        {status !== 'done' ? (
          <Button size="sm" variant="primary" className="h-8" onClick={() => onStatus('done')}>
            <Check size={14} /> {t.markDone}
          </Button>
        ) : null}
        <StatusControl status={status} onChange={onStatus} />
      </div>
    </div>
  );
}

function NavIcon({ item, label, children }: { item: ItemMeta | undefined; label: string; children: React.ReactNode }) {
  const box = 'inline-flex size-7 items-center justify-center rounded-md';
  if (!item) return <span aria-hidden className={clsx(box, 'text-ink-3 opacity-30')}>{children}</span>;
  const full = `${label}: ${plainTitle(item.title)}`;
  return (
    <Link href={`/item/${item.id}`} aria-label={full} title={full} className={clsx(box, 'text-ink-2 hover:bg-sunk hover:text-ink')}>
      {children}
    </Link>
  );
}

/** Once an exercise is finished, the obvious question is what comes next. */
export function ContinueBanner({ next }: { next: ItemMeta }) {
  const t = useT();
  return (
    <div className="settle flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-done/30 bg-done-soft px-4 py-2 text-sm">
      <Check size={16} className="shrink-0 text-done" aria-hidden />
      <span className="min-w-0 flex-1 basis-48 truncate"><Title text={t.continueWith(next.title)} /></span>
      <Link href={`/item/${next.id}`} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink hover:brightness-110">
        {t.continueButton} <ArrowRight size={14} />
      </Link>
    </div>
  );
}

/** After finishing, or after rating oneself low: a card is offered, never written for the student. */
export function CardInvitation({ kind, onMake, onDismiss }: { kind: 'done' | 'low'; onMake: () => void; onDismiss: () => void }) {
  const t = useT();
  return (
    <div className="settle flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-paper px-4 py-2 text-sm" role="status">
      <Layers size={16} className="shrink-0 text-ink-3" aria-hidden />
      <span className="min-w-0 flex-1 basis-48 text-ink-2">{kind === 'low' ? t.inviteLow : t.inviteDone}</span>
      <Button size="sm" onClick={onMake}>
        {t.makeCard}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {t.notNow}
      </Button>
    </div>
  );
}

/**
 * Asks once whether the student needs help, after enough active time on one
 * exercise. Dismissing it is remembered per exercise, in this browser, until the timer is reset.
 */
export function HelpPrompt({
  id,
  seconds,
  afterMinutes,
  hintsLeft,
  onHint,
  onQuestion,
}: {
  id: string;
  seconds: number;
  afterMinutes: number;
  hintsLeft: boolean;
  onHint: () => void;
  onQuestion: () => void;
}) {
  const t = useT();
  const key = `wb-help-dismissed-${id}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const due = afterMinutes > 0 && seconds >= afterMinutes * 60;
  if (!due || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* it may ask again, which is harmless */
    }
  };

  return (
    <div role="status" className={clsx('settle flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-review/30 bg-review-soft px-4 py-2.5 text-sm')}>
      <LifeBuoy size={18} className="shrink-0 text-review" aria-hidden />
      <p className="min-w-64 flex-1">
        <span className="font-medium">{t.stuckTitle(afterMinutes)}</span> {t.stuckBody} {t.stuckNotes}
      </p>
      <div className="flex items-center gap-2">
        {hintsLeft ? (
          <Button size="sm" onClick={onHint}>
            {t.stuckHint}
          </Button>
        ) : null}
        <Button size="sm" onClick={onQuestion}>
          {t.stuckQuestion}
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          <X size={14} /> {t.stuckDismiss}
        </Button>
      </div>
    </div>
  );
}
