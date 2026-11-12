import * as Popover from '@radix-ui/react-popover';
import { HelpCircle, Pencil, Trash2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { type Question } from '@wb/shared';
import { askQuestion, deleteQuestion, updateQuestion, usePendingProposals, useQuestions, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ProposalMarker } from './Proposals';
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
    <div className={clsx('rounded-lg border border-line-strong bg-sheet p-1.5 shadow-[var(--shadow)]', className)}>
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
 * ask for more than the text (`!p`: this page, `!s`: the selection); the line under it lists what is on offer..
 */
export function CaptureField({
  onSave,
  autoFocus = false,
  fieldRef,
  attr,
  placeholder,
  tags = [],
  onCancel,
  onBlurEmpty,
}: {
  onSave: (text: string, o: { tags: string[] }) => void;
  autoFocus?: boolean;
  fieldRef?: React.Ref<HTMLTextAreaElement>;
  /** A data attribute to find the field by (the hotkey focuses it). */
  attr?: string;
  placeholder?: string;
  tags?: QuestionTag[];
  onCancel?: () => void;
  /** The line lost the focus with nothing written in it. */
  onBlurEmpty?: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const grow = useAutoGrow(text);
  const save = () => {
    const parsed = parseTags(text, tags.filter((x) => x.available).map((x) => x.key));
    if (!parsed.text) return;
    setText('');
    onSave(parsed.text, { tags: parsed.tags });
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
        onBlur={() => !text.trim() && onBlurEmpty?.()}
        onKeyDown={(e) => submitKey(e, save, onCancel)}
        className="block w-full resize-none wb-field px-2.5 py-1.5 text-sm placeholder:text-ink-3"
      />
    </div>
  );
}

/** A question on an item: the line to write it, saved to that item. */
export function QuestionInput({ item, autoFocus = false }: { item: string; autoFocus?: boolean }) {
  return <CaptureField autoFocus={autoFocus} onSave={(text, o) => void askQuestion({ item }, text)} />;
}

/**
 * `dense`: one line per question (text and the passage it was made on, then type, labels and age); the done mark is a
 * button among the hover actions, a done question is struck through with a small check at its end.
 */
export function QuestionRow({ item, q, extra, dense = false, where }: { item: string | null; q: Question; extra?: React.ReactNode; dense?: boolean; where?: string }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useAutoGrow(draft ?? '');
  const done = q.status === 'done';
  const waiting = usePendingProposals().get(q.id);
  const into = useQuestions().data?.find((x) => x.id === q.mergedInto);
  const labelNames = new Map((useSettings().data?.highlightLabels ?? []).map((l) => [l.id, l.name]));
  const store = () => {
    const text = (draft ?? '').trim();
    setDraft(null);
    if (text && text !== q.text) void updateQuestion(item, q.id, { text });
  };
  const editor = (
    <div className="min-w-0 flex-1">
      <textarea
        ref={ref}
        rows={1}
        autoFocus
        value={draft ?? ''}
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
  );
  if (dense) {
    const raw = q.anchor.kind === 'text' ? q.anchor.quote : q.anchor.kind === 'page' ? q.anchor.quote?.trim() || q.anchor.snippet : '';
    const quote = raw?.trim().replace(/\s+/g, ' ') || null;
    const days = Math.floor((Date.now() - q.createdAt) / 86_400_000);
    const labels = q.labels.flatMap((l) => (labelNames.has(l) ? [labelNames.get(l)!] : []));
    return (
      <li className="group py-1">
        {draft !== null ? (
          editor
        ) : (
          <div className={clsx('grid items-baseline', where ? 'grid-cols-[13rem_1fr_auto]' : 'grid-cols-[1fr_auto]')} style={{ columnGap: '0.625rem' }}>
            {where ? <span className="truncate text-[12.5px] text-accent">{where}</span> : null}
            <p className={clsx('min-w-0 truncate text-[14px] leading-[1.4]', done && 'text-ink-3 line-through')} title={q.text || undefined}>
              {q.text || (quote ? <span className="italic text-ink-3">{quote}</span> : <span className="text-ink-3">{t.inboxNoText}</span>)}
              {q.mergedInto ? <span className="ml-2 text-[12.5px] text-ink-3">{t.mergedInto}: {into?.text || t.inboxNoText}</span> : null}
            </p>
            <div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-3">
              {waiting ? <ProposalMarker changes={waiting} /> : null}
              <span className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <IconButton label={t.editQuestion} className="size-5" onClick={() => setDraft(q.text)}>
                  <Pencil size={12} />
                </IconButton>
                <IconButton label={t.deleteQuestion} className="size-5" onClick={() => void deleteQuestion(item, q.id)}>
                  <Trash2 size={12} />
                </IconButton>
              </span>
              {q.who ? <span title={t.inboxFromAssistant}>{t.assistantMark}</span> : null}
              {q.kind ? <span className="rounded-[3px] bg-review-soft px-1.5 text-review">{t.questionKinds[q.kind]}</span> : null}
              {labels.map((l) => (
                <span key={l} className="rounded-[3px] bg-sunk px-1.5 text-ink-2">
                  {l}
                </span>
              ))}
              <span className="min-w-[5.2rem] text-right tabular-nums" title={new Date(q.createdAt).toLocaleString()}>{t.questionAge(days)}</span>
              <input
                type="checkbox"
                checked={done}
                aria-label={done ? t.questionReopen : t.questionDone}
                title={done ? t.questionReopen : t.questionDone}
                onChange={() => void updateQuestion(item, q.id, { status: done ? 'open' : 'done' })}
                className="wb-check shrink-0"
              />
            </div>
          </div>
        )}
      </li>
    );
  }
  return (
    <li className="group flex items-start gap-1.5 py-1.5">
      <input
        type="checkbox"
        checked={done}
        aria-label={done ? t.questionReopen : t.questionDone}
        title={done ? t.questionReopen : t.questionDone}
        onChange={() => void updateQuestion(item, q.id, { status: done ? 'open' : 'done' })}
        className="wb-check mt-1 shrink-0"
      />
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
            {q.mergedInto ? <p className="mt-0.5 break-words text-[12.5px] text-ink-3">{t.mergedInto}: {into?.text || t.inboxNoText}</p> : null}
            {q.kind || q.labels.length || q.who ? (
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12.5px] text-ink-3">
                {q.who ? <span title={t.inboxFromAssistant}>{t.assistantMark}</span> : null}
                {q.kind ? <span>{t.questionKinds[q.kind]}</span> : null}
                {q.labels.flatMap((l) => (labelNames.has(l) ? [<span key={l}>#{labelNames.get(l)}</span>] : []))}
              </p>
            ) : null}
          </div>
          {waiting ? <ProposalMarker changes={waiting} /> : null}
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
