import * as Popover from '@radix-ui/react-popover';
import { Check, Pencil, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { QUESTION_KINDS, type CardPayload, type Change, type MergePayload, type WorkPayload, type ChangeValue as Val, type HighlightPayload, type QuestionKind, type QuestionPayload } from '@wb/shared';
import { acceptChanges, decideChange, useQuestions } from '@/lib/api';
import { cardText, previewDeck, useFlashcards } from '@/lib/flashcards';
import { useT } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/useActiveTime';
import { CardFace } from './CardFace';
import { CardForm, ROOMY, useCardLayout } from './CardForm';
import { QuestionCard } from './Questions';
import { AnswerEditor, RenderedAnswer } from './QuestionAnswer';
import { TypstEditor } from './TypstEditor';
import { Button, Dialog, clsx } from './ui';

export type Value = Val;

/** How a proposal's field and values read to the student. */
export function useChangeText() {
  const t = useT();
  const kindName = (k: Value) => (typeof k === 'string' && (QUESTION_KINDS as readonly string[]).includes(k) ? t.questionKinds[k as QuestionKind] : t.inboxNone);
  const show = (c: Change, v: Value) => (c.field === 'work' ? workSummary(v) : c.field === 'merge' ? mergeSummary(v, t.inboxMergeCount) : c.field === 'create' ? createSummary(v) : c.field === 'kind' ? kindName(v) : c.field === 'labels' ? (Array.isArray(v) && v.length ? v.join(', ') : t.inboxNone) : typeof v === 'string' ? v : t.inboxNone);
  const fieldName = (c: Change) => (c.field === 'work' ? t.inboxFieldWork : c.field === 'merge' ? t.inboxFieldMerge : c.field === 'create' ? t.inboxCreate[c.ref.kind as 'card' | 'highlight' | 'question'] : c.field === 'kind' ? t.inboxFieldKind : c.field === 'labels' ? t.inboxFieldLabels : c.field === 'text' ? t.inboxFieldText : t.inboxFieldAnswer);
  return { show, fieldName };
}

function workSummary(v: Value): string {
  const p = v as Partial<WorkPayload> | null;
  return p && typeof p === 'object' ? [p.authors, p.year, p.title].filter(Boolean).join(', ') : '';
}

function mergeSummary(v: Value, count: (n: number) => string): string {
  const p = v as Partial<MergePayload> | null;
  return p && typeof p === 'object' && Array.isArray(p.duplicates) ? count(p.duplicates.length) : '';
}

/** One line for a proposal that makes something. */
function createSummary(v: Value): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  const p = v as Partial<CardPayload & HighlightPayload & QuestionPayload>;
  return (p.front ?? p.quote ?? p.text ?? '').replace(/\s+/g, ' ').slice(0, 120);
}

/** A card proposal rendered as the student will see it: its front and back, in the deck's look. */
function CardPreview({ v }: { v: Partial<CardPayload> }) {
  const kind = v.cardKind ?? 'basic';
  const source = cardText(kind, v.front ?? '', v.back ?? '');
  const r = useQuery({ queryKey: ['card-proposal-preview', source], queryFn: () => previewDeck(source), staleTime: Infinity, gcTime: 600_000, retry: false });
  const card = r.data?.cards[0];
  if (!card || !r.data) return <p className="whitespace-pre-wrap break-words">{v.front}</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-sheet">
      <CardFace html={card.front} css={r.data.css} gap={kind === 'cloze' ? 1 : null} revealed={kind === 'cloze'} className="px-3 py-2" />
      {kind === 'cloze' || kind === 'quiz' ? null : <CardFace html={card.back} css={r.data.css} gap={null} revealed className="border-t border-line bg-paper px-3 py-2" />}
    </div>
  );
}

/** What a proposal would make, read out. */
function CreateView({ c }: { c: Change }) {
  const t = useT();
  const v = c.after as Partial<CardPayload & HighlightPayload & QuestionPayload>;
  const deck = useFlashcards().data?.decks;
  if (c.ref.kind === 'card') {
    const name = v.deck ? ('id' in v.deck ? (deck?.find((d) => d.id === (v.deck as { id: string }).id)?.title ?? '') : v.deck.title) : '';
    return (
      <div className="mt-0.5 space-y-1.5">
        <p className="text-[12.5px] text-ink-3">
          {t.inboxCreateDeck}: {name}
        </p>
        <CardPreview v={v} />
      </div>
    );
  }
  if (c.ref.kind === 'highlight')
    return (
      <div className="mt-0.5 space-y-1">
        <p className="text-[12.5px] text-ink-3">{t.inboxPageOf((v.pageIndex ?? 0) + 1)}</p>
        <p className="whitespace-pre-wrap break-words border-l-2 border-line pl-2 text-ink-2">{v.quote}</p>
        {v.note ? <RenderedAnswer source={v.note} /> : null}
      </div>
    );
  return (
    <div className="mt-0.5 space-y-1">
      <p className="whitespace-pre-wrap break-words">{v.text}</p>
      <p className="text-[12.5px] text-ink-3">{t.inboxFromAssistant}</p>
    </div>
  );
}

