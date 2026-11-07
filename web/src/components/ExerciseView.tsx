import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, ChevronUp, Clock, Download, GitCompare, History, MoreHorizontal, Repeat, RotateCcw, Eye, Lock, PencilLine } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import type { CheckRun, ExerciseMeta, ItemDetail } from '@wb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { fetchSample, fetchSolution, fetchVersions, keys, runChecks, saveAnswer, stopChecks, useSettings, type Work } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { readPref, writePref } from '@/lib/shell';
import { useDebouncedCallback } from '@/lib/useDebounced';
import { useRepl, type TypeSpan } from '@/lib/useRepl';
import { AiPanel } from './AiPanel';
import { confetti } from './Celebration';
import { CodeEditor } from './CodeEditor';
import { ExplainError } from './ExplainError';
import { AttemptDialog, ConfirmDialog, HistoryDialog, SolutionDialog } from './Dialogs';
import { SampleDialog } from './SampleDialog';
import { NotesPanel } from './NotesPanel';
import { ReplView } from './Repl';
import { TestsPanel } from './TestsPanel';
import { TypstEditor } from './TypstEditor';
import { Button, IconButton, ResizeHandle, clsx } from './ui';

type TopTab = 'answer' | 'notes' | 'ai';
type BottomTab = 'interpreter' | 'tests';

/** The tab row of the bottom panel, which stays visible when the panel is collapsed. */
const TAB_ROW_PX = 37;
const COLLAPSED_KEY = 'wb-bottom-panel';

interface Props {
  detail: ItemDetail;
  meta: ExerciseMeta;
  work: Work;
  /** Called the first time the student edits or runs something, to move the exercise out of "to do". */
  onActivity: () => void;
  onAllChecksPass: (allPass: boolean) => void;
  checkBanner: React.ReactNode;
  /** Finished: looking at an answer needs no warning any more. */
  finished: boolean;
  /** Marked to come back to, which is the moment trying again from memory is worth suggesting. */
  reviewing: boolean;
}

const PROMPT: Record<string, string> = { haskell: 'ghci>', prolog: '?-' };

