import * as Popover from '@radix-ui/react-popover';
import { Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { QUESTION_KINDS, type Change, type QuestionKind } from '@wb/shared';
import { acceptChanges, decideChange } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, clsx } from './ui';

export type Value = string | string[] | null;

/** How a proposal's field and values read to the student. */
export function useChangeText() {
  const t = useT();
  const kindName = (k: Value) => (typeof k === 'string' && (QUESTION_KINDS as readonly string[]).includes(k) ? t.questionKinds[k as QuestionKind] : t.inboxNone);
  const show = (c: Change, v: Value) => (c.field === 'kind' ? kindName(v) : c.field === 'labels' ? (Array.isArray(v) && v.length ? v.join(', ') : t.inboxNone) : typeof v === 'string' ? v : t.inboxNone);
  const fieldName = (c: Change) => (c.field === 'kind' ? t.inboxFieldKind : c.field === 'labels' ? t.inboxFieldLabels : c.field === 'text' ? t.inboxFieldText : t.inboxFieldAnswer);
  return { show, fieldName };
}

/** The input to change what is proposed before accepting it. */
export function ChangeEditor({ c, value, onChange }: { c: Change; value: Value; onChange: (v: Value) => void }) {
  const t = useT();
  const { fieldName } = useChangeText();
  if (c.field === 'kind')
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} aria-label={fieldName(c)} className="wb-field px-2 py-1 text-sm">
        <option value="">{t.inboxNone}</option>
        {QUESTION_KINDS.map((k) => (
          <option key={k} value={k}>
            {t.questionKinds[k]}
          </option>
        ))}
      </select>
    );
  if (c.field === 'labels')
    return <input value={Array.isArray(value) ? value.join(', ') : ''} onChange={(e) => onChange(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} placeholder={t.inboxLabelsHint} aria-label={fieldName(c)} className="wb-field w-full px-2 py-1 text-sm" />;
  return <textarea rows={4} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} aria-label={fieldName(c)} className="wb-field w-full px-2 py-1 text-sm" />;
}

/** What a proposal would change: old and new for wording, type and labels; the answer alone. */
export function ChangeValue({ c }: { c: Change }) {
  const t = useT();
  const { show } = useChangeText();
  if (c.field === 'text')
    return (
      <>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-3 line-through decoration-ink-3/50">{show(c, c.before)}</p>
        <p className="mt-1 whitespace-pre-wrap break-words">{show(c, c.after)}</p>
      </>
    );
  if (c.field === 'answer')
    return (
      <>
        <p className="mt-0.5 whitespace-pre-wrap break-words">{show(c, c.after)}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-3">{t.inboxAnswerClose}</p>
      </>
    );
  return (
    <>
      <span className="text-ink-3">{show(c, c.before)} → </span>
      <span>{show(c, c.after)}</span>
    </>
  );
}

/** A small dot in the accent color on a question the assistant has proposed something for; it opens the proposals in place. */
export function ProposalMarker({ changes }: { changes: Change[] }) {
  const t = useT();
  const { fieldName } = useChangeText();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<{ id: string; value: Value } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setError(false);
    try {
      await f();
      setEdit(null);
      setNote('');
    } catch {
      setError(true);
    }
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" title={t.proposalMarker} aria-label={t.proposalMarker} className="mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-sunk">
          <span className="size-2 rounded-full bg-accent" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} aria-label={t.proposalMarker} className="wb-menu w-[24rem] max-w-[calc(100vw-1.5rem)] p-3">
          <ul className="divide-y divide-line">
            {changes.map((c) => {
              const editing = edit?.id === c.id;
              return (
                <li key={c.id} className="py-2 first:pt-0 last:pb-0">
                  <div className="text-[13.5px]">
                    <span className="font-medium text-ink-2">{fieldName(c)}: </span>
                    {editing ? <ChangeEditor c={c} value={edit.value} onChange={(value) => setEdit({ id: c.id, value })} /> : <ChangeValue c={c} />}
                    {c.reason ? <p className="mt-0.5 text-[12.5px] text-ink-3">{c.reason}</p> : null}
                  </div>
                  <div className={clsx('mt-1.5 flex items-center justify-end gap-1')}>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(editing ? null : { id: c.id, value: c.after })} aria-pressed={editing} title={t.inboxEdit}>
                      <Pencil size={13} />
                      <span className="sr-only">{t.inboxEdit}</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void run(() => decideChange(c.id, 'reject', note ? { feedback: note } : {}))}>
                      <X size={14} aria-hidden /> {t.inboxReject}
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => void run(() => decideChange(c.id, 'accept', editing ? { after: edit.value } : {}))}>
                      <Check size={14} aria-hidden /> {t.inboxAccept}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.inboxNote} aria-label={t.inboxNote} className="mt-2 block w-full bg-transparent text-[12.5px] text-ink-2 placeholder:text-ink-3 focus:outline-none" />
          {changes.length > 1 ? (
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => void run(() => acceptChanges(changes.map((c) => c.id)))}>
              {t.inboxAcceptGroup}
            </Button>
          ) : null}
          {error ? (
            <p role="alert" className="mt-1 text-[13px] text-danger">
              {t.inboxFailed}
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
