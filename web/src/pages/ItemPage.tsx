import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel } from 'react-resizable-panels';
import { useLocation } from 'wouter';
import type { HowSolved, Status } from '@wb/shared';
import { ConfirmDialog } from '@/components/Dialogs';
import { CardInvitation, ContinueBanner, ExerciseBar, HelpPrompt } from '@/components/ExerciseBar';
import { ExerciseView } from '@/components/ExerciseView';
import { MakeCardDialog } from '@/components/MakeCardDialog';
import { ReflectionDialog, type ReflectionInput, type ReflectionMode } from '@/components/ReflectionDialog';
import { TaskColumn } from '@/components/TaskColumn';
import { Button, Empty, ResizeHandle, Spinner, clsx } from '@/components/ui';
import { api, indexItems, keys, neighbours, postReflection, recordHints, recordOpen, resetTimer, saveOpenQuestion, statusOf, useItem, useOutline, useSetStatus, useSettings, useState_, useWork, whatsNext, type Work } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useActiveTime, useMediaQuery } from '@/lib/useActiveTime';
import { plainTitle } from '@/components/Title';

export function ItemPage({ id }: { id: string }) {
  const t = useT();
  const outline = useOutline();
  const detail = useItem(id, outline.data?.version);

  if (outline.isPending || detail.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!outline.data || detail.isError || !detail.data) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.doesNotExist}>{t.doesNotExistBody}</Empty>
      </div>
    );
  }
  return <Loaded key={id} id={id} />;
}

