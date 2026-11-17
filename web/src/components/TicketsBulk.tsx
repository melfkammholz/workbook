import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Layers } from 'lucide-react';
import { useState } from 'react';
import type { Ticket } from '@wb/shared';
import { linkQuestion, sendAssistantRequest, setQuestionTags, updateTicket, useAssistant } from '@/lib/api';
import { addCard, cardKeys, createDeck, useFlashcards } from '@/lib/flashcards';
import { useT } from '@/lib/i18n';
import { useTags } from '@/lib/tags';
import { ConnectAssistant } from './ConnectAssistant';
import { Button, Dialog, clsx } from './ui';

type Ask = 'answer' | 'cards' | 'assess';
const ASKS: Ask[] = ['answer', 'cards', 'assess'];

/** The place a question is read from, for the item argument the API wants. */
export const itemOf = (q: Ticket): string | null => {
  const a = q.anchor;
  return a.kind === 'page' || a.kind === 'none' || a.kind === 'material' ? null : a.kind === 'text' ? a.target : a.id;
};

/** One dialog for one question or fifty: what to ask, an optional note, and what is read. Without a helper it copies a prompt. */
export function AskDialog({ questions, onClose }: { questions: Ticket[]; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<Ask>('answer');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const helper = useAssistant().data;
  const canSend = !!helper?.allowed;
  const send = () => {
    void sendAssistantRequest({ kind, tickets: questions.map((q) => q.id), ...(note.trim() ? { note: note.trim() } : {}) }).then(() => {
      setSent(true);
      setTimeout(onClose, 700);
    });
  };
  const copy = () => {
    const lines = questions.map((q) => `- [${q.id}] ${q.text.replace(/\s+/g, ' ').trim() || '…'}`);
    void navigator.clipboard?.writeText(t.askPrompt(kind, lines, note.trim())).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.askTitle(questions.length)} width="max-w-md">
      <div role="radiogroup" className="space-y-1.5">
        {ASKS.map((k) => (
          <label key={k} className="flex cursor-pointer items-start gap-2.5 py-0.5">
            <input type="radio" name="ask-kind" checked={kind === k} onChange={() => setKind(k)} className="mt-1" />
            <span>
              <b className="font-medium">{t.askKinds[k].title}</b>
              <small className="block text-[12.5px] text-ink-3">{t.askKinds[k].body}</small>
            </span>
          </label>
        ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-label={t.askNotePlaceholder} placeholder={t.askNotePlaceholder} className="wb-field mt-3 block w-full resize-none px-2.5 py-1.5 text-[13px]" />
      <p className="mt-3 border-t border-line pt-2 text-[12.5px] text-ink-3">
        {t.askReads} <b className="font-semibold text-ink-2">{t.askChanges}</b>
      </p>
      <p className="mt-1 text-[12.5px] text-ink-3">
        {canSend ? (helper?.connected ? t.askHelperOn : t.askHelperOff) : t.askCopyHint}
        {!helper?.connected ? (
          <>
            {' '}
            <button type="button" onClick={() => setConnecting(true)} className="text-accent hover:underline">
              {t.connectOpen}
            </button>
          </>
        ) : null}
      </p>
      <ConnectAssistant open={connecting} onClose={() => setConnecting(false)} />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t.cancel}
        </Button>
        {canSend ? (
          <Button variant={helper?.connected ? 'primary' : 'secondary'} onClick={send} disabled={sent}>
            {sent ? t.askSent : t.askSend}
          </Button>
        ) : null}
        <Button variant={canSend && helper?.connected ? 'secondary' : 'primary'} onClick={copy}>
          {copied ? t.askCopied : t.askCopy}
        </Button>
      </div>
    </Dialog>
  );
}

/** What goes on a card's front: the question, or the passage it was asked about. */
const frontOf = (q: Ticket): string => {
  const a = q.anchor;
  const quote = a.kind === 'text' ? a.quote : a.kind === 'page' ? a.quote?.trim() || '' : '';
  return (q.text || quote).trim();
};

/** Tickets that can become a draft: something to put on the front, and no card made from them yet. */
const draftable = (q: Ticket) => !!frontOf(q) && !q.links.some((l) => l.kind === 'card');

/** Sticks to the bottom of the list while questions are selected. */
export function BulkBar({ picked, archive, ai, cards, onAsk, onClear }: { picked: Ticket[]; archive: boolean; ai: boolean; cards: boolean; onAsk: () => void; onClear: () => void }) {
  const t = useT();
  const labels = useTags().data ?? [];
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const decks = useFlashcards().data?.decks ?? [];
  const [deckMenu, setDeckMenu] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const todo = picked.filter(draftable);
  /** Quietly one draft per ticket, one after the other because each rewrites the deck's text. */
  const addDrafts = async (deckId: string | null, title: string) => {
    setDeckMenu(false);
    setFailed(false);
    try {
      const target = deckId ?? (await createDeck(t.defaultDeckTitle, true)).id;
      for (const q of todo) {
        const a = q.anchor;
        const r = await addCard(target, { kind: 'basic', front: frontOf(q), back: q.answer ?? '', exercise: a.kind === 'exercise' ? a.id : null, highlight: q.highlightId, anchor: a.kind === 'none' ? null : a, draft: true });
        await linkQuestion(itemOf(q), q.id, 'card', r.cardId);
      }
      void qc.invalidateQueries({ queryKey: cardKeys.all });
      setDone(t.draftsAdded(todo.length, title));
      setTimeout(() => setDone(null), 4000);
    } catch {
      setFailed(true);
    }
  };
  const toggleLabel = (id: string) => {
    const all = picked.every((q) => q.labels.includes(id));
    for (const q of picked) {
      const has = q.labels.includes(id);
      if (all ? has : !has) void setQuestionTags(itemOf(q), q.id, all ? q.labels.filter((l) => l !== id) : [...q.labels, id]);
    }
  };
  const btn = 'inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-white/30 px-2.5 text-[13.5px] hover:bg-white/10 dark:border-line-strong dark:hover:bg-sheet';
  return (
    <div role="toolbar" aria-label={t.ticketsSelected(picked.length)} className="sticky bottom-3 z-10 mt-3 flex flex-wrap items-center gap-2.5 rounded-[10px] bg-ink px-3.5 py-2 text-[13.5px] text-paper shadow-[var(--shadow)] dark:border dark:border-line-strong dark:bg-sunk dark:text-ink">
      <b className="font-semibold">{t.ticketsSelected(picked.length)}</b>
      {ai ? (
        <button type="button" onClick={onAsk} className="inline-flex h-[30px] items-center rounded-lg bg-accent px-2.5 font-medium text-accent-ink hover:brightness-110">
          {t.ticketsAsk}
        </button>
      ) : null}
      {cards && todo.length ? (
        <Popover.Root open={deckMenu} onOpenChange={setDeckMenu}>
          <Popover.Trigger asChild>
            <button type="button" className={btn}>
              <Layers size={14} aria-hidden /> {t.ticketsDrafts(todo.length)} ▾
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="start" sideOffset={6} aria-label={t.ticketsDraftsInto} className="wb-menu max-h-64 w-60 overflow-y-auto p-1">
              <div className="px-2.5 py-1 text-[12px] text-ink-3">{t.ticketsDraftsInto}</div>
              {decks.length ? (
                decks.map((d) => (
                  <button key={d.id} type="button" onClick={() => void addDrafts(d.id, d.title)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-sunk">
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    <span className="text-[12px] text-ink-3">{t.deckCounts(d.cards)}</span>
                  </button>
                ))
              ) : (
                <button type="button" onClick={() => void addDrafts(null, t.defaultDeckTitle)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-sunk">
                  {t.defaultDeckTitle}
                </button>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
      {done ? <span role="status" className="text-[13px]">{done}</span> : null}
      {failed ? <span role="alert" className="text-[13px]">{t.inboxFailed}</span> : null}
      {archive ? null : (
        <button type="button" className={btn} onClick={() => { for (const q of picked) if (!q.read) void updateTicket(itemOf(q), q.id, { read: true }); }}>
          {t.ticketsMarkRead}
        </button>
      )}
      <button type="button" className={btn} onClick={() => { for (const q of picked) void updateTicket(itemOf(q), q.id, { archived: !archive }); onClear(); }}>
        {archive ? t.ticketsRestore : t.ticketsArchiveAction}
      </button>
      {labels.length ? (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button type="button" className={btn}>
              {t.ticketsLabelAction} ▾
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="start" sideOffset={6} aria-label={t.ticketsLabelAction} className="wb-menu max-h-64 w-56 overflow-y-auto p-1">
              {labels.map((l) => {
                const on = picked.every((q) => q.labels.includes(l.id));
                return (
                  <button key={l.id} type="button" onClick={() => toggleLabel(l.id)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-sunk">
                    <span className={clsx('grid size-4 place-items-center rounded border', on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>{on ? <Check size={11} /> : null}</span>
                    {l.name}
                  </button>
                );
              })}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
      <span className="flex-1" />
      <button type="button" className={btn} onClick={onClear}>
        {t.ticketsClearSelection}
      </button>
    </div>
  );
}
