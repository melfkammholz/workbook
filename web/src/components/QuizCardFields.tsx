import { Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { CodeEditor } from './CodeEditor';
import { Button, IconButton, clsx } from './ui';

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
    const inner = s.slice(i + 1, end).trim();
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
  const group = useId();
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

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">{t.quizQuestion}</span>
        <Box rows={3} focus={autoFocus}>
          <CodeEditor value={fields.question} onChange={(question) => setFields((f) => ({ ...f, question }))} language="typst" variant="notes" wrap lineNumbers={false} label={t.quizQuestion} tabMovesFocus />
        </Box>
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t.quizAnswers}</legend>
        {fields.answers.map((a, i) => (
          <div key={i} className={clsx('flex items-start gap-2 rounded-lg border p-2', a.correct ? 'border-done/50 bg-done-soft/40' : 'border-line')}>
            <label className="mt-1.5 flex shrink-0 cursor-pointer flex-col items-center gap-0.5 text-[11px] text-ink-3" title={t.quizCorrect}>
              <input type="radio" name={group} checked={a.correct} onChange={() => set(i, { correct: true })} className="size-4 accent-[var(--done)]" />
              {t.quizCorrectShort}
            </label>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Box rows={1.2}>
                <CodeEditor value={a.text} onChange={(text) => set(i, { text })} language="typst" variant="notes" wrap lineNumbers={false} label={t.quizAnswer(i + 1)} placeholder={t.quizAnswer(i + 1)} tabMovesFocus />
              </Box>
              <Box rows={1.6} quiet>
                <CodeEditor value={a.why} onChange={(why) => set(i, { why })} language="typst" variant="notes" wrap lineNumbers={false} label={t.quizWhy} placeholder={a.correct ? t.quizWhyRight : t.quizWhyWrong} tabMovesFocus />
              </Box>
            </div>
            <IconButton label={t.quizRemove} disabled={fields.answers.length <= 2} onClick={() => setFields((f) => ({ ...f, answers: f.answers.filter((_, j) => j !== i) }))} className="size-7 shrink-0">
              <X size={14} />
            </IconButton>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setFields((f) => ({ ...f, answers: [...f.answers, blank()] }))}>
          <Plus size={14} /> {t.quizAdd}
        </Button>
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
