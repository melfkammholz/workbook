import * as Popover from '@radix-ui/react-popover';
import { Check, Circle, HelpCircle, Pencil, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { PASS_GAP_MS, type Question } from '@wb/shared';
import { askQuestion, deleteQuestion, updateQuestion, useQuestions } from '@/lib/api';
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

/**
 * One line to write a question into: Enter saves it and the cursor stays, ready for the next. After a long pause the
 * next capture starts a new pass; a quiet line says so and offers to go on with the last one instead.
 */
export function CaptureField({
  onSave,
  autoFocus = false,
  fieldRef,
  attr,
  placeholder,
}: {
  onSave: (text: string, continuePass: boolean) => void;
  autoFocus?: boolean;
  fieldRef?: React.Ref<HTMLTextAreaElement>;
  /** A data attribute to find the field by (the hotkey focuses it). */
  attr?: string;
  placeholder?: string;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [carryOn, setCarryOn] = useState(false);
  const grow = useAutoGrow(text);
  const all = useQuestions().data;
  const last = all?.reduce((m, q) => Math.max(m, q.createdAt), 0) ?? 0;
  const newPass = last > 0 && Date.now() - last >= PASS_GAP_MS;
  const save = () => {
    const q = text.trim();
    if (!q) return;
    setText('');
    setCarryOn(false);
    onSave(q, newPass && carryOn);
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
        onKeyDown={(e) => submitKey(e, save)}
        className="block w-full resize-none wb-field px-3 py-2 text-sm placeholder:text-ink-3"
      />
      {newPass ? (
        <p className="mt-1 px-1 text-[12px] text-ink-3">
          {carryOn ? t.questionContinuing : t.questionNewPass} ·{' '}
          <button type="button" onClick={() => setCarryOn(!carryOn)} className="underline hover:text-ink">
            {carryOn ? t.questionStartNewPass : t.questionContinuePass}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** A question on an item: the line to write it, saved to that item. */
export function QuestionInput({ item, autoFocus = false }: { item: string; autoFocus?: boolean }) {
  return <CaptureField autoFocus={autoFocus} onSave={(text, carryOn) => void askQuestion({ item }, text, carryOn)} />;
}

export function QuestionRow({ item, q, extra }: { item: string | null; q: Question; extra?: React.ReactNode }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useAutoGrow(draft ?? '');
  const done = q.status === 'done';
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
