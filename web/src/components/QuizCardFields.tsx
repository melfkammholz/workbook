import { Check, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { CodeEditor } from './CodeEditor';
import { clsx } from './ui';

/**
 * A quiz card as a form: the question, then its answers, each with why it is right or wrong and whether it
 * is the right one. Underneath it is the same text as `#quiz` in a lesson, so a quiz from a lesson opens here.
 */

export interface QuizAnswer {
  text: string;
  why: string;
  correct: boolean;
}

export interface QuizFields {
  question: string;
  answers: QuizAnswer[];
}

/** Where a bracket opened at `i` closes, minding raw text, escapes and nested brackets. Content only. */
function closing(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j]!;
    if (c === '\\') j++;
    else if (c === '`') {
      let n = 0;
      while (s[j + n] === '`') n++;
      const end = s.indexOf('`'.repeat(n), j + n);
      j = end < 0 ? s.length : end + n - 1;
    } else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return j;
  }
  return -1;
}

/** Reads `[question], choice[…][…], choice(correct: true)[…][…]`. Null for anything it cannot take apart. */
export function parseQuiz(src: string): QuizFields | null {
  const s = src.trim();
  let i = 0;
  const skip = () => {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++;
  };
  const block = (): string | null => {
    if (s[i] !== '[') return null;
    const end = closing(s, i);
    if (end < 0) return null;
    const raw = s.slice(i + 1, end).trim();
    // In Typst a single line break is a space: lines wrapped in the source are one line here. Blank lines stay.
    const inner = raw.includes('```') ? raw : raw.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/([^\n])\n(?!\n)/g, '$1 ');
    i = end + 1;
    return inner;
  };
  skip();
  const question = block();
  if (question === null) return null;
  const answers: QuizAnswer[] = [];
  for (skip(); i < s.length; skip()) {
    if (!s.startsWith('choice', i)) return null;
    i += 'choice'.length;
    let correct = false;
    if (s[i] === '(') {
      const end = s.indexOf(')', i);
      if (end < 0) return null;
      correct = /correct\s*:\s*true/.test(s.slice(i, end));
      i = end + 1;
    }
    const text = block();
    if (text === null) return null;
    const why = s[i] === '[' ? block() : '';
    if (why === null) return null;
    answers.push({ text, why, correct });
  }
  return { question, answers };
}

/** The text of a quiz, as written in a lesson. */
export function quizText(f: QuizFields): string {
  const lines = [`[${f.question.trim()}],`];
  for (const a of f.answers) {
    if (!a.text.trim()) continue;
    lines.push(`choice${a.correct ? '(correct: true)' : ''}[${a.text.trim()}]${a.why.trim() ? `[${a.why.trim()}]` : ''},`);
  }
  return lines.join('\n');
}

const blank = (): QuizAnswer => ({ text: '', why: '', correct: false });

export function QuizCardFields({ value, onChange, autoFocus }: { value: string; onChange: (text: string) => void; autoFocus?: boolean }) {
  const t = useT();
  // Read once: from here on the form is the source, and the text follows it.
  const [fields, setFields] = useState<QuizFields>(() => parseQuiz(value) ?? { question: '', answers: [{ ...blank(), correct: true }, blank()] });
  const [raw] = useState(() => value.trim() !== '' && parseQuiz(value) === null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange(quizText(fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  const set = (i: number, patch: Partial<QuizAnswer>) =>
    setFields((f) => ({ ...f, answers: f.answers.map((a, j) => (j === i ? { ...a, ...patch } : patch.correct ? { ...a, correct: false } : a)) }));

  if (raw) {
    // Written by hand in a way the form does not know: the text stays editable as it is.
    return (
      <label className="block">
        <span className="text-sm font-medium">{t.quizText}</span>
        <Box rows={9}>
          <CodeEditor value={value} onChange={onChange} language="typst" variant="notes" wrap lineNumbers={false} label={t.quizText} tabMovesFocus />
        </Box>
      </label>
    );
  }

  const editor = (value: string, onChange: (v: string) => void, label: string, placeholder?: string, variant: 'notes' | 'field' = 'field') => (
    <CodeEditor value={value} onChange={onChange} language="typst" variant={variant} wrap lineNumbers={false} label={label} placeholder={placeholder ?? label} tabMovesFocus />
  );

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">{t.quizQuestion}</span>
        <Box rows={2.5} focus={autoFocus}>
          {editor(fields.question, (question) => setFields((f) => ({ ...f, question })), t.quizQuestion, undefined, 'notes')}
        </Box>
      </label>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t.quizAnswers}</legend>
        {/* One list, as the answers will look on the card: a circle marks the right one. */}
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line-strong bg-sheet">
          {fields.answers.map((a, i) => (
            <li key={i} className="group flex items-start gap-2 px-2.5 py-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={a.correct}
                aria-label={t.quizCorrect}
                title={t.quizCorrect}
                onClick={() => set(i, { correct: true })}
                className={clsx(
                  // Centred on the answer's first line: 5px padding, half of a 21.6px line, less half the circle.
                  'mt-[7px] grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors',
                  a.correct ? 'border-done bg-done text-sheet' : 'border-line-strong hover:border-done',
                )}
              >
                {a.correct ? <Check size={11} strokeWidth={3.5} /> : null}
              </button>
              <div className="min-w-0 flex-1">
                {/* Without a height of their own, the fields grow with what is written. */}
                <div>{editor(a.text, (text) => set(i, { text }), t.quizAnswer(i + 1))}</div>
                {/* The explanation belongs to the answer above, and says less: smaller, quieter, set off by a line. */}
                <div className="mb-1 ml-1 border-l-2 border-line pl-1.5" style={{ '--ink': 'var(--ink-2)', '--editor-font-size': '12.5px' } as React.CSSProperties}>
                  {editor(a.why, (why) => set(i, { why }), t.quizWhy, a.correct ? t.quizWhyRight : t.quizWhyWrong)}
                </div>
              </div>
              <button
                type="button"
                aria-label={t.quizRemove}
                title={t.quizRemove}
                disabled={fields.answers.length <= 2}
                onClick={() => setFields((f) => ({ ...f, answers: f.answers.filter((_, j) => j !== i) }))}
                className="mt-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition-opacity hover:bg-sunk hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:!opacity-0"
              >
                <X size={14} />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setFields((f) => ({ ...f, answers: [...f.answers, blank()] }))} className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13.5px] text-ink-2 hover:bg-sunk hover:text-ink">
              <Plus size={15} className="ml-px" /> {t.quizAdd}
            </button>
          </li>
        </ul>
      </fieldset>
    </div>
  );
}

/** A small editor's frame, as tall as a few lines. */
function Box({ rows, children, quiet, focus }: { rows: number; children: React.ReactNode; quiet?: boolean; focus?: boolean | undefined }) {
  return (
    <div
      className={clsx('mt-1 overflow-hidden rounded-md border bg-sheet focus-within:border-accent', quiet ? 'border-line' : 'border-line-strong')}
      style={{ height: `${rows * 1.6 + 1.9}em` }}
      ref={(el) => {
        if (focus && el && !el.dataset.focused) {
          el.dataset.focused = '1';
          requestAnimationFrame(() => el.querySelector<HTMLElement>('.cm-content')?.focus());
        }
      }}
    >
      {children}
    </div>
  );
}
