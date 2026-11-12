import * as Popover from '@radix-ui/react-popover';
import { Check, Circle, HelpCircle, Pencil, Trash2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { PASS_GAP_MS, type Question } from '@wb/shared';
import { askQuestion, deleteQuestion, updateQuestion, useQuestions, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, IconButton, clsx } from './ui';

/** Grows with its text, up to a few lines: one line to type into, more only when it is needed. */
function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);
  return ref;
}

/** Enter saves, Shift+Enter breaks the line; an input method composing text keeps its own Enter. */
function submitKey(e: React.KeyboardEvent, submit: () => void, cancel?: () => void) {
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Escape' && cancel) {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }
}

/** A tag a question may carry: typed as `!p` after the text, taken out of it when saved. */
export interface QuestionTag {
  key: string;
  /** Shown under the line, e.g. "!p page 3". */
  hint: string;
  /** False: the hint is dimmed and the tag does nothing (no selection to take). */
  available: boolean;
}

/** Takes `!x` words (surrounded by spaces) out of a text; returns the text without them and the ones found. */
export function parseTags(raw: string, known: readonly string[]): { text: string; tags: string[] } {
  const tags: string[] = [];
  const text = raw
    .replace(/(^|\s)!([a-z])(?=\s|$)/g, (m, pre: string, k: string) => {
      if (!known.includes(k)) return m;
      if (!tags.includes(k)) tags.push(k);
      return pre;
    })
    .replace(/ {2,}/g, ' ')
    .trim();
  return { text, tags };
}