/** Edits a proposed page note or question in the place the student would write one; a card has its own dialog. */
function CreateEditor({ c, value, onChange }: { c: Change; value: Value; onChange: (v: Value) => void }) {
  const t = useT();
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Partial<CardPayload & HighlightPayload & QuestionPayload>;
  const set = (patch: object) => onChange({ ...v, ...patch } as Value);
  if (c.ref.kind === 'highlight')
    return (
      <div className="mt-1 space-y-2">
        <label className="block">
          <span className="text-[12.5px] text-ink-3">{t.inboxQuote}</span>
          <textarea rows={2} value={v.quote ?? ''} onChange={(e) => set({ quote: e.target.value })} className="wb-field w-full px-2 py-1 text-sm" />
        </label>
        <div>
          <span className="text-[12.5px] text-ink-3">{t.pdfPageNote}</span>
          <div className="mt-0.5 h-64 overflow-hidden rounded-md border border-line">
            <TypstEditor compact="switch" variant="notes" value={v.note ?? ''} onChange={(note) => set({ note })} label={t.pdfPageNote} placeholder={t.pdfPageNotePlaceholder} status="" />
          </div>
        </div>
      </div>
    );
  return (
    <QuestionCard context={t.inboxFromAssistant} className="mt-1">
      <textarea rows={3} value={v.text ?? ''} onChange={(e) => set({ text: e.target.value })} aria-label={t.questionInput} className="block w-full resize-none wb-field px-2.5 py-1.5 text-sm" />
    </QuestionCard>
  );
}

/** Whether accepting this proposal is edited in the card dialog instead of in place. */
export const isCardProposal = (c: Change) => c.field === 'create' && c.ref.kind === 'card';

/** A proposed card in the same form the student writes cards in (kind, tags, cloze, preview), with the deck to put it in; saving accepts it. */
export function CardProposalDialog({ c, onAccept, onClose }: { c: Change; onAccept: (after: Value) => Promise<unknown>; onClose: () => void }) {
  const t = useT();
  const v = c.after as CardPayload;
  const decks = useFlashcards().data?.decks ?? [];
  const [layout] = useCardLayout();
  const roomy = useMediaQuery(ROOMY);
  const [deck, setDeck] = useState<{ id: string } | { title: string }>(v.deck);
  const byTitle = 'title' in deck ? decks.find((d) => d.title.toLowerCase() === deck.title.trim().toLowerCase()) : undefined;
  const picked = 'id' in deck ? deck.id : (byTitle?.id ?? '');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.inboxCreate.card} description={t.inboxCardEditHint} width={layout === 'side' && roomy ? 'max-w-5xl' : 'max-w-xl'}>
      <CardForm
        initial={{ kind: v.cardKind, front: v.front, back: v.back, tags: v.tags ?? [], anchor: v.anchor }}
        autoFocus
        submitLabel={t.inboxAccept}
        onCancel={onClose}
        onSubmit={async (f) => {
          await onAccept({ deck: picked ? { id: picked } : deck, cardKind: f.kind, front: f.front, back: f.back, anchor: f.anchor ?? null, tags: f.tags } satisfies CardPayload);
          onClose();
        }}
        footer={
          <div className="block min-w-0 flex-1">
            <span className="text-sm font-medium">{t.intoDeck}</span>
            <select value={picked} onChange={(e) => setDeck(e.target.value ? { id: e.target.value } : { title: 'title' in deck ? deck.title : '' })} className="mt-1 block h-8.5 w-full wb-field px-2">
              <option value="">{t.inboxNewDeck}</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({t.deckCounts(d.cards)})
                </option>
              ))}
            </select>
            {!picked ? <input value={'title' in deck ? deck.title : ''} onChange={(e) => setDeck({ title: e.target.value })} placeholder={t.inboxDeckTitle} aria-label={t.inboxDeckTitle} className="wb-field mt-1 w-full px-2 py-1 text-sm" /> : null}
          </div>
        }
      />
    </Dialog>
  );
}

