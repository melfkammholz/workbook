import { Check, ChevronLeft, ChevronRight, CircleHelp, Eye, Layers, ListChecks, NotebookPen, RotateCcw } from 'lucide-react';
import { useRoute } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { api, keys, saveNote, useSettings, type Work } from '@/lib/api';
import { appendToOpenNote, escapeMarkup } from '@/lib/annotations';
import { MakeCardDialog } from '../MakeCardDialog';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { highlightToHtml } from '@/lib/highlight';
import { useT } from '@/lib/i18n';
import { Prose } from '../Prose';
import { clsx } from '../ui';
import { Compare } from './Compare';
import { FoldExplorer } from './FoldExplorer';
import { FoldSignature } from './FoldSignature';
import { Flow } from './Flow';
import { FoldSteps } from './FoldSteps';
import { FoldTree } from './FoldTree';
import { Bracketing, ExprTrees, FoldList } from './Folds';
import { Practice } from './Practice';

/**
 * Widgets in course text. Typst emits a `div[data-widget]` whose parts (`div[data-part]`) are
 * ordinary rendered Typst; `Prose` takes them out of the text and mounts the matching
 * component in their place. Nothing a widget does is stored: it starts fresh on every visit.
 */

export interface Part {
  name: string;
  attrs: Record<string, string>;
  /** The part as rendered by Typst, sub-parts included. */
  html: string;
  parts: Part[];
}

export interface WidgetHost {
  key: string;
  el: HTMLElement;
  kind: string;
  attrs: Record<string, string>;
  parts: Part[];
  /** What Typst wrote inside, for a kind this app does not know. */
  html: string;
}

/** The parts of rendered HTML that holds a widget's parts, e.g. a quiz card's front. */
export function partsOfHtml(html: string): Part[] {
  const el = document.createElement('div');
  el.innerHTML = html;
  return partsOf(el);
}

const dataOf = (el: HTMLElement): Record<string, string> => ({ ...el.dataset }) as Record<string, string>;

function partsOf(el: Element): Part[] {
  return [...el.children]
    .filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.part !== undefined)
    .map((c) => ({ name: c.dataset.part!, attrs: dataOf(c), html: c.innerHTML, parts: partsOf(c) }));
}

let counter = 0;
/** What was read from a host before it was emptied: effects may run twice on the same element. */
const taken = new WeakMap<HTMLElement, WidgetHost>();

/** Finds the outermost widgets of a rendered text and empties them, ready for their component. */
export function takeWidgets(root: HTMLElement): WidgetHost[] {
  // Outermost within this text: a widget inside a widget's part is left to that part's own Prose.
  const hosts = [...root.querySelectorAll<HTMLElement>('div[data-widget]')].filter((el) => {
    const outer = el.parentElement?.closest('[data-widget]');
    return !outer || !root.contains(outer);
  });
  return hosts.map((el) => {
    let host = taken.get(el);
    if (!host) {
      host = { key: `w${counter++}`, el, kind: el.dataset.widget!, attrs: dataOf(el), parts: partsOf(el), html: el.innerHTML };
      taken.set(el, host);
      el.replaceChildren();
    }
    return host;
  });
}

export function Widget({ host }: { host: WidgetHost }) {
  switch (host.kind) {
    case 'quiz':
      return <Quiz parts={host.parts} src={host.attrs.src} />;
    case 'steps':
      return <Steps parts={host.parts.filter((p) => p.name === 'step')} />;
    case 'tabs':
      return <Tabs parts={host.parts.filter((p) => p.name === 'tab')} label={host.attrs.label} />;
    case 'recipe':
      return <Recipe parts={host.parts} />;
    case 'flow':
      return <Flow config={host.attrs.config ?? '{}'} />;
    case 'fold-signature':
      return <FoldSignature decl={host.attrs.decl ?? ''} fold={host.attrs.fold} given={host.attrs.given === 'true'} />;
    case 'fold-explorer':
      return <FoldExplorer decl={host.attrs.decl ?? ''} config={host.attrs.config ?? '{}'} />;
    case 'expr-trees':
      return <ExprTrees config={host.attrs.config ?? '{}'} />;
    case 'fold-list':
      return <FoldList config={host.attrs.config ?? '{}'} />;
    case 'bracketing':
      return <Bracketing config={host.attrs.config ?? '{}'} />;
    case 'practice':
      return <Practice ids={(host.attrs.ids ?? '').split(',').filter(Boolean)} parts={host.parts} />;
    case 'open-question':
      return <OpenQuestion parts={host.parts} />;
    case 'compare':
      return <Compare parts={host.parts} config={host.attrs.config ?? '{}'} />;
    case 'fold-steps':
      return <FoldSteps decl={host.attrs.decl ?? ''} config={host.attrs.config ?? '{}'} />;
    case 'fold-tree':
      return <FoldTree decl={host.attrs.decl ?? ''} config={host.attrs.config ?? '{}'} />;
    default:
      return <Prose html={host.html} />;
  }
}

