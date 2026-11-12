import { Check, Pencil, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Change, Question } from '@wb/shared';
import { ChangeEditor, ChangeValue, useChangeText, type Value } from '@/components/Proposals';
import { Button, Empty, Spinner, clsx } from '@/components/ui';
import { acceptChanges, decideChange, undoBatch, useChanges, useQuestions } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { isTyping } from '@/lib/keys';

/** The inbox: what the assistant proposed for the student's questions, one line each, quick to go through. */
export function InboxPage() {
  const t = useT();
  const changes = useChanges().data;
  const questions = useQuestions().data;
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState(false);
  const [edit, setEdit] = useState<{ id: string; value: Value } | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
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

  const acceptMany = async (ids: string[]) => {
    setError(false);
    try {
      if (ids.length === 1) await decideChange(ids[0]!, 'accept', {});
      else await acceptChanges(ids);
      setMarked(new Set());
    } catch {
      setError(true);
    }
  };
  const toggle = (id: string) =>
    setMarked((m) => {
      const n = new Set(m);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const markedIds = flat.filter((c) => marked.has(c.id)).map((c) => c.id);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !current) return;
      if (e.key === 'ArrowDown') setCursor((n) => Math.min(n + 1, flat.length - 1));
      else if (e.key === 'ArrowUp') setCursor((n) => Math.max(n - 1, 0));
      else if (e.key === 'a') void act(current, 'accept');
      else if (e.key === 'x') void act(current, 'reject');
      else if (e.key === ' ') toggle(current.id);
      else if (e.key === 'A') void acceptMany(markedIds.length ? markedIds : flat.filter((c) => c.group === current.group).map((c) => c.id));
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
  const { show, fieldName } = useChangeText();
  const editor = (c: Change) => <ChangeEditor c={c} value={edit?.id === c.id ? edit.value : c.after} onChange={(v) => setEdit({ id: c.id, value: v })} />;

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
            {markedIds.length ? (
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => void acceptMany(markedIds)}>
                  <Check size={14} aria-hidden /> {t.inboxAcceptMarked}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMarked(new Set())}>
                  {t.inboxClearMarks}
                </Button>
              </div>
            ) : null}
            <ul className="mt-4 space-y-4">
              {byGroup.map((group) => {
                const q = question(group[0]!.ref.id);
                return (
                  <li key={group[0]!.group} className="rounded-lg border border-line bg-surface p-3">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] font-medium leading-snug">{q?.text || (q && quoteOf(q)) || t.inboxNoText}</p>
                      {group.length > 1 ? (
                        <Button size="sm" variant="ghost" onClick={() => void acceptMany(group.map((c) => c.id))}>
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
                              <input type="checkbox" checked={marked.has(c.id)} onChange={() => toggle(c.id)} aria-label={t.inboxMark} className="mt-1 shrink-0" />
                              <div className="min-w-0 flex-1 text-[13.5px]">
                                <span className="font-medium text-ink-2">{fieldName(c)}: </span>
                                {editing ? (
                                  editor(c)
                                ) : (
                                  <ChangeValue c={c} />
                                )}
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
                  {c.status === 'applied' && c.batch && (changes ?? []).filter((x) => x.batch === c.batch && x.status === 'applied').length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => void undoBatch(c.batch!).catch(() => setError(true))}>
                      <Undo2 size={13} aria-hidden /> {t.inboxUndoBatch}
                    </Button>
                  ) : c.status === 'applied' ? (
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
