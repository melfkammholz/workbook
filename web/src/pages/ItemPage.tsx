import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, PanelLeftOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, usePanelRef } from '@/components/Panels';
import { useLocation } from 'wouter';
import type { HowSolved, Reflection, Status } from '@wb/shared';
import { ConfirmDialog } from '@/components/Dialogs';
import { CardInvitation, ContinueBanner, ExerciseBar, HelpPrompt, LAYOUT_KEY } from '@/components/ExerciseBar';
import { ExerciseView } from '@/components/ExerciseView';
import { MakeCardDialog } from '@/components/MakeCardDialog';
import { ReflectionDialog, type ReflectionInput, type ReflectionMode } from '@/components/ReflectionDialog';
import { TaskColumn } from '@/components/TaskColumn';
import { Button, Empty, IconButton, Spinner, clsx } from '@/components/ui';
import { ResizeHandle } from '@/components/ResizeHandle';
import { afterPaint } from '@/lib/afterPaint';
import { api, indexItems, itemHref, keys, neighbours, patchWork, postReflection, recordHints, recordOpen, resetTimer, addQuestion, statusOf, useItem, useOutline, useSetStatus, useSettings, useState_, useWork, whatsNext, type Work } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { reportSaveFailed } from '@/lib/saveNotice';
import { useActiveTime, useMediaQuery } from '@/lib/useActiveTime';
import { usePageKeys } from '@/lib/keys';
import { useWorkLayout } from '@/lib/workLayout';
import { plainTitle } from '@/components/Title';

export function ItemPage({ id, group = null }: { id: string; group?: string | null }) {
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
  return <Loaded key={id} id={id} group={group} />;
}

/** The width of the strip the task folds into, in the wide layout. */
/** With warm paper the strip is a card of its own, 44 wide, with the background around it. */
const TASK_STRIP_PX = 58;