/** Rendered Typst inside a line, such as an answer on a button: inline code is highlighted, nothing else. */
export function Inline({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('code[data-lang]').forEach((code) => {
      const h = highlightToHtml(code.textContent ?? '', code.getAttribute('data-lang') ?? '');
      if (h !== null) code.innerHTML = h;
    });
  }, [html]);
  return <span ref={ref} className={clsx('wb-inline', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A Haskell type, highlighted. A span, so the text's rules for `code` stay out of it. */
export function Code({ children, className }: { children: string; className?: string }) {
  return <span className={clsx('font-mono', className)} dangerouslySetInnerHTML={{ __html: highlightToHtml(children, 'haskell') ?? children.replace(/[&<>]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt' }[c]};`) }} />;
}

/** A message in which `backticks` mark code. */
export function Message({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((piece, i) =>
        i % 2 ? (
          <Code key={i} className="rounded bg-sunk px-1 text-[0.9em]">
            {piece}
          </Code>
        ) : (
          piece
        ),
      )}
    </>
  );
}

/** Shakes an element once, to say "not there". */
export function shake(el: Element | null | undefined) {
  if (!el) return;
  el.classList.remove('wb-shake');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('wb-shake');
}

const Nested = createContext(false);

/** The box around a widget. Inside another widget it is no box of its own, only the layout. */
export function Frame({ children, className, bare }: { children: React.ReactNode; className?: string; bare?: boolean }) {
  const nested = useContext(Nested) || !!bare;
  return (
    <Nested.Provider value>
      <div className={clsx('relative flex min-w-0 flex-col gap-3 text-[15px]', !nested && 'rounded-xl border border-line bg-sheet px-4 py-3.5', className)}>{children}</div>
    </Nested.Provider>
  );
}

/** A labelled line of controls: "Wert", "Schritt", "Beispiel" … */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="min-w-[5.5rem] text-[13px] text-ink-3">{label}</span>
      {children}
    </div>
  );
}

/**
 * One of a few, always visible. With `code`, the options are code, and only the chosen one is
 * highlighted: colour marks the choice instead of competing with it.
 */
export function Choice({ options, at, onPick, code = false, label }: { options: string[]; at: number; onPick: (i: number) => void; code?: boolean; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-0.5 self-start justify-self-start rounded-md bg-sunk p-0.5">
      {options.map((o, i) => (
        <button
          key={i}
          type="button"
          aria-pressed={i === at}
          onClick={() => onPick(i)}
          className={clsx('rounded px-2.5 py-1 text-[13px]', code && 'font-mono', i === at ? 'bg-sheet font-medium text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
        >
          {code && i === at ? <Code>{o}</Code> : <Message text={o} />}
        </button>
      ))}
    </div>
  );
}

/** Shows the answer, or does a step for the student: an eye in the corner, out of the way until wanted. */
export function Reveal({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-sunk hover:text-ink"
    >
      <Eye size={17} />
    </button>
  );
}

// ───────────────────────── quiz ─────────────────────────

/**
 * A question with answers to choose from. In a lesson it can become a flashcard (`src` is its Typst text);
 * on a card it has no box of its own, says how the first pick went, and can be revealed from outside.
 */
export function Quiz({
  parts,
  src,
  bare,
  onPick,
  reveal,
  pick: picked_,
}: {
  parts: Part[];
  src?: string | undefined;
  bare?: boolean;
  onPick?: (right: boolean) => void;
  reveal?: boolean;
  /** A pick from outside, e.g. a number key in the review. */
  pick?: { i: number; n: number } | null;
}) {
  const t = useT().widget;
  const flashcards = !!useSettings().data?.showFlashcards;
  const [, params] = useRoute('/item/:id');
  const [making, setMaking] = useState(false);
  const picked = useRef(false);
  const question = parts.find((p) => p.name === 'question');
  const choices = parts
    .filter((p) => p.name === 'choice')
    .map((c) => ({ label: c.parts.find((p) => p.name === 'label')?.html ?? '', why: c.parts.find((p) => p.name === 'why')?.html ?? null, correct: c.attrs.correct === 'true' }));
  const [wrong, setWrong] = useState<number[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const solved = last !== null && choices[last]?.correct;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (i: number) => {
    if (solved) return;
    if (!picked.current) {
      picked.current = true;
      onPick?.(choices[i]!.correct);
    }
    setLast(i);
    if (!choices[i]!.correct) {
      setWrong((w) => (w.includes(i) ? w : [...w, i]));
      shake(buttons.current[i]);
    }
  };
  const feedback = last === null ? null : choices[last]!;
  useEffect(() => {
    if (picked_ && picked_.i < choices.length) pick(picked_.i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked_?.n]);
  useEffect(() => {
    if (reveal && !solved) setLast(choices.findIndex((c) => c.correct));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  return (
    <Frame bare={bare}>
      <div className="flex items-start gap-3">
        {/* In a lesson, a quiz is one of the blocks: its icon on the left, on the question's first line. */}
        {!bare ? (
          <span aria-hidden className="mt-1 flex h-6 shrink-0 items-center text-accent">
            <ListChecks size={18} />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {question ? <Prose html={question.html} className="pt-1 font-semibold" /> : null}
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c, i) => (
              <button
                key={i}
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                type="button"
                disabled={!!solved}
                onClick={() => pick(i)}
                className={clsx(
                  'rounded-lg border px-3 py-1.5 text-left text-[14.5px] transition-colors',
                  solved && c.correct ? 'border-done/45 bg-done-soft font-semibold' : wrong.includes(i) ? 'border-danger/40 bg-danger-soft' : 'border-line-strong bg-sheet hover:border-accent',
                  solved && !c.correct && 'opacity-60',
                )}
              >
                <Inline html={c.label} />
              </button>
            ))}
          </div>
          {feedback ? (
            <div aria-live="polite">
              {feedback.why ? (
                <Prose html={feedback.why} className={clsx('text-[14.5px]', feedback.correct ? 'text-ink' : 'text-ink-2')} />
              ) : (
                <p className="text-[14.5px] text-ink-2">{feedback.correct ? '✓' : t.tryAgain}</p>
              )}
            </div>
          ) : null}
        </div>
        {(!solved && !bare) || (src && flashcards) ? (
          <div className="-mr-2 flex shrink-0 gap-0.5">
            {!solved && !bare ? <Reveal label={t.showAnswer} onClick={() => setLast(choices.findIndex((c) => c.correct))} /> : null}
            {src && flashcards ? (
              <button type="button" aria-label={t.makeQuizCard} title={t.makeQuizCard} onClick={() => setMaking(true)} className="grid size-8 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-sunk hover:text-ink">
                <Layers size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {src && flashcards ? <MakeCardDialog open={making} onClose={() => setMaking(false)} exerciseId={params?.id ?? null} initial={{ kind: 'quiz', front: src, back: '' }} /> : null}
    </Frame>
  );
}

// ───────────────────────── open question ─────────────────────────

/**
 * A question to think about, with no answer to pick. One of the lesson's blocks: a question mark on the left, the
 * question and an optional hint, and on the right the ways to keep it: into the notes of this lesson, or onto a card.
 */
function OpenQuestion({ parts }: { parts: Part[] }) {
  const t = useT().widget;
  const qc = useQueryClient();
  const flashcards = !!useSettings().data?.showFlashcards;
  const [, params] = useRoute('/item/:id');
  const item = params?.id ?? null;
  const [making, setMaking] = useState(false);
  const [noted, setNoted] = useState(false);
  const question = parts.find((p) => p.name === 'question');
  const hint = parts.find((p) => p.name === 'hint');
  const text = () => {
    const el = document.createElement('div');
    el.innerHTML = question?.html ?? '';
    return escapeMarkup((el.textContent ?? '').replace(/\s+/g, ' ').trim());
  };
  const note = async () => {
    if (!item) return;
    const snippet = `#quote(block: true)[${text()}]\n\n`;
    if (!appendToOpenNote(item, snippet)) {
      const work = await api.get<Work>(`/api/work/${encodeURIComponent(item)}`);
      const before = work.note?.content.trimEnd() ?? '';
      await saveNote(item, 'typst', before ? `${before}\n\n${snippet}` : snippet);
      void qc.invalidateQueries({ queryKey: keys.work(item) });
    }
    setNoted(true);
  };
  return (
    <Frame>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-[1.4rem] shrink-0 items-center text-review">
          <CircleHelp size={18} />
        </span>
        <div className="min-w-0 flex-1">
          {question ? <Prose html={question.html} className="text-[15.5px] font-semibold leading-snug" /> : null}
          {hint ? <Prose html={hint.html} className="mt-1 !text-[14px] !text-ink-3" /> : null}
        </div>
        <div className="-mr-2 -mt-1 flex shrink-0 gap-0.5">
          {item ? (
            <button type="button" aria-label={noted ? t.inYourNotes : t.writeInNotes} title={noted ? t.inYourNotes : t.writeInNotes} onClick={() => void note()} className={clsx('grid size-8 place-items-center rounded-md transition-colors hover:bg-sunk hover:text-ink', noted ? 'text-done' : 'text-ink-3')}>
              {noted ? <Check size={16} /> : <NotebookPen size={16} />}
            </button>
          ) : null}
          {flashcards ? (
            <button type="button" aria-label={t.makeCardOf} title={t.makeCardOf} onClick={() => setMaking(true)} className="grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-sunk hover:text-ink">
              <Layers size={16} />
            </button>
          ) : null}
        </div>
      </div>
      {flashcards && making ? <MakeCardDialog open onClose={() => setMaking(false)} exerciseId={item} initial={{ kind: 'basic', front: text(), back: '' }} /> : null}
    </Frame>
  );
}

// ───────────────────────── steps ─────────────────────────

/** Where one is in a sequence, with buttons back and forth. Shared by the widgets that go step by step. */
export function StepBar({
  at,
  count,
  label,
  labels,
  onGo,
  canNext = true,
  extra,
}: {
  at: number;
  count: number;
  label?: string | undefined;
  labels?: (string | undefined)[];
  onGo: (i: number) => void;
  /** False while the step still has to be done (a widget the student works through). */
  canNext?: boolean;
  /** Before the arrows: a play button, the eye that does a step for the student. */
  extra?: React.ReactNode;
}) {
  const t = useT().widget;
  return (
    <div className="flex items-center gap-3">
      <div className="flex shrink-0 gap-1" role="group" aria-label={t.stepOf(at + 1, count)}>
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={labels?.[i]?.replace(/`/g, '') ?? t.stepOf(i + 1, count)}
            aria-current={i === at ? 'step' : undefined}
            title={labels?.[i]?.replace(/`/g, '')}
            onClick={() => onGo(i)}
            className={clsx('h-2 rounded-full transition-all', i === at ? 'w-6 bg-accent' : i < at ? 'w-2 bg-accent/50 hover:bg-accent' : 'w-2 bg-line-strong hover:bg-ink-3')}
          />
        ))}
      </div>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-3" aria-live="polite">
        {t.stepOf(at + 1, count)}
        {label ? (
          <span className="font-medium text-ink-2">
            {' · '}
            <Message text={label} />
          </span>
        ) : null}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {extra}
        <button type="button" aria-label={t.back} title={t.back} disabled={at === 0} onClick={() => onGo(at - 1)} className="grid size-8 place-items-center rounded-md border border-line-strong bg-sheet text-ink-2 hover:bg-sunk hover:text-ink disabled:opacity-35">
          <ChevronLeft size={17} />
        </button>
        {at < count - 1 ? (
          <button type="button" aria-label={t.next} title={t.next} disabled={!canNext} onClick={() => onGo(at + 1)} className="grid size-8 place-items-center rounded-md bg-accent text-accent-ink hover:brightness-110 disabled:bg-sunk disabled:text-ink-3 disabled:hover:brightness-100">
            <ChevronRight size={17} />
          </button>
        ) : (
          <button type="button" aria-label={t.again} title={t.again} onClick={() => onGo(0)} className="grid size-8 place-items-center rounded-md border border-line-strong bg-sheet text-ink-2 hover:bg-sunk hover:text-ink">
            <RotateCcw size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function Steps({ parts }: { parts: Part[] }) {
  const [at, setAt] = useState(0);
  const n = parts.length;
  if (!n) return null;
  return (
    <Frame>
      <StepBar at={at} count={n} label={parts[at]!.attrs.label} labels={parts.map((p) => p.attrs.label)} onGo={setAt} />
      {/* Every step stays in the page, so what it says can be searched and is read in one piece. */}
      {parts.map((p, i) => (
        <div key={i} hidden={i !== at} className="settle">
          <Prose html={p.html} />
        </div>
      ))}
    </Frame>
  );
}

// ───────────────────────── tabs ─────────────────────────

function Tabs({ parts, label }: { parts: Part[]; label?: string | undefined }) {
  const t = useT().widget;
  const [at, setAt] = useState(0);
  if (!parts.length) return null;
  const choice = <Choice options={parts.map((p, i) => p.attrs.label ?? String(i + 1))} at={at} onPick={setAt} code label={label ?? t.examples} />;
  return (
    <Frame>
      {label ? <Row label={label}>{choice}</Row> : choice}
      {/* All of them stay laid out, so switching does not move the page. */}
      <div className="wb-stack">
        {parts.map((p, i) => (
          <div key={i} aria-hidden={i !== at} inert={i !== at}>
            <Prose html={p.html} />
          </div>
        ))}
      </div>
    </Frame>
  );
}

// ───────────────────────── recipe ─────────────────────────

/** A numbered procedure, each step next to what it gives for the chosen example. */
function Recipe({ parts }: { parts: Part[] }) {
  const t = useT().widget;
  const steps = parts.filter((p) => p.name === 'step');
  const examples = parts.filter((p) => p.name === 'example');
  const [at, setAt] = useState(0);
  const example = examples[at];
  return (
    <Frame>
      {examples.length > 1 ? (
        <Row label={t.example}>
          <Choice options={examples.map((e, i) => e.attrs.label ?? String(i + 1))} at={at} onPick={setAt} code label={t.example} />
        </Row>
      ) : null}
      {/* One grid for all steps, so the code of every step starts in the same place. */}
      <div role="list" className="grid grid-cols-[26px_minmax(0,1fr)] gap-x-3 sm:grid-cols-[26px_minmax(0,1fr)_minmax(min-content,1.4fr)]">
        {steps.map((s, i) => (
          <div
            role="listitem"
            key={i}
            className="col-span-full grid grid-cols-subgrid items-start gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0.5 last:pb-0"
          >
            <span className="text-[15px] font-semibold tabular-nums text-accent">{i + 1}</span>
            <div className="text-[14.5px] leading-normal">
              {s.attrs.label ? (
                <strong className="block font-semibold">
                  <Message text={s.attrs.label} />
                </strong>
              ) : null}
              <Prose html={s.html} className="text-[14.5px] leading-normal" />
            </div>
            {example?.parts[i] ? (
              <div key={at} className="settle col-start-2 min-w-0 sm:col-start-3">
                <Prose html={example.parts[i]!.html} className="wb-recipe-code" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Frame>
  );
}