/** The fields a reference would get. */
function WorkView({ c }: { c: Change }) {
  const t = useT();
  const p = c.after as WorkPayload;
  const rows: [string, string][] = [
    [t.inboxWorkTitle, p.title],
    [t.inboxWorkAuthors, p.authors],
    [t.inboxWorkYear, p.year === null ? '' : String(p.year)],
    [t.inboxWorkVenue, p.venue],
  ];
  return (
    <dl className="mt-0.5 space-y-0.5">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-24 shrink-0 text-[12.5px] text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function WorkEditor({ value, onChange }: { value: Value; onChange: (v: Value) => void }) {
  const t = useT();
  const p = (value && typeof value === 'object' && !Array.isArray(value) ? value : { title: '', authors: '', year: null, venue: '' }) as WorkPayload;
  const field = (label: string, key: 'title' | 'authors' | 'venue') => (
    <label className="mt-1 block">
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <input value={p[key]} onChange={(e) => onChange({ ...p, [key]: e.target.value })} className="wb-field w-full px-2 py-1 text-sm" />
    </label>
  );
  return (
    <div>
      {field(t.inboxWorkTitle, 'title')}
      {field(t.inboxWorkAuthors, 'authors')}
      <label className="mt-1 block">
        <span className="text-[12.5px] text-ink-3">{t.inboxWorkYear}</span>
        <input inputMode="numeric" value={p.year ?? ''} onChange={(e) => onChange({ ...p, year: /^\d{4}$/.test(e.target.value.trim()) ? Number(e.target.value) : null })} className="wb-field w-24 px-2 py-1 text-sm" />
      </label>
      {field(t.inboxWorkVenue, 'venue')}
    </div>
  );
}

/** The duplicates that would close, with the wording the survivor would get. */
function MergeView({ c }: { c: Change }) {
  const t = useT();
  const all = useQuestions().data;
  const p = c.after as MergePayload;
  const text = (id: string) => all?.find((q) => q.id === id)?.text || t.inboxNoText;
  const survivor = all?.find((q) => q.id === c.ref.id);
  return (
    <div className="mt-0.5 space-y-1">
      {p.text && survivor && p.text !== survivor.text ? (
        <>
          <p className="whitespace-pre-wrap break-words text-ink-3 line-through decoration-ink-3/50">{survivor.text}</p>
          <p className="whitespace-pre-wrap break-words">{p.text}</p>
        </>
      ) : null}
      <p className="text-[12.5px] text-ink-3">{t.inboxMergeClose}</p>
      <ul className="space-y-0.5">
        {p.duplicates.map((id) => (
          <li key={id} className="whitespace-pre-wrap break-words border-l-2 border-line pl-2 text-ink-2">
            {text(id)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The input to change what is proposed before accepting it. */
export function ChangeEditor({ c, value, onChange }: { c: Change; value: Value; onChange: (v: Value) => void }) {
  const t = useT();
  const { fieldName } = useChangeText();
  if (c.field === 'work') return <WorkEditor value={value} onChange={onChange} />;
  if (c.field === 'create') return <CreateEditor c={c} value={value} onChange={onChange} />;
  if (c.field === 'merge') {
    const p = value as MergePayload;
    return <textarea rows={3} value={p.text ?? ''} onChange={(e) => onChange({ ...p, text: e.target.value })} placeholder={t.inboxMergeKeepText} aria-label={t.inboxMergeKeepText} className="wb-field w-full px-2 py-1 text-sm" />;
  }
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
  if (c.field === 'answer') return <AnswerEditor value={typeof value === 'string' ? value : ''} onChange={onChange} height="h-48" />;
  return <textarea rows={4} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} aria-label={fieldName(c)} className="wb-field w-full px-2 py-1 text-sm" />;
}

/** What a proposal would change: old and new for wording, type and labels; the answer alone. */
export function ChangeValue({ c }: { c: Change }) {
  const t = useT();
  const { show } = useChangeText();
  if (c.field === 'work') return <WorkView c={c} />;
  if (c.field === 'create') return <CreateView c={c} />;
  if (c.field === 'merge') return <MergeView c={c} />;
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
        <div className="mt-0.5">
          <RenderedAnswer source={typeof c.after === 'string' ? c.after : ''} />
        </div>
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
  const [cardFor, setCardFor] = useState<Change | null>(null);
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
    <>
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
                    <Button size="sm" variant="ghost" onClick={() => (isCardProposal(c) ? setCardFor(c) : setEdit(editing ? null : { id: c.id, value: c.after }))} aria-pressed={editing} title={t.inboxEdit}>
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
    {cardFor ? <CardProposalDialog c={cardFor} onClose={() => setCardFor(null)} onAccept={(after) => decideChange(cardFor.id, 'accept', { after })} /> : null}
    </>
  );
}
