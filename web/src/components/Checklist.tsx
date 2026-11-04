import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ChecklistAnswer, ChecklistQuestion } from '@wb/shared';
import { keys, saveChecklistAnswer, useState_ } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useDebouncedCallback } from '@/lib/useDebounced';
import { Prose } from './Prose';
import { clsx } from './ui';

const LEVELS = [1, 2, 3, 4, 5] as const;

/** Questions about a chapter or section as a whole: a rating and, if it helps, a few sentences. */
export function Checklist({ id, questions }: { id: string; questions: ChecklistQuestion[] }) {
  const given = useState_().data?.state.checklists[id];
  // Only once the answers are there, so the text fields start from what was saved.
  if (useState_().isPending) return null;
  return (
    <ol className="mt-6 space-y-4">
      {questions.map((q) => (
        <Question key={q.id} checklistId={id} question={q} saved={given?.[q.id]} />
      ))}
    </ol>
  );
}

function Question({ checklistId, question, saved }: { checklistId: string; question: ChecklistQuestion; saved: ChecklistAnswer | undefined }) {
  const t = useT();
  const qc = useQueryClient();
  const [confidence, setConfidence] = useState<ChecklistAnswer['confidence']>(saved?.confidence ?? null);
  const [note, setNote] = useState(saved?.note ?? '');
  const [failed, setFailed] = useState(false);

  const store = (c: ChecklistAnswer['confidence'], n: string) => {
    saveChecklistAnswer(checklistId, question.id, c, n).then(
      () => {
        setFailed(false);
        void qc.invalidateQueries({ queryKey: keys.state });
        void qc.invalidateQueries({ queryKey: keys.mine });
      },
      () => setFailed(true),
    );
  };
  const later = useDebouncedCallback(store, 600);

  return (
    <li className="rounded-lg border border-line bg-sheet p-4">
      <Prose html={question.html} className="prose-note" />
      <div role="group" aria-label={t.checklistRating} className="mt-3 flex flex-wrap gap-1.5">
        {LEVELS.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={confidence === n}
            onClick={() => {
              const next = confidence === n ? null : n;
              setConfidence(next);
              later.cancel();
              store(next, note);
            }}
            className={clsx('rounded-full border px-3 py-1 text-[13px]', confidence === n ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-paper text-ink-2 hover:border-line-strong')}
          >
            {n} · {t.confidence[n]}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        value={note}
        aria-label={t.checklistNote}
        placeholder={t.checklistNote}
        onChange={(e) => {
          setNote(e.target.value);
          later.call(confidence, e.target.value);
        }}
        className="mt-3 w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      {failed ? (
        <p className="mt-1 text-[13px] text-danger" role="alert">
          {t.couldNotSave}
        </p>
      ) : null}
    </li>
  );
}