function Loaded({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const outline = useOutline().data!;
  const detail = useItem(id, outline.version).data!;
  const state = useState_().data?.state;
  const settings = useSettings().data;
  const work = useWork(id);
  const setStatus = useSetStatus();
  const { map } = useMemo(() => indexItems(outline), [outline]);
  const wide = useMediaQuery('(min-width: 1024px)');
  const [pane, setPane] = useState<'task' | 'work'>('task');
  const [reflecting, setReflecting] = useState<ReflectionMode | null>(null);
  const [suggestedHow, setSuggestedHow] = useState<HowSolved[]>(['alone']);
  const [hints, setHints] = useState<number | null>(null);
  const [confirmTimer, setConfirmTimer] = useState(false);
  const [timerResets, setTimerResets] = useState(0);
  const [makingCard, setMakingCard] = useState(false);
  const flashcardsOn = !!settings?.showFlashcards;
  // A quiet invitation after finishing or after rating oneself low. Never more than once per visit.
  const [invite, setInvite] = useState<'done' | 'low' | null>(null);
  const invited = useRef(false);

  const meta = detail.meta;
  const ex = meta.type === 'exercise' ? meta : null;
  const status = statusOf(state, id);
  // Until the status is known, an already finished exercise must not start counting.
  const stateUnknown = state === undefined;

  useEffect(() => {
    void recordOpen(id).then(() => qc.invalidateQueries({ queryKey: keys.state }));
    document.title = `${plainTitle(meta.title)} · ${outline.title}`;
    return () => {
      document.title = outline.title;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const makeCardRef = useRef<(() => void) | null>(null);
  makeCardRef.current = flashcardsOn ? () => setMakingCard(true) : null;
  // Alt+, and Alt+. move through the course. By key position, so it works on every keyboard layout.
  const [, navigate] = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || document.querySelector('[role=dialog]')) return;
      // Alt+C: a card, whenever something is worth remembering.
      if (e.code === 'KeyC' && !e.shiftKey && makeCardRef.current) {
        e.preventDefault();
        makeCardRef.current();
        return;
      }
      if (e.code !== 'Comma' && e.code !== 'Period') return;
      const target = neighbours(outline, id, qc.getQueryData<{ state: NonNullable<typeof state> }>(keys.state)?.state)[e.code === 'Comma' ? 'previous' : 'next'];
      if (!target) return;
      e.preventDefault();
      navigate(`/item/${target.id}`);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [id, outline, navigate, qc]);

  const { session, reset: resetSession, paused, togglePaused } = useActiveTime(id, stateUnknown || status === 'done');

  // Time from earlier visits is read once: what this visit adds is counted here, and a
  // refetch of the work (which already contains part of it) must not count it twice.
  const earlier = useRef<number | null>(null);
  if (earlier.current === null && work.data) earlier.current = work.data.stats.activeSeconds;
  const seconds = (earlier.current ?? 0) + session;

  const restartTimer = () => {
    earlier.current = 0;
    resetSession();
    // The question may come again now, after the new time.
    try {
      localStorage.removeItem(`wb-help-dismissed-${id}`);
    } catch {
      /* it just stays dismissed */
    }
    setTimerResets((n) => n + 1);
    void resetTimer(id).then(() => qc.invalidateQueries({ queryKey: keys.mine }));
  };

  const changeStatus = useCallback(
    async (s: Status) => {
      setStatus.mutate({ id, status: s });
      void qc.invalidateQueries({ queryKey: keys.mine });
      if (!ex) return;
      if (s === 'review') setReflecting('review');
      if (s === 'done') {
        // Suggest how it went from what actually happened.
        try {
          const w = await api.get<Work>(`/api/work/${encodeURIComponent(id)}`);
          const how: HowSolved[] = [];
          if (w.stats.hintsRevealed > 0) how.push('hints');
          if (w.stats.solutionViewedAt) how.push('solution');
          setSuggestedHow(how.length ? how : ['alone']);
        } catch {
          setSuggestedHow(['alone']);
        }
        setReflecting('done');
      }
    },
    [ex, id, qc, setStatus],
  );

  const onActivity = useCallback(() => {
    if (statusOf(qc.getQueryData<{ state: NonNullable<typeof state> }>(keys.state)?.state, id) === 'todo') setStatus.mutate({ id, status: 'in_progress' });
  }, [id, qc, setStatus]);

  const lesson = meta.type === 'lesson';
  if (work.isPending && (ex || lesson)) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  const w = work.data;
  const revealed = hints ?? w?.stats.hintsRevealed ?? 0;
  const lastReflection = w?.reflections[w.reflections.length - 1];

  const around = neighbours(outline, id, state);
  const upNext = status === 'done' ? whatsNext(outline, state, id) : null;

  const revealHint = (n: number) => {
    setHints(n);
    void recordHints(id, n);
  };

  const task = (
    // A container, so wide widgets in a lesson know how much room the page has.
    <div className="@container h-full overflow-y-auto">
      <TaskColumn
        detail={detail}
        outline={outline}
        byId={map}
        state={state}
        revealedHints={revealed}
        onRevealHint={revealHint}
      />
    </div>
  );

  // Information pages have no workspace. A lesson has the bar: time, a card, and saying it is done.
  if (!ex || !w) {
    if (!lesson || !w) return task;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ExerciseBar
          status={status}
          onStatus={(s) => void changeStatus(s)}
          confidenceLabel={null}
          onRate={() => undefined}
          seconds={seconds}
          showTimer={settings?.showTimer ?? true}
          finished={status === 'done'}
          onResetTimer={() => setConfirmTimer(true)}
          paused={paused}
          onTogglePause={togglePaused}
          previous={around.previous}
          next={around.next}
          onMakeCard={flashcardsOn ? () => setMakingCard(true) : undefined}
        />
        {status === 'done' && upNext ? <ContinueBanner next={upNext} /> : null}
        <div className="min-h-0 flex-1">{task}</div>
        {flashcardsOn ? <MakeCardDialog open={makingCard} onClose={() => setMakingCard(false)} exerciseId={id} /> : null}
        <ConfirmDialog open={confirmTimer} onClose={() => setConfirmTimer(false)} title={t.confirmResetTimer} confirmLabel={t.resetTimerButton} onConfirm={restartTimer}>
          {t.resetTimerBody}
        </ConfirmDialog>
      </div>
    );
  }

  const submitReflection = async ({ confidence, how, comment }: ReflectionInput) => {
    const review = reflecting === 'review';
    const writes: Promise<unknown>[] = [];
    if (confidence !== null) writes.push(postReflection(id, confidence, review ? (lastReflection?.how ?? []) : how, review ? '' : comment));
    // What is unclear stays open until the student says otherwise, whichever way it was asked.
    if (comment !== (w.openQuestion?.content ?? '')) writes.push(saveOpenQuestion(id, comment));
    await Promise.all(writes);
    if (flashcardsOn && !invited.current && confidence !== null && (confidence <= 2 || !review)) {
      invited.current = true;
      setInvite(confidence <= 2 ? 'low' : 'done');
    }
    void qc.invalidateQueries({ queryKey: keys.work(id) });
    void qc.invalidateQueries({ queryKey: keys.state });
    void qc.invalidateQueries({ queryKey: keys.mine });
  };

  const bar = (
    <ExerciseBar
      status={status}
      onStatus={(s) => void changeStatus(s)}
      confidenceLabel={lastReflection ? t.confidence[lastReflection.confidence] : null}
      onRate={() => setReflecting('done')}
      seconds={seconds}
      showTimer={settings?.showTimer ?? true}
      finished={status === 'done'}
      onResetTimer={() => setConfirmTimer(true)}
      paused={paused}
      onTogglePause={togglePaused}
      previous={around.previous}
      next={around.next}
      onMakeCard={flashcardsOn ? () => setMakingCard(true) : undefined}
    />
  );

  const hintsLeft = revealed < detail.rendered.hints.length;
  const invitation = invite ? (
    <CardInvitation
      kind={invite}
      onMake={() => {
        setInvite(null);
        setMakingCard(true);
      }}
      onDismiss={() => setInvite(null)}
    />
  ) : null;
  const banner =
    status === 'done' ? (
      upNext ? <ContinueBanner next={upNext} /> : null
    ) : (
      <HelpPrompt
        key={timerResets}
        id={id}
        seconds={seconds}
        afterMinutes={ex.helpAfterMinutes ?? settings?.helpAfterMinutes ?? 0}
        hintsLeft={hintsLeft}
        onHint={() => {
          revealHint(revealed + 1);
          setPane('task');
          // After the new hint has rendered.
          requestAnimationFrame(() => document.getElementById('wb-hints')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
        }}
        onQuestion={() => setReflecting('review')}
      />
    );

  const dialog = (
    <>
    <ReflectionDialog
      open={reflecting !== null}
      mode={reflecting ?? 'done'}
      onClose={() => setReflecting(null)}
      title={plainTitle(meta.title)}
      suggestedHow={lastReflection?.how.length ? lastReflection.how : suggestedHow}
      initialComment={w.openQuestion?.content ?? ''}
      onSubmit={(input) => void submitReflection(input)}
    />
    {flashcardsOn ? <MakeCardDialog open={makingCard} onClose={() => setMakingCard(false)} exerciseId={id} /> : null}
    <ConfirmDialog open={confirmTimer} onClose={() => setConfirmTimer(false)} title={t.confirmResetTimer} confirmLabel={t.resetTimerButton} onConfirm={restartTimer}>
      {t.resetTimerBody}
    </ConfirmDialog>
    </>
  );

  const workspace = (
    <ExerciseView
      detail={detail}
      meta={ex}
      work={w}
      onActivity={onActivity}
      onAllChecksPass={() => undefined}
      finished={status === 'done'}
      reviewing={status === 'review'}
      checkBanner={
        status !== 'done' ? (
          <Button variant="primary" size="sm" onClick={() => void changeStatus('done')}>
            {t.markDone}
          </Button>
        ) : null
      }
    />
  );

  if (!wide) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {bar}
        {banner}
        {invitation}
        <div role="tablist" className="flex border-b border-line bg-sheet">
          {(['task', 'work'] as const).map((p) => (
            <button key={p} role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={clsx('flex-1 py-2.5 text-sm font-medium', pane === p ? 'border-b-2 border-accent text-ink' : 'text-ink-3')}>
              {p === 'task' ? t.task : t.yourWork}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">{pane === 'task' ? task : workspace}</div>
        {dialog}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {bar}
      {banner}
      {invitation}
      <div className="min-h-0 flex-1">
        <Group orientation="horizontal" className="h-full">
          <Panel defaultSize="46" minSize="28">
            {task}
          </Panel>
          <ResizeHandle direction="row" />
          <Panel defaultSize="54" minSize="28">
            {workspace}
          </Panel>
        </Group>
      </div>
      {dialog}
    </div>
  );
}
