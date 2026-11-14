import { Check, Mail, Pencil, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { Change, Ticket } from '@wb/shared';
import { acceptChanges, decideChange, deleteTicket, setQuestionTags, undoBatch, updateTicket, useChanges, usePendingProposals, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useTags } from '@/lib/tags';
import { ProposalList, useChangeText } from './Proposals';
import { AnswerPanel, OutcomeIcons } from './QuestionAnswer';
import { QuestionMake } from './QuestionMake';
import { TagPicker } from './TagPicker';
import { UNDO_DAYS } from './ProposalDetail';
import { Title } from './Title';
import { Button, clsx } from './ui';

const DAY = 86_400_000;

interface Event {
  at: number;
  assistant: boolean;
  text: React.ReactNode;
  change?: Change;
}

/** The ticket for one question: the question, what you can do with it, what the assistant proposed, and what happened so far. */
export function QuestionDetail({ q, item, where, href, onClose, onAsk }: { q: Ticket; item: string | null; where: string; href: string | null; onClose: () => void; onAsk: () => void }) {
  const t = useT();
  const settings = useSettings().data;
  const ai = !!settings?.showAi;
  const bridge = !!(ai && settings?.assistantBridge);
  const changes = useChanges(bridge).data;
  const waiting = usePendingProposals().get(q.id) ?? [];
  const labels = useTags().data;
  const { fieldName } = useChangeText();
  const [editing, setEditing] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState(false);
  const raw = q.anchor.kind === 'text' ? q.anchor.quote : q.anchor.kind === 'page' ? q.anchor.quote?.trim() || q.anchor.snippet : '';
  const quote = raw?.trim().replace(/\s+/g, ' ') || null;
  const now = Date.now();

  const history = useMemo(() => {
    const out: Event[] = [{ at: q.createdAt, assistant: false, text: t.histAsked }];
    if (q.fetched) out.push({ at: q.fetched.at, assistant: true, text: t.histRead(q.fetched.purpose) });
    for (const c of changes ?? []) {
      const mine = c.field === 'create' ? (c.after as { question?: string } | null)?.question === q.id : c.ref.kind === 'question' && c.ref.id === q.id;
      if (!mine || c.status === 'pending') continue;
      out.push({ at: c.decidedAt ?? c.createdAt, assistant: false, text: t.histDecided(t.inboxStatus[c.status], fieldName(c)), change: c });
    }
    if (q.archivedAt) out.push({ at: q.archivedAt, assistant: false, text: t.histArchived });
    return out.sort((a, b) => a.at - b.at);
  }, [q, changes, t]);

  const undo = async (c: Change) => {
    setError(false);
    try {
      if (c.batch && (changes ?? []).filter((x) => x.batch === c.batch && x.status === 'applied').length > 1) await undoBatch(c.batch);
      else await decideChange(c.id, 'undo');
    } catch {
      setError(true);
    }
  };
  const when = (at: number) => (now - at < DAY ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(at).toLocaleDateString());
  const labelNames = q.labels.flatMap((l) => labels?.find((d) => d.id === l)?.name ?? []);

  return (
    <aside aria-label={t.detailKind} className="flex min-h-full flex-col gap-4 px-[18px] pb-[18px] pt-4 text-[14px]">
      <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">
          {t.detailKind} · {href ? <Link href={href} className="text-accent hover:underline"><Title text={where} /></Link> : <Title text={where} />}
        </span>
        {q.read ? (
          <button type="button" onClick={() => void updateTicket(item, q.id, { read: false })} className="inline-flex h-6 items-center gap-1 rounded-full border border-line-strong px-2.5 text-ink-2 hover:bg-sunk">
            <Mail size={12} aria-hidden /> {t.questionMarkUnread}
          </button>
        ) : null}
        <button type="button" onClick={onClose} aria-label={t.detailClose} title={t.detailClose} className="rounded-md p-1 hover:bg-sunk hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <div>
        {editing !== null ? (
          <div>
            <textarea
              autoFocus
              rows={3}
              value={editing}
              aria-label={t.editQuestion}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(null);
                }
              }}
              className="wb-field block w-full resize-none px-2 py-1.5 text-sm"
            />
            <div className="mt-1.5 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const text = editing.trim();
                  setEditing(null);
                  if (text && text !== q.text) void updateTicket(item, q.id, { text });
                }}
              >
                {t.save}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                {t.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-[16.5px] font-[560] leading-[1.4] tracking-[-0.005em]">
            {q.text || (quote ? <span className="italic text-ink-3">{quote}</span> : <span className="text-ink-3">{t.inboxNoText}</span>)}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
          {q.who ? <span title={t.inboxFromAssistant}>{t.assistantMark}</span> : null}
          {labelNames.map((l) => (
            <span key={l} className="rounded-[3px] bg-sunk px-1.5 text-ink-2">
              {l}
            </span>
          ))}
          {q.links.length ? <OutcomeIcons links={q.links} /> : null}
        </div>
        {quote && q.text ? <p className="mt-2 border-l-[3px] border-accent-soft bg-sunk px-2.5 py-1.5 text-[13px] italic text-ink-2">{quote}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <QuestionMake item={item} q={q} buttons />
        <Button size="sm" onClick={() => setAnswering(!answering)} aria-pressed={answering}>
          <Pencil size={14} aria-hidden /> {t.questionAnswerWrite}
        </Button>
        <Button size="sm" onClick={() => setEditing(q.text)}>
          <Pencil size={14} aria-hidden /> {t.editQuestion}
        </Button>
        {ai ? (
          <Button size="sm" onClick={onAsk}>
            <Sparkles size={14} aria-hidden /> {t.questionsAsk}
          </Button>
        ) : null}
      </div>
      <TagPicker size="sm" value={q.labels} onChange={(ids) => void setQuestionTags(item, q.id, ids)} />

      {q.answer || answering ? <AnswerPanel key={`${q.id}-${answering}`} item={item} q={q} /> : null}

      {waiting.length ? (
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">
            {t.detailProposals}
            {waiting.length > 1 ? (
              <button type="button" onClick={() => void acceptChanges(waiting.map((c) => c.id)).catch(() => setError(true))} className="ml-auto font-normal text-accent hover:underline">
                {t.detailAcceptAll}
              </button>
            ) : null}
          </div>
          <ProposalList changes={waiting} wide />
        </section>
      ) : null}

      <section>
        <div className="mb-1.5 text-[12.5px] font-semibold text-ink-2">{t.detailHistory}</div>
        <ul className="relative space-y-0.5 pl-3.5 text-[13px] text-ink-2 before:absolute before:bottom-1.5 before:left-[3px] before:top-1.5 before:w-px before:bg-line-strong">
          {history.map((e, i) => {
            const left = (e.change?.status === 'applied' || e.change?.status === 'rejected') && e.change.decidedAt ? UNDO_DAYS - Math.floor((now - e.change.decidedAt) / DAY) : 0;
            return (
              <li key={i} className="relative flex items-baseline gap-2 py-0.5">
                <span className={clsx('absolute -left-3.5 top-[0.6rem] size-[7px] rounded-full border-[1.5px]', e.assistant || e.change ? 'border-accent bg-accent' : 'border-line-strong bg-sheet')} aria-hidden />
                <span className="min-w-0 flex-1">
                  {e.text}
                  {e.change && e.change.feedback ? <span className="text-ink-3"> · {e.change.feedback}</span> : null}
                  {e.change && (e.change.status === 'applied' || e.change.status === 'rejected') && left > 0 ? (
                    <button type="button" onClick={() => void undo(e.change!)} className="ml-2 inline-flex items-center gap-1 text-[12px] text-accent hover:underline" title={t.histUndoLeft(left)}>
                      <Undo2 size={12} aria-hidden /> {t.inboxUndo}
                    </button>
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-[12px] text-ink-3">{when(e.at)}</span>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {t.inboxFailed}
          </p>
        ) : null}
      </section>

      <div className="mt-auto flex items-center justify-end gap-2 border-t border-line pt-3.5">
        <Button
          size="sm"
          variant="ghost"
          aria-label={t.deleteQuestion}
          title={t.deleteQuestion}
          onClick={() => {
            onClose();
            void deleteTicket(item, q.id);
          }}
        >
          <Trash2 size={15} aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            if (!q.archived) onClose();
            void updateTicket(item, q.id, { archived: !q.archived });
          }}
        >
          <Check size={14} aria-hidden /> {q.archived ? t.questionsRestore : t.questionsArchiveAction}
        </Button>
      </div>
    </aside>
  );
}