/** The look of the place a question is written in: a small card with an optional line about where it will land. */
export function QuestionCard({ context, onClose, className, children }: { context?: string | null; onClose?: () => void; className?: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className={clsx('rounded-xl border border-line-strong bg-sheet p-2.5 shadow-[var(--shadow)]', className)}>
      {context || onClose ? (
        <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] text-ink-3">
          <span className="min-w-0 flex-1 truncate">{context}</span>
          {onClose ? (
            <IconButton label={t.close} className="size-5" onClick={onClose}>
              <X size={13} />
            </IconButton>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * One line to write a question into: Enter saves it and the cursor stays, ready for the next. `!x` tags at the end
 * ask for more than the text (`!p`: this page, `!s`: the selection); the line under it lists what is on offer. After a
 * long pause the next capture starts a new pass; a quiet line says so and offers to go on with the last one instead.
 */
export function CaptureField({
  onSave,
  autoFocus = false,
  fieldRef,
  attr,
  placeholder,
  tags = [],
  onCancel,
}: {
  onSave: (text: string, o: { continuePass: boolean; tags: string[] }) => void;
  autoFocus?: boolean;
  fieldRef?: React.Ref<HTMLTextAreaElement>;
  /** A data attribute to find the field by (the hotkey focuses it). */
  attr?: string;
  placeholder?: string;
  tags?: QuestionTag[];
  onCancel?: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [carryOn, setCarryOn] = useState(false);
  const grow = useAutoGrow(text);
  const all = useQuestions().data;
  const last = all?.reduce((m, q) => Math.max(m, q.createdAt), 0) ?? 0;
  const newPass = last > 0 && Date.now() - last >= PASS_GAP_MS;
  const typed = parseTags(text, tags.filter((x) => x.available).map((x) => x.key)).tags;
  const save = () => {
    const parsed = parseTags(text, tags.filter((x) => x.available).map((x) => x.key));
    if (!parsed.text) return;
    setText('');
    setCarryOn(false);
    onSave(parsed.text, { continuePass: newPass && carryOn, tags: parsed.tags });
  };
  return (
    <div>
      <textarea
        ref={(el) => {
          (grow as { current: HTMLTextAreaElement | null }).current = el;
          if (typeof fieldRef === 'function') fieldRef(el);
          else if (fieldRef) (fieldRef as { current: HTMLTextAreaElement | null }).current = el;
        }}
        rows={1}
        autoFocus={autoFocus}
        value={text}
        aria-label={t.questionInput}
        placeholder={placeholder ?? t.questionPlaceholder}
        {...(attr ? { [attr]: '' } : {})}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => submitKey(e, save, onCancel)}
        className="block w-full resize-none wb-field px-3 py-2 text-sm placeholder:text-ink-3"
      />
      {tags.length || newPass ? (
        <p className="mt-1 flex flex-wrap gap-x-3 px-1 text-[12px] text-ink-3">
          {tags.map((x) => (
            <span key={x.key} className={clsx(!x.available && 'opacity-60', typed.includes(x.key) && 'font-medium text-accent')}>
              {x.hint}
            </span>
          ))}
          {newPass ? (
            <span>
              {carryOn ? t.questionContinuing : t.questionNewPass} ·{' '}
              <button type="button" onClick={() => setCarryOn(!carryOn)} className="underline hover:text-ink">
                {carryOn ? t.questionStartNewPass : t.questionContinuePass}
              </button>
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** A question on an item: the line to write it, saved to that item. */
export function QuestionInput({ item, autoFocus = false }: { item: string; autoFocus?: boolean }) {
  return <CaptureField autoFocus={autoFocus} onSave={(text, o) => void askQuestion({ item }, text, o.continuePass)} />;
}

export function QuestionRow({ item, q, extra }: { item: string | null; q: Question; extra?: React.ReactNode }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useAutoGrow(draft ?? '');
  const done = q.status === 'done';
  const labelNames = new Map((useSettings().data?.highlightLabels ?? []).map((l) => [l.id, l.name]));
  const store = () => {
    const text = (draft ?? '').trim();
    setDraft(null);
    if (text && text !== q.text) void updateQuestion(item, q.id, { text });
  };
  return (
    <li className="group flex items-start gap-1.5 py-1.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? t.questionReopen : t.questionDone}
        title={done ? t.questionReopen : t.questionDone}
        onClick={() => void updateQuestion(item, q.id, { status: done ? 'open' : 'done' })}
        className={clsx('mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full', done ? 'text-done' : 'text-ink-3 hover:text-ink')}
      >
        {done ? <Check size={16} /> : <Circle size={16} />}
      </button>
      {draft !== null ? (
        <div className="min-w-0 flex-1">
          <textarea
            ref={ref}
            rows={1}
            autoFocus
            value={draft}
            aria-label={t.editQuestion}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => submitKey(e, store, () => setDraft(null))}
            className="block w-full resize-none wb-field px-2 py-1 text-sm"
          />
          <div className="mt-1 flex gap-2">
            <Button size="sm" variant="primary" onClick={store}>
              {t.save}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              {t.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className={clsx('whitespace-pre-wrap break-words text-[14px] leading-snug', done && 'text-ink-3 line-through')}>{q.text}</p>
            {extra}
            {q.kind || q.labels.length ? (
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12.5px] text-ink-3">
                {q.kind ? <span>{t.questionKinds[q.kind]}</span> : null}
                {q.labels.flatMap((l) => (labelNames.has(l) ? [<span key={l}>#{labelNames.get(l)}</span>] : []))}
              </p>
            ) : null}
          </div>
          <span className="flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <IconButton label={t.editQuestion} className="size-6" onClick={() => setDraft(q.text)}>
              <Pencil size={13} />
            </IconButton>
            <IconButton label={t.deleteQuestion} className="size-6" onClick={() => void deleteQuestion(item, q.id)}>
              <Trash2 size={13} />
            </IconButton>
          </span>
        </>
      )}
    </li>
  );
}

/** The questions on one item: open ones, and done ones behind a switch. No counts: a list is not a score. */
export function QuestionList({ item, questions }: { item: string | null; questions: Question[] }) {
  const t = useT();
  const [showDone, setShowDone] = useState(false);
  const open = questions.filter((q) => q.status === 'open');
  const done = questions.filter((q) => q.status === 'done');
  const shown = showDone ? [...open, ...done] : open;
  return (
    <div>
      {shown.length ? (
        <ul className="divide-y divide-line">
          {shown.map((q) => (
            <QuestionRow key={q.id} item={item} q={q} />
          ))}
        </ul>
      ) : (
        <p className="py-1 text-[13px] text-ink-3">{t.noQuestions}</p>
      )}
      {done.length ? (
        <button type="button" onClick={() => setShowDone(!showDone)} aria-pressed={showDone} className="mt-1 text-[12.5px] text-ink-3 hover:text-ink">
          {showDone ? t.hideDoneQuestions : t.showDoneQuestions}
        </button>
      ) : null}
    </div>
  );
}

/** In the bar of an exercise: its questions and a line to add one, one click away and out of the way. */
export function ExerciseQuestions({ item, questions }: { item: string; questions: Question[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={t.questionsTitle}
          className={clsx('inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-sunk hover:text-ink', open ? 'bg-sunk text-ink' : 'text-ink-3')}
        >
          <HelpCircle size={14} /> <span className="hidden sm:inline">{t.questionsTitle}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-label={t.questionsTitle} className="wb-menu w-[22rem] max-w-[calc(100vw-1.5rem)] p-3">
          <QuestionInput item={item} autoFocus />
          <div className="mt-2 max-h-72 overflow-y-auto">
            <QuestionList item={item} questions={questions} />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