function Loaded({ id, group }: { id: string; group: string | null }) {
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
  // The wide layout folds the task into a strip; it opens over the editor, for as long as it is needed.
  const [workLayout, setWorkLayout] = useWorkLayout();
  const [taskOpen, setTaskOpen] = useState(false);
  const taskPanel = usePanelRef();
  useEffect(() => setTaskOpen(false), [id]);
  useEffect(() => {
    if (!taskOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTaskOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [taskOpen]);
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
  // The wide layout is the same panels with the task folded into a strip, so that nothing in the workspace is rebuilt.
  const strip = wide && workLayout === 'wide' && !!ex?.code?.runnable;
  useEffect(() => {
    const p = taskPanel.current;
    if (!p) return;
    if (strip) p.collapse();
    else if (p.isCollapsed()) p.expand();
  }, [strip, taskPanel]);
  // Folding the task (dragging it shut) is the wide layout, and unfolding it the standard one.
  const switchable = wide && !!ex?.code?.runnable;
  const onTaskResize = () => {
    const folded = taskPanel.current?.isCollapsed();
    if (!switchable || folded === undefined) return;
    if (folded && workLayout !== 'wide') setWorkLayout('wide');
    else if (!folded && workLayout === 'wide') setWorkLayout('standard');
  };
  // `w`: the same switch from the keyboard.
  usePageKeys({ [LAYOUT_KEY]: switchable ? () => setWorkLayout(workLayout === 'wide' ? 'standard' : 'wide') : undefined });
  const status = statusOf(state, id);
  // Until the status is known, an already finished exercise must not start counting.
  const stateUnknown = state === undefined;

  useEffect(() => {
    const cancel = afterPaint(() => void recordOpen(id).then(() => qc.invalidateQueries({ queryKey: keys.state })));
    document.title = `${plainTitle(meta.title)} · ${outline.title}`;
    return () => {
      cancel();
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
      // Alt+A: a card ("add"), whenever something is worth remembering.
      if (e.code === 'KeyA' && !e.shiftKey && makeCardRef.current) {
        e.preventDefault();
        makeCardRef.current();
        return;
      }
      if (e.code !== 'Comma' && e.code !== 'Period') return;
      const target = neighbours(outline, id, qc.getQueryData<{ state: NonNullable<typeof state> }>(keys.state)?.state, group)[e.code === 'Comma' ? 'previous' : 'next'];
      if (!target) return;
      e.preventDefault();
      navigate(itemHref(target.id, group));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [id, group, outline, navigate, qc]);

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

  const around = neighbours(outline, id, state, group);
  const upNext = status === 'done' ? whatsNext(outline, state, id) : null;

  const revealHint = (n: number) => {
    setHints(n);
    void recordHints(id, n);
  };

  const task = (
    // A container, so wide widgets in a lesson know how much room the page has. Relative, so nothing positioned
    // inside (a hidden `sr-only` line) can reach past it and make the whole window scroll.
    <div className={clsx('@container relative h-full overflow-y-auto', ex && w && 'wb-task-scroll')}>
      <TaskColumn
        detail={detail}
        outline={outline}
        byId={map}
        state={state}
        revealedHints={revealed}
        onRevealHint={revealHint}
        group={group}
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
          group={group}
          onMakeCard={flashcardsOn ? () => setMakingCard(true) : undefined}
          lessonOptions
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
    const before = qc.getQueryData<Work>(keys.work(id));
    const writes: Promise<unknown>[] = [];
    if (confidence !== null) {
      const reflectionHow = review ? (lastReflection?.how ?? []) : how;
      // Shown at once (the rating in the bar); the server's copy replaces it below.
      patchWork(id, (x) => ({ ...x, reflections: [...x.reflections, { id: -1, exerciseId: id, confidence: confidence as Reflection['confidence'], how: reflectionHow, comment: review ? '' : comment, createdAt: Date.now() }] }));
      writes.push(postReflection(id, confidence, reflectionHow, review ? '' : comment));
    }
    // What is unclear stays open until the student says otherwise, whichever way it was asked.
    if (comment) writes.push(addQuestion(id, comment));
    if (flashcardsOn && !invited.current && confidence !== null && (confidence <= 2 || !review)) {
      invited.current = true;
      setInvite(confidence <= 2 ? 'low' : 'done');
    }
    try {
      await Promise.all(writes);
    } catch {
      if (before) qc.setQueryData(keys.work(id), before);
      reportSaveFailed();
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
      group={group}
      onMakeCard={flashcardsOn ? () => setMakingCard(true) : undefined}
      layoutSwitch={wide && !!ex.code?.runnable}
      questions={{ item: id, list: w.questions }}
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
          setTaskOpen(true);
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
      <div className="relative min-h-0 flex-1">
        <Group orientation="horizontal" className="h-full">
          <Panel panelRef={taskPanel} onResize={onTaskResize} defaultSize={strip ? TASK_STRIP_PX : '46'} minSize="28" collapsible collapsedSize={TASK_STRIP_PX}>
            {strip ? (
              <div className="wb-strip flex h-full flex-col items-center gap-3 bg-sheet py-2">
                <IconButton label={taskOpen ? t.hideTask : t.showTask} aria-pressed={taskOpen} onClick={() => setTaskOpen((open) => !open)}>
                  <BookOpen size={17} />
                </IconButton>
                <IconButton label={t.unfoldTask} onClick={() => setWorkLayout('standard')}>
                  <PanelLeftOpen size={17} />
                </IconButton>
                <span className="rotate-180 select-none text-xs font-medium tracking-wide text-ink-3 [writing-mode:vertical-rl]">{t.taskRail}</span>
              </div>
            ) : (
              task
            )}
          </Panel>
          <ResizeHandle direction="row" disabled={strip} gutter />
          <Panel defaultSize="54" minSize="28">
            {workspace}
          </Panel>
        </Group>
        {strip && taskOpen ? (
          // The task opens over the editor for as long as it is needed.
          <>
            <button type="button" aria-label={t.hideTask} className="absolute inset-y-0 right-0 z-20 cursor-default bg-ink/20" style={{ left: TASK_STRIP_PX }} onClick={() => setTaskOpen(false)} />
            <div role="dialog" aria-label={t.taskRail} className="absolute inset-y-0 z-30 w-[min(42rem,88%)] border-r border-line-strong bg-sheet shadow-[var(--shadow)]" style={{ left: TASK_STRIP_PX }}>
              {task}
            </div>
          </>
        ) : null}
      </div>
      {dialog}
    </div>
  );
}