/** The right pane: answer editor, interpreter and checks, notes. */
export function ExerciseView({ detail, meta, work, onActivity, onAllChecksPass, checkBanner, finished, reviewing }: Props) {
  const t = useT();
  const code = meta.code;
  // What the editor highlights, and what can run. A Python exercise has the first but not the second.
  const language = code?.language ?? meta.scratch ?? null;
  const runnable = code ? code.runnable : !!meta.scratch;
  const slots = code?.files ?? ['text'];
  // In shared files, only some are this exercise's to change. Marked only when that is a real choice.
  const edits = code && code.edits.length > 0 && code.edits.length < slots.length ? new Set(code.edits) : null;
  const [slot, setSlot] = useState(code?.edits[0] ?? slots[0]!);
  // A support file is only looked at, so it stays apart from `slot`, which everything that saves relies on.
  const supportFiles = Object.keys(detail.support);
  const [viewing, setViewing] = useState<string | null>(null);
  const isCode = !!code;
  const starter = detail.starter[slot] ?? '';
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(slots.map((s) => [s, work.answers[s] ?? detail.starter[s] ?? ''])));
  const text = texts[slot] ?? '';
  // For sending everything to the interpreter, which always gets all of the files.
  const latest = useRef(texts);
  const [tab, setTab] = useState<TopTab>('answer');
  const [bottom, setBottom] = useState<BottomTab>('interpreter');
  const panel = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [run, setRun] = useState<CheckRun | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [history, setHistory] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSolution, setConfirmSolution] = useState(false);
  const [solution, setSolution] = useState<Record<string, string> | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  // Shared files hold the work of other exercises too, so they cannot simply start over.
  const canRetry = !code?.shared;
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [attempt, setAttempt] = useState<string | null>(null);
  const [showAttempt, setShowAttempt] = useState(false);
  const [fresh, setFresh] = useState(0);
  const [sample, setSample] = useState<{ samples: string[]; css: string } | null>(null);

  const qc = useQueryClient();
  const celebrating = !!useSettings().data?.showAchievements;
  // Only the first time the tests of this exercise all pass.
  const passedBefore = useRef(work.stats.checkPasses > 0);
  const repl = useRepl(meta.id, runnable);
  const touched = useRef(false);

  const save = useDebouncedCallback((file: string, value: string) => {
    setSaved('saving');
    saveAnswer(meta.id, file, value).then(
      () => setSaved('saved'),
      () => setSaved('error'),
    );
  }, 700);
  const sendToRepl = useDebouncedCallback(() => repl.load(latest.current), 120);
  // A query always runs against what is in the editor, even right after typing.
  const session = { ...repl, input: (line: string) => (sendToRepl.flush(), repl.input(line)) };

  // Whatever is in the editor goes to the interpreter at once, including the saved answer on open.
  useEffect(() => {
    if (isCode && runnable) repl.load(latest.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCode]);

  // A text answer rarely needs the interpreter, so there it always starts collapsed, and opening it there is not remembered.
  const rememberPanel = isCode;
  const startCollapsed = !isCode || readPref(COLLAPSED_KEY, ['open', 'collapsed'], 'open') === 'collapsed';
  // Only an explicit choice is remembered: the panel also reports sizes while it mounts.
  const toggleBottom = () => {
    const expand = panel.current?.isCollapsed();
    if (expand) panel.current?.expand();
    else panel.current?.collapse();
    if (rememberPanel) writePref(COLLAPSED_KEY, expand ? 'open' : 'collapsed');
  };
  /** Opening a tab should show it. */
  const showBottom = (b: BottomTab) => {
    setBottom(b);
    if (panel.current?.isCollapsed()) {
      panel.current.expand();
      if (rememberPanel) writePref(COLLAPSED_KEY, 'open');
    }
  };

  const change = useCallback(
    (value: string) => {
      latest.current = { ...latest.current, [slot]: value };
      setTexts(latest.current);
      save.call(slot, value);
      if (isCode && runnable) sendToRepl.call();
      if (!touched.current && value !== (work.answers[slot] ?? starter)) {
        touched.current = true;
        onActivity();
      }
    },
    [isCode, runnable, onActivity, save, sendToRepl, slot, starter, work.answers],
  );

  const replaceText = (value: string, reason: 'reset' | 'restore') => {
    // What is about to be saved is what is being replaced. It must not arrive after the new text.
    save.cancel();
    // The version being replaced stays in the history.
    void saveAnswer(meta.id, slot, text, 'reset').then(() => saveAnswer(meta.id, slot, value, reason));
    latest.current = { ...latest.current, [slot]: value };
    setTexts(latest.current);
    if (isCode && runnable) repl.load(latest.current);
    setRun(null);
    onAllChecksPass(false);
  };

  const check = async () => {
    showBottom('tests');
    setRunning(true);
    setRunError(null);
    save.flush();
    try {
      const r = await runChecks(meta.id, latest.current);
      setRun(r);
      onActivity();
      const allPass = r.compiled && !r.stopped && r.results.length > 0 && r.results.every((x) => x.status === 'pass');
      onAllChecksPass(allPass);
      if (allPass && celebrating && !passedBefore.current) confetti();
      if (allPass) passedBefore.current = true;
      void qc.invalidateQueries({ queryKey: keys.state });
    } catch (e) {
      setRunError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const openSolution = async () => {
    setShowSolution(true);
    setSolution(null);
    try {
      setSolution((await fetchSolution(meta.id)).files);
    } catch {
      setShowSolution(false);
    }
  };

  // Remembered in the history: the latest attempt set aside, to compare with afterwards.
  useEffect(() => {
    if (!canRetry) return;
    let live = true;
    void fetchVersions(meta.id, slot).then((versions) => {
      const earlier = versions.filter((v) => v.reason === 'retry').sort((a, b) => b.id - a.id)[0];
      if (live && earlier) setAttempt(earlier.content);
    });
    return () => {
      live = false;
    };
  }, [canRetry, meta.id, slot]);

  /** A blank start. A new editor too, so that undo cannot bring the old answer back. */
  const tryAgain = () => {
    save.cancel();
    const earlier = text;
    void saveAnswer(meta.id, slot, earlier, 'retry').then(() => saveAnswer(meta.id, slot, starter, 'reset'));
    latest.current = { ...latest.current, [slot]: starter };
    setTexts(latest.current);
    setAttempt(earlier);
    setFresh((n) => n + 1);
    if (isCode && runnable) repl.load(latest.current);
    setRun(null);
    onAllChecksPass(false);
    passedBefore.current = false;
  };

  const openSample = async () => {
    try {
      setSample(await fetchSample(meta.id));
    } catch {
      setSample(null);
    }
  };

  const hasAnswer = text.trim() !== '' && text !== starter;
  // Only before trying again: not while they are in the middle of it. The menu always has it.
  const offerRetry = reviewing && canRetry && hasAnswer && attempt === null;

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = isCode ? slot.split('/').pop()! : `${meta.id}.typ`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Not at once: the browser may only start reading it after this click has been handled.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const diagnostics = repl.loaded?.diagnostics;
  const errorCount = diagnostics?.filter((d) => d.severity === 'error').length ?? 0;
  const inThisFile = useMemo(() => diagnostics?.filter((d) => d.file === slot), [diagnostics, slot]);
  // With several files, the AI should know which is which.
  const answerForAi = slots.length > 1 ? slots.map((s) => `--- ${s} ---\n${texts[s] ?? ''}`).join('\n\n') : text;
  const prompt = PROMPT[language ?? 'haskell'] ?? '>';

  const savedLabel = saved === 'saving' ? t.saving : saved === 'saved' ? t.saved : saved === 'error' ? t.couldNotSave : '';

  const editor = useMemo(
    () =>
      viewing !== null ? (
        <CodeEditor key={`support-${viewing}`} value={detail.support[viewing] ?? ''} language={language} lineNumbers readOnly label={t.codeLabel(viewing)} variant="code" />
      ) : isCode ? (
        <CodeEditor
          key={`${slot}-${fresh}`}
          value={text}
          onChange={change}
          language={language}
          {...(inThisFile ? { diagnostics: inThisFile } : {})}
          lineNumbers
          label={t.codeLabel(slot)}
          {...(code?.hasCheck ? { onSubmit: () => void check() } : {})}
          {...(runnable && language === 'haskell' ? { typeOf: (span: Omit<TypeSpan, 'file'>) => repl.typeAt({ file: slot, ...span }) } : {})}
          variant="code"
        />
      ) : (
        <TypstEditor key={fresh} value={text} onChange={change} label={t.yourAnswer} placeholder={t.answerPlaceholder} variant="notes" status={savedLabel} />
      ),
    // `check` closes over text; the editor itself only needs to be rebuilt when these change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, change, isCode, language, inThisFile, slot, code?.hasCheck, t, fresh, viewing, detail.support, savedLabel],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-sheet">
      <div className="flex items-center justify-between border-b border-line pl-2 pr-3">
        <div role="tablist" aria-label={t.workspace} className="flex">
          {(['answer', 'notes', 'ai'] as TopTab[]).map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={clsx('relative px-3 py-2.5 text-sm font-medium', tab === name ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
            >
              {name === 'answer' ? (isCode ? t.tabCode : t.tabAnswer) : name === 'notes' ? t.tabNotes : t.tabAi}
              {tab === name ? <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
            </button>
          ))}
        </div>
        {tab === 'answer' && viewing === null ? (
          <div className="flex items-center gap-2">
            {/* A text answer shows this in its editor's toolbar, like notes do. */}
            {isCode ? (
              <span className="text-xs text-ink-3" aria-live="polite">
                {savedLabel}
              </span>
            ) : null}
            <IconButton label={isCode ? t.downloadCode : t.downloadAnswer} onClick={download}>
              <Download size={16} />
            </IconButton>
            <MoreMenu
              items={[
                { icon: History, label: t.earlierVersions, onClick: () => setHistory(true) },
                { icon: RotateCcw, label: isCode ? t.startOver : t.clearAnswer, onClick: () => setConfirmReset(true) },
                ...(hasAnswer && canRetry ? [{ icon: Repeat, label: t.tryAgain, onClick: () => setConfirmRetry(true) }] : []),
                ...(attempt !== null ? [{ icon: GitCompare, label: t.compareAttempt, onClick: () => setShowAttempt(true) }] : []),
                ...(code?.hasSolution ? [{ icon: Eye, label: t.showSolution, onClick: () => (finished ? void openSolution() : setConfirmSolution(true)) }] : []),
                ...(meta.hasSample ? [{ icon: Eye, label: t.showSample, onClick: () => (finished ? void openSample() : setConfirmSample(true)) }] : []),
              ]}
            />
          </div>
        ) : null}
      </div>

      {tab === 'answer' && slots.length + supportFiles.length > 1 ? (
        <div role="tablist" aria-label={t.files} className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-paper/60 px-2 py-1">
          {slots.map((s) => {
            const errors = diagnostics?.filter((d) => d.file === s && d.severity === 'error').length ?? 0;
            const mine = edits?.has(s);
            const selected = viewing === null && slot === s;
            return (
              <button
                key={s}
                role="tab"
                aria-selected={selected}
                title={edits ? (mine ? t.editsFile : t.otherFile) : undefined}
                onClick={() => {
                  save.flush();
                  setSlot(s);
                  setViewing(null);
                }}
                className={clsx(
                  'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 font-mono text-[12px]',
                  selected ? 'bg-sheet font-medium text-ink shadow-sm' : mine ? 'text-ink-2 hover:text-ink' : 'text-ink-3 hover:text-ink-2',
                  edits && !mine && !selected && 'opacity-70',
                )}
              >
                {mine ? <PencilLine size={11} className="text-accent" aria-hidden /> : null}
                {s}
                {edits ? <span className="sr-only">{` (${mine ? t.editsFile : t.otherFile})`}</span> : null}
                {errors ? <span className="ml-1.5 rounded-full bg-danger-soft px-1.5 font-sans text-danger">{errors}</span> : null}
              </button>
            );
          })}
          {supportFiles.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={viewing === s}
              title={t.readOnlyFile}
              onClick={() => {
                save.flush();
                setViewing(s);
              }}
              className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 font-mono text-[12px]', viewing === s ? 'bg-sheet font-medium text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2')}
            >
              <Lock size={11} aria-hidden />
              {s}
              <span className="sr-only">{` (${t.readOnlyFile})`}</span>
            </button>
          ))}
        </div>
      ) : null}

      {edits && !edits.has(slot) && viewing === null && tab === 'answer' ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-paper/60 px-4 py-2 text-[13px] text-ink-2">
          <PencilLine size={14} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0">{t.notThisFile([...edits].join(', '))}</span>
        </div>
      ) : null}

      {offerRetry && tab === 'answer' ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-paper/60 px-4 py-2 text-[13px]">
          <Repeat size={15} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 basis-56 text-ink-2">{t.tryAgainOffer}</span>
          <Button size="sm" onClick={() => setConfirmRetry(true)}>
            {t.tryAgainButton}
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {tab === 'notes' ? (
          <NotesPanel id={meta.id} initial={work.note?.content ?? ''} />
        ) : tab === 'ai' ? (
          <AiPanel id={meta.id} answer={answerForAi} tests={run?.compiled ? run.results.map(({ name, status, message }) => ({ name, status, message })) : null} />
        ) : runnable ? (
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize="62" minSize="20">
              {editor}
            </Panel>
            <ResizeHandle direction="column" />
            <Panel
              panelRef={panel}
              // A collapsed panel stays collapsed across exercises with code.
              defaultSize={startCollapsed ? TAB_ROW_PX : '38'}
              minSize="15"
              collapsible
              collapsedSize={TAB_ROW_PX}
              onResize={() => setCollapsed(panel.current?.isCollapsed() ?? false)}
            >
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-line bg-sheet px-2" style={{ height: TAB_ROW_PX }}>
                  <div role="tablist" aria-label={t.feedback} className="flex">
                    <PanelTab on={bottom === 'interpreter'} onClick={() => showBottom('interpreter')}>
                      {t.interpreter}
                      {errorCount > 0 ? <span className="ml-1.5 rounded-full bg-danger-soft px-1.5 text-xs font-medium text-danger">{errorCount}</span> : null}
                      {repl.loading ? <span className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-accent" aria-label={t.loadingCode} /> : null}
                    </PanelTab>
                    {code?.hasCheck ? (
                      <PanelTab on={bottom === 'tests'} onClick={() => showBottom('tests')}>
                        {t.tests}
                        {run?.compiled && run.results.length ? (
                          <span className={clsx('ml-1.5 text-xs tabular-nums', run.results.every((r) => r.status === 'pass') ? 'text-done' : 'text-ink-3')}>
                            {run.results.filter((r) => r.status === 'pass').length}/{run.results.length}
                          </span>
                        ) : null}
                      </PanelTab>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {repl.loaded && bottom === 'interpreter' && code ? (
                      <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap text-xs', repl.loaded.ok ? 'text-done' : 'text-danger')}>{repl.loaded.ok ? t.loadedIn(repl.loaded.durationMs) : t.doesNotCompile}</span>
                    ) : null}
                    <IconButton label={collapsed ? t.expandPanel : t.collapsePanel} aria-expanded={!collapsed} onClick={toggleBottom} className="size-7">
                      {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </IconButton>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  {bottom === 'interpreter' ? (
                    diagnostics && diagnostics.length > 0 ? (
                      // Problems and the session can each be given the room they need.
                      <Group orientation="vertical" className="h-full">
                        <Panel defaultSize="35" minSize="10">
                          <Problems diagnostics={diagnostics} multi={slots.length > 1} />
                        </Panel>
                        <ResizeHandle direction="column" />
                        <Panel defaultSize="65" minSize="25">
                          <ReplView repl={session} prompt={prompt} language={language ?? ''} />
                        </Panel>
                      </Group>
                    ) : (
                      <ReplView repl={session} prompt={prompt} language={language ?? ''} />
                    )
                  ) : (
                    <TestsPanel run={run} running={running} error={runError} onRun={() => void check()} onStop={() => void stopChecks(meta.id)} firstRun={!run} banner={checkBanner} />
                  )}
                </div>
              </div>
            </Panel>
          </Group>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {isCode ? <p className="shrink-0 border-b border-line bg-paper/60 px-4 py-2 text-[13px] text-ink-2">{t.noRunner(language ?? '')}</p> : null}
            <div className="min-h-0 flex-1">{editor}</div>
          </div>
        )}
      </div>

      <HistoryDialog open={history} onClose={() => setHistory(false)} id={meta.id} slot={slot} language={isCode ? language : null} onRestore={(c) => replaceText(c, 'restore')} />
      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={isCode ? t.confirmStartOver : t.confirmClear}
        confirmLabel={isCode ? t.startOverButton : t.clearButton}
        onConfirm={() => replaceText(starter, 'reset')}
      >
        {code?.shared ? `${t.resetsSharedFile(slot)} ${t.keptInVersions}` : t.keptInVersions}
      </ConfirmDialog>
      <ConfirmDialog open={confirmRetry} onClose={() => setConfirmRetry(false)} title={t.confirmTryAgain} confirmLabel={t.tryAgainButton} onConfirm={tryAgain}>
        {t.tryAgainBody}
      </ConfirmDialog>
      <AttemptDialog open={showAttempt} onClose={() => setShowAttempt(false)} earlier={attempt ?? ''} now={text} language={isCode ? language : null} />
      <ConfirmDialog open={confirmSample} onClose={() => setConfirmSample(false)} title={t.confirmSample} confirmLabel={t.sampleButton} onConfirm={() => void openSample()}>
        {t.solutionWarning}
      </ConfirmDialog>
      <SampleDialog open={sample !== null} onClose={() => setSample(null)} sample={sample} mine={isCode ? null : text} />
      <ConfirmDialog open={confirmSolution} onClose={() => setConfirmSolution(false)} title={t.confirmSolution} confirmLabel={t.solutionButton} onConfirm={() => void openSolution()}>
        {t.solutionWarning}
      </ConfirmDialog>
      <SolutionDialog open={showSolution} onClose={() => setShowSolution(false)} files={solution} mine={texts} partial={!!code?.shared} language={code?.language ?? 'haskell'} />
    </div>
  );
}

function PanelTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick} className={clsx('relative px-2.5 py-2 text-[13px] font-medium', on ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}>
      {children}
      {on ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
    </button>
  );
}

function Problems({ diagnostics, multi }: { diagnostics: NonNullable<ReturnType<typeof useRepl>['loaded']>['diagnostics']; multi: boolean }) {
  const t = useT();
  const errs = diagnostics.filter((d) => d.severity === 'error').length;
  const warns = diagnostics.length - errs;
  return (
    <div className="h-full overflow-y-auto bg-sunk/60">
      <p className="sticky top-0 flex items-center gap-3 bg-sunk px-4 py-1.5 text-[13px]">
        <span className="font-medium">{t.problems}</span>
        {errs ? <span className="text-danger">{t.nErrors(errs)}</span> : null}
        {warns ? <span className="text-warn">{t.nWarnings(warns)}</span> : null}
      </p>
      <ul className="px-4 pb-2">
        {diagnostics.map((d, i) => (
          <li key={i} className="py-1.5 first:pt-0">
            <p className={clsx('font-mono text-xs', d.severity === 'error' ? 'text-danger' : 'text-warn')}>
              {d.file && multi ? `${d.file}, ` : ''}
              {t.lineColumn(d.line, d.column)}
              {d.code ? ` (${d.code})` : ''}
            </p>
            <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-ink">{d.message}</pre>
            <ExplainError code={d.code} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoreMenu({ items }: { items: { icon: typeof Clock; label: string; onClick: () => void }[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={t.moreActions} className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink">
          <MoreHorizontal size={17} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 w-64 rounded-xl border border-line-strong bg-sheet p-1.5 shadow-[var(--shadow)]">
          {items.map(({ icon: Icon, label, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setOpen(false);
                onClick();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-sunk"
            >
              <Icon size={15} className="text-ink-3" /> {label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
