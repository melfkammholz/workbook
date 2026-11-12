import { Check, Pencil, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { QUESTION_KINDS, type Change, type Question, type QuestionKind } from '@wb/shared';
import { Button, Empty, Spinner, clsx } from '@/components/ui';
import { decideChange, useChanges, useQuestions } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { isTyping } from '@/lib/keys';

type Value = string | string[] | null;

/** The inbox: what the assistant proposed for the student's questions, one line each, quick to go through. */
export function InboxPage() {
  const t = useT();
  const changes = useChanges().data;
  const questions = useQuestions().data;
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState(false);
  const [edit, setEdit] = useState<{ id: string; value: Value } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const pending = useMemo(() => (changes ?? []).filter((c) => c.status === 'pending'), [changes]);
  const lately = useMemo(() => (changes ?? []).filter((c) => c.status !== 'pending').slice(0, 15), [changes]);
  const byGroup = useMemo(() => {
    const groups = new Map<string, Change[]>();
    for (const c of pending) (groups.get(c.group) ?? groups.set(c.group, []).get(c.group)!).push(c);
    return [...groups.values()];
  }, [pending]);
  const flat = byGroup.flat();
  const current = flat[Math.min(cursor, flat.length - 1)];

  const act = async (c: Change, decision: 'accept' | 'reject' | 'undo') => {
    setError(false);
    const value = edit?.id === c.id ? edit.value : undefined;
    try {
      await decideChange(c.id, decision, { ...(notes[c.id] ? { feedback: notes[c.id]! } : {}), ...(decision === 'accept' && value !== undefined ? { after: value } : {}) });
      setEdit(null);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !current) return;
      if (e.key === 'ArrowDown') setCursor((n) => Math.min(n + 1, flat.length - 1));
      else if (e.key === 'ArrowUp') setCursor((n) => Math.max(n - 1, 0));
      else if (e.key === 'a') void act(current, 'accept');
      else if (e.key === 'x') void act(current, 'reject');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  useEffect(() => {
    if (current) rowRefs.current.get(current.id)?.scrollIntoView({ block: 'nearest' });
  }, [current?.id]);

  if (!changes || !questions) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  const question = (id: string) => questions.find((q) => q.id === id);
  const kindName = (k: Value) => (typeof k === 'string' && (QUESTION_KINDS as readonly string[]).includes(k) ? t.questionKinds[k as QuestionKind] : t.inboxNone);
  const show = (c: Change, v: Value) => (c.field === 'kind' ? kindName(v) : c.field === 'labels' ? (Array.isArray(v) && v.length ? v.join(', ') : t.inboxNone) : typeof v === 'string' ? v : t.inboxNone);
  const fieldName = (c: Change) => (c.field === 'kind' ? t.inboxFieldKind : c.field === 'labels' ? t.inboxFieldLabels : t.inboxFieldAnswer);

  const editor = (c: Change) => {
    const value = edit?.id === c.id ? edit.value : c.after;
    const set = (v: Value) => setEdit({ id: c.id, value: v });
    if (c.field === 'kind')
      return (
        <select value={typeof value === 'string' ? value : ''} onChange={(e) => set(e.target.value || null)} aria-label={fieldName(c)} className="wb-field px-2 py-1 text-sm">
          <option value="">{t.inboxNone}</option>
          {QUESTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.questionKinds[k]}
            </option>
          ))}
        </select>
      );
    if (c.field === 'labels')
      return <input value={Array.isArray(value) ? value.join(', ') : ''} onChange={(e) => set(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} placeholder={t.inboxLabelsHint} aria-label={fieldName(c)} className="wb-field w-full px-2 py-1 text-sm" />;
    return <textarea rows={4} value={typeof value === 'string' ? value : ''} onChange={(e) => set(e.target.value)} aria-label={fieldName(c)} className="wb-field w-full px-2 py-1 text-sm" />;
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="settle wb-page mx-auto max-w-3xl px-6 pb-12 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.inboxTitle}</h1>
        <p className="mt-2 text-ink-2">{t.inboxIntro}</p>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {t.inboxFailed}
          </p>
        ) : null}
        {byGroup.length === 0 ? (
          <Empty title={t.inboxEmpty}>{t.inboxEmptyBody}</Empty>
        ) : (
          <>
            <p className="mt-3 text-[13px] text-ink-3">{t.inboxKeys}</p>
            <ul className="mt-4 space-y-4">
              {byGroup.map((group) => {
                const q = question(group[0]!.ref.id);
                return (
                  <li key={group[0]!.group} className="rounded-lg border border-line bg-surface p-3">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] font-medium leading-snug">{q?.text || (q && quoteOf(q)) || t.inboxNoText}</p>
                      {group.length > 1 ? (
                        <Button size="sm" variant="ghost" onClick={() => void Promise.all(group.map((c) => act(c, 'accept')))}>
                          {t.inboxAcceptGroup}
                        </Button>
                      ) : null}
                    </div>
                    <ul className="mt-2 divide-y divide-line">
                      {group.map((c) => {
                        const editing = edit?.id === c.id;
                        const here = current?.id === c.id;
                        return (
                          <li key={c.id} ref={(el) => void (el ? rowRefs.current.set(c.id, el) : rowRefs.current.delete(c.id))} onClick={() => setCursor(flat.findIndex((x) => x.id === c.id))} className={clsx('py-2', here && 'rounded-md bg-sunk px-2 -mx-2')}>
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1 text-[13.5px]">
                                <span className="font-medium text-ink-2">{fieldName(c)}: </span>
                                {editing ? (
                                  editor(c)
                                ) : c.field === 'answer' ? (
                                  <p className="mt-0.5 whitespace-pre-wrap break-words">{show(c, c.after)}</p>
                                ) : (
                                  <>
                                    <span className="text-ink-3">{show(c, c.before)} → </span>
                                    <span>{show(c, c.after)}</span>
                                  </>
                                )}
                                {c.field === 'answer' ? <p className="mt-0.5 text-[12.5px] text-ink-3">{t.inboxAnswerClose}</p> : null}
                                {c.reason ? <p className="mt-0.5 text-[12.5px] text-ink-3">{c.reason}</p> : null}
                                <input
                                  value={notes[c.id] ?? ''}
                                  onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                                  placeholder={t.inboxNote}
                                  aria-label={t.inboxNote}
                                  className="mt-1.5 block w-full bg-transparent text-[12.5px] text-ink-2 placeholder:text-ink-3 focus:outline-none"
                                />
                              </div>
                              <span className="flex shrink-0 gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setEdit(editing ? null : { id: c.id, value: c.after })} aria-pressed={editing} title={t.inboxEdit}>
                                  <Pencil size={13} />
                                  <span className="sr-only">{t.inboxEdit}</span>
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => void act(c, 'reject')}>
                                  <X size={14} aria-hidden /> {t.inboxReject}
                                </Button>
                                <Button size="sm" variant="primary" onClick={() => void act(c, 'accept')}>
                                  <Check size={14} aria-hidden /> {t.inboxAccept}
                                </Button>
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {lately.length ? (
          <section className="mt-10">
            <h2 className="mb-2 text-[15px] font-semibold">{t.inboxLately}</h2>
            <ul className="divide-y divide-line text-[13.5px]">
              {lately.map((c) => (
                <li key={c.id} className="flex items-start gap-2 py-1.5">
                  <span className="min-w-0 flex-1 break-words">
                    <span className="text-ink-3">{t.inboxStatus[c.status]} · </span>
                    <span className="text-ink-2">{fieldName(c)}: </span>
                    {show(c, c.after)}
                    {c.feedback ? <span className="text-ink-3"> · {c.feedback}</span> : null}
                  </span>
                  {c.status === 'applied' ? (
                    <Button size="sm" variant="ghost" onClick={() => void act(c, 'undo')}>
                      <Undo2 size={13} aria-hidden /> {t.inboxUndo}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const quoteOf = (q: Question) => (q.anchor.kind === 'page' || q.anchor.kind === 'text' ? q.anchor.quote : undefined);
