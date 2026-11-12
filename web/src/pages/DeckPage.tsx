import { EditorSelection, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeckCard, DeckDoc, DeckSaved, DeckSettings, DeckWarning, Diagnostic, RenderedCard } from '@wb/shared';
import { ArrowDown, ArrowUp, Check, CircleHelp, Copy, Download, ExternalLink, GripVertical, Pencil, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CHATS } from '@/components/AiPanel';
import { CardFace } from '@/components/CardFace';
import { CardForm } from '@/components/CardForm';
import { ConfirmDialog } from '@/components/Dialogs';
import { MoreMenu } from '@/components/ExerciseView';
import { TypstEditor } from '@/components/TypstEditor';
import { Button, Dialog, Empty, IconButton, Segmented, Spinner, clsx } from '@/components/ui';
import { useSettings } from '@/lib/api';
import { showAnnotationOnArrival } from '@/lib/annotations';
import { Title } from '@/components/Title';
import { addCard, cardKeys, deckPrompt, deleteCard, downloadDeck, deleteDeck, editCard, moveCardBy, moveCardTo, previewDeck, saveDeckSource, updateDeck, useDeck, useFlashcards } from '@/lib/flashcards';
import { useLang, useT } from '@/lib/i18n';
import { readPref, writePref } from '@/lib/shell';
import { useDebouncedCallback } from '@/lib/useDebounced';
import { cursorCard } from '@/lib/currentCard';
import { BackLink } from '@/lib/history';
import { usePageKeys } from '@/lib/keys';
import { tagLabel } from '@/lib/typstContext';

const VIEWS = ['cards', 'text'] as const;
type View = (typeof VIEWS)[number];
const VIEW_KEY = 'wb-deck-view';

export function DeckPage({ id, card }: { id: string; card?: string }) {
  const t = useT();
  const deck = useDeck(id);
  if (deck.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!deck.data) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.deckNotFound}>
          <Link href="/flashcards" className="text-accent hover:underline">
            {t.backToDecks}
          </Link>
        </Empty>
      </div>
    );
  }
  return <DeckEditor key={id} deck={deck.data} focusCard={card ?? null} />;
}

/**
 * A deck is its text. The card view edits that text one card at a time, so the
 * quick way, the card view and the text never drift apart.
 */
function DeckEditor({ deck, focusCard }: { deck: DeckDoc; focusCard: string | null }) {
  const t = useT();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const aiOn = !!useSettings().data?.showAi;
  const [view, setViewState] = useState<View>(() => readPref(VIEW_KEY, VIEWS, 'cards'));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [checking, setChecking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const setView = (v: View) => {
    setViewState(v);
    writePref(VIEW_KEY, v);
  };
  const cache = useCallback((patch: Partial<DeckDoc>) => qc.setQueryData<DeckDoc>(cardKeys.deck(deck.id), (d) => (d ? { ...d, ...patch } : d)), [qc, deck.id]);
  const saved = useCallback(
    (r: DeckSaved) => {
      cache({ source: r.source, cards: r.cards });
      void qc.invalidateQueries({ queryKey: cardKeys.list });
    },
    [cache, qc],
  );

  const rename = async (title: string) => {
    setRenaming(false);
    if (!title || title === deck.title) return;
    cache(await updateDeck(deck.id, { title }));
    void qc.invalidateQueries({ queryKey: cardKeys.list });
  };

  const big = deck.settings.maxCards > 0 && deck.cards.length > deck.settings.maxCards;
  usePageKeys({ t: () => setView(view === 'cards' ? 'text' : 'cards') });

  return (
    <div className="wb-page wb-page-fill flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <BackLink fallback="/flashcards" label={t.back} />
          {renaming ? (
            <input
              autoFocus
              defaultValue={deck.title}
              maxLength={200}
              aria-label={t.deckTitle}
              onBlur={(e) => void rename(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="h-8 min-w-0 rounded-md border border-accent bg-paper px-2 text-lg font-semibold tracking-tight focus:outline-none"
            />
          ) : (
            <>
              <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">{deck.title}</h1>
              <IconButton label={t.rename} onClick={() => setRenaming(true)}>
                <Pencil size={15} />
              </IconButton>
            </>
          )}
          <span className="text-[13px] text-ink-3">{t.deckCounts(deck.cards.length)}</span>
          <div className="ml-auto flex items-center gap-2">
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                ['cards', t.viewCards],
                ['text', t.viewText],
              ]}
            />
            <Link href="/help/flashcards" className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink" aria-label={t.syntaxTitle} title={t.syntaxTitle}>
              <CircleHelp size={16} />
            </Link>
            <IconButton label={t.deckSettings} title={t.deckSettings} aria-expanded={settingsOpen} aria-controls="wb-deck-panel" onClick={() => setSettingsOpen(!settingsOpen)} className={clsx(settingsOpen && 'bg-sunk text-ink')}>
              <Settings2 size={16} />
            </IconButton>
            <MoreMenu
              items={[
                ...(aiOn ? [{ icon: Sparkles, label: t.checkDeckWithAi, onClick: () => setChecking(true) }] : []),
                { icon: Download, label: t.downloadDeck, onClick: () => downloadDeck(deck.title, deck.source) },
                { icon: Trash2, label: t.deleteDeck, onClick: () => setConfirmDelete(true) },
              ]}
            />
            <Button size="sm" variant="primary" onClick={() => navigate(`/flashcards/review/${deck.id}`)}>
              {t.reviewDeck}
            </Button>
          </div>
        </div>
        {settingsOpen ? (
          <div id="wb-deck-panel" className="settle mt-3 max-h-[45vh] overflow-y-auto rounded-lg border border-line bg-paper px-4 py-3 text-sm">
            <SettingsForm deck={deck} onChange={async (s) => cache(await updateDeck(deck.id, { settings: s }))} />
          </div>
        ) : null}
        {big ? <p className="mt-2 text-[13px] text-review">{t.deckIsBig(deck.cards.length, deck.settings.maxCards)}</p> : null}
      </div>

      <div className="min-h-0 flex-1">
        {view === 'cards' ? <CardList deck={deck} focusCard={focusCard} onSaved={saved} /> : <TextView deck={deck} focusCard={focusCard} onSaved={saved} />}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t.confirmDeleteDeck(deck.title)}
        confirmLabel={t.deleteDeck}
        onConfirm={() => {
          void deleteDeck(deck.id).then(() => {
            // Gone: nothing may ask for it again on the way out.
            qc.removeQueries({ queryKey: cardKeys.deck(deck.id) });
            navigate('/flashcards');
            void qc.invalidateQueries({ queryKey: cardKeys.list });
          });
        }}
      >
        {t.deleteDeckBody}
      </ConfirmDialog>
      {aiOn ? <CheckDeckDialog open={checking} onClose={() => setChecking(false)} deckId={deck.id} /> : null}
    </div>
  );
}

// ───────────────────────── cards ─────────────────────────

/** The deck as cards. Each change rewrites only that card's text. */
function CardList({ deck, focusCard, onSaved }: { deck: DeckDoc; focusCard: string | null; onSaved: (r: DeckSaved) => void }) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(focusCard);
  const [adding, setAdding] = useState(deck.cards.length === 0);
  const rendered = useQuery({ queryKey: ['flashcards', 'preview', deck.source], queryFn: () => previewDeck(deck.source), staleTime: Infinity, placeholderData: (p) => p });
  const byId = useMemo(() => new Map((rendered.data?.cards ?? []).map((c) => [c.id, c])), [rendered.data]);
  const warnings = rendered.data?.warnings ?? [];
  usePageKeys({
    n: () => {
      setEditing(null);
      setAdding(true);
      requestAnimationFrame(() => document.getElementById('wb-new-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    },
  });

  useEffect(() => {
    if (!focusCard) return;
    requestAnimationFrame(() => document.getElementById(`card-${focusCard}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }, [focusCard]);

  /** A card being dragged by its handle, and where it would land: before the card at that index. */
  const [drag, setDrag] = useState<{ id: string; from: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-5 sm:px-6">
        <ol className="space-y-3" onDragOver={(e) => drag && e.preventDefault()}>
          {deck.cards.map((c, i) =>
            c.id && editing === c.id ? (
              <li key={c.id} id={`card-${c.id}`} className="rounded-xl border border-accent bg-sheet p-4">
                <CardForm
                  autoFocus
                  initial={c}
                  submitLabel={t.save}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (f) => {
                    onSaved(await editCard(deck.id, c.id!, f));
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <CardRow
                key={c.id ?? i}
                card={c}
                rendered={c.id ? byId.get(c.id) : undefined}
                css={rendered.data?.css ?? ''}
                warnings={warnings.filter((w) => w.line === c.line)}
                first={i === 0}
                last={i === deck.cards.length - 1}
                onEdit={() => setEditing(c.id)}
                onMove={async (d) => onSaved(await moveCardBy(deck.id, c.id!, d))}
                drop={over === i ? 'before' : over === i + 1 && i === deck.cards.length - 1 ? 'after' : null}
                dragging={drag?.id === c.id}
                onDragStart={() => c.id && setDrag({ id: c.id, from: i })}
                onDragOver={(after) => drag && setOver(after ? i + 1 : i)}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                onDrop={async () => {
                  if (!drag || over === null) return;
                  // Dropped below itself: one place less, since it leaves its own place first.
                  const to = over > drag.from ? over - 1 : over;
                  setDrag(null);
                  setOver(null);
                  if (to !== drag.from) onSaved(await moveCardTo(deck.id, drag.id, to));
                }}
                onDelete={async () => onSaved(await deleteCard(deck.id, c.id!))}
              />
            ),
          )}
        </ol>
        <div className="mt-4">
          {adding ? (
            <div id="wb-new-card" className="rounded-xl border border-line bg-sheet p-4">
              <CardForm
                autoFocus={deck.cards.length > 0}
                submitLabel={t.addCard}
                onCancel={deck.cards.length ? () => setAdding(false) : undefined}
                onSubmit={async (f) => onSaved(await addCard(deck.id, { ...f, exercise: null }))}
              />
            </div>
          ) : (
            <Button onClick={() => setAdding(true)} title={`${t.addCard} (n)`}>
              <Plus size={15} /> {t.addCard}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CardRow({
  card,
  rendered,
  css,
  warnings,
  first,
  last,
  onEdit,
  onMove,
  onDelete,
  drop,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  card: DeckCard;
  rendered: RenderedCard | undefined;
  css: string;
  warnings: DeckWarning[];
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (d: -1 | 1) => Promise<void>;
  /** Where a dragged card would land, relative to this one. */
  drop: 'before' | 'after' | null;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onDelete: () => Promise<void>;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [armed, setArmed] = useState(false);
  // A cloze and a quiz are one side: they take the whole width.
  const oneSide = card.kind === 'cloze' || card.kind === 'quiz';
  return (
    <li
      id={card.id ? `card-${card.id}` : undefined}
      // Only the handle starts a drag, so text in the card can still be selected.
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={() => {
        setArmed(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(e.clientY > r.top + r.height / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={clsx(
        'group relative rounded-xl border border-line bg-sheet transition-opacity',
        dragging && 'opacity-40',
        drop === 'before' && 'before:absolute before:inset-x-2 before:-top-2 before:h-0.5 before:rounded-full before:bg-accent',
        drop === 'after' && 'after:absolute after:inset-x-2 after:-bottom-2 after:h-0.5 after:rounded-full after:bg-accent',
      )}
    >
      <div className="overflow-hidden rounded-xl">
      <div className={clsx('grid', !oneSide && 'sm:grid-cols-2')}>
        <div className="wb-show-gaps min-w-0 px-4 py-3">{rendered ? <CardFace html={rendered.front} css={css} gap={null} revealed /> : <pre className="whitespace-pre-wrap font-mono text-[13px]">{card.front}</pre>}</div>
        {!oneSide ? (
          <div className="min-w-0 border-t border-line bg-paper px-4 py-3 sm:border-l sm:border-t-0">
            {rendered ? <CardFace html={rendered.back} css={css} gap={null} revealed /> : <pre className="whitespace-pre-wrap font-mono text-[13px]">{card.back}</pre>}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-1.5 text-[12.5px] text-ink-3">
        {card.id ? (
          <span
            aria-hidden
            title={t.dragCard}
            onPointerDown={() => setArmed(true)}
            onPointerUp={() => setArmed(false)}
            className="-ml-1 grid size-6 cursor-grab place-items-center rounded text-ink-3 hover:bg-sunk hover:text-ink active:cursor-grabbing"
          >
            <GripVertical size={14} />
          </span>
        ) : null}
        {card.kind === 'both' ? <span>{t.cardKind.both}</span> : null}
        {card.origin ? (
          card.origin.href ? (
            <a href={card.origin.href} className="text-accent hover:underline">
              {t.cardFrom} <Title text={card.origin.title} />
            </a>
          ) : (
            <span>
              {t.cardFrom} <Title text={card.origin.title} /> · {card.origin.courseTitle}
            </span>
          )
        ) : null}
        {card.highlightInfo ? (
          card.highlightInfo.href ? (
            <a href={card.highlightInfo.href} onClick={() => showAnnotationOnArrival(card.highlightInfo!.id)} className="max-w-full truncate text-accent hover:underline">
              “{card.highlightInfo.quote.trim().slice(0, 60)}”
            </a>
          ) : (
            <span className="max-w-full truncate">
              “{card.highlightInfo.quote.trim().slice(0, 60)}” · {card.highlightInfo.courseTitle}
            </span>
          )
        ) : null}
        {card.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-sunk px-2 py-0.5">
            {tagLabel(tag)}
          </span>
        ))}
        {warnings.map((w, i) => (
          <span key={i} className="text-review">
            {t.deckWarning(w.code, w.detail)}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-0.5">
          {confirming ? (
            <>
              <span className="mr-1">{t.deleteCardQuestion}</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {t.cancel}
              </Button>
              <Button size="sm" onClick={() => void onDelete()}>
                {t.deleteCard}
              </Button>
            </>
          ) : (
            <>
              <IconButton label={t.moveUp} disabled={first} onClick={() => void onMove(-1)} className="size-7">
                <ArrowUp size={14} />
              </IconButton>
              <IconButton label={t.moveDown} disabled={last} onClick={() => void onMove(1)} className="size-7">
                <ArrowDown size={14} />
              </IconButton>
              <IconButton label={t.deleteCard} onClick={() => setConfirming(true)} className="size-7">
                <Trash2 size={14} />
              </IconButton>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                <Pencil size={13} /> {t.editCard}
              </Button>
            </>
          )}
        </span>
      </div>
      </div>
    </li>
  );
}

// ───────────────────────── text ─────────────────────────

function TextView({ deck, focusCard, onSaved }: { deck: DeckDoc; focusCard: string | null; onSaved: (r: DeckSaved) => void }) {
  const t = useT();
  const [text, setText] = useState(deck.source);
  const [warnings, setWarnings] = useState<DeckWarning[]>([]);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const view = useRef<EditorView | null>(null);
  // Typed here and not saved yet: then the text here is newer than the deck's.
  const dirty = useRef(false);
  const adopted = useRef<string | null>(null);

  const persist = useDebouncedCallback((value: string) => {
    setSaved('saving');
    saveDeckSource(deck.id, value).then(
      (r) => {
        setSaved('saved');
        setWarnings(r.warnings);
        if (view.current?.state.doc.toString() === value) dirty.current = false;
        onSaved(r);
        // New cards got their ids, written in where they belong: not an edit to undo.
        // If the text changed meanwhile, the next save hands them out again.
        const v = view.current;
        if (r.edits.length && v && v.state.doc.toString() === value) {
          v.dispatch({ changes: r.edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })), annotations: Transaction.addToHistory.of(false) });
        }
      },
      () => setSaved('error'),
    );
  }, 700);

  // Cards added elsewhere (the quick way, the card view) show up here, unless something typed here is still on its way.
  useEffect(() => {
    if (dirty.current || deck.source === text) return;
    adopted.current = deck.source;
    setText(deck.source);
    // Only when the deck changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.source]);

  // The card the cursor is in is marked in the preview, also after each new render.
  const [cardIndex, setCardIndex] = useState<number | null>(null);
  const cardExtension = useMemo(() => cursorCard(setCardIndex), []);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    let marked: Element | null = null;
    const mark = (scroll: boolean) => {
      const cards = root.querySelectorAll('.prose-deck aside[data-wb="card"]');
      const card = cardIndex === null ? null : (cards[cardIndex] ?? null);
      if (card === marked && card?.classList.contains('wb-current-card')) return;
      root.querySelectorAll('.wb-current-card').forEach((el) => el.classList.remove('wb-current-card'));
      card?.classList.add('wb-current-card');
      if (card && scroll) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      marked = card;
    };
    mark(true);
    const observer = new MutationObserver(() => mark(false));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [cardIndex]);

  const render = useCallback(
    (source: string) =>
      previewDeck(source).then((p) => {
        setWarnings(p.warnings);
        return p;
      }),
    [],
  );

  const diagnostics = useMemo<Diagnostic[]>(
    () => warnings.map((w) => ({ severity: 'warning', file: '', line: w.line, column: w.column, endLine: w.line, endColumn: w.column + 6, code: null, message: t.deckWarning(w.code, w.detail) })),
    [warnings, t],
  );

  // "Edit" on a card in a review: the cursor goes to that card.
  const onView = useCallback(
    (v: EditorView | null) => {
      view.current = v;
      const line = focusCard ? deck.cards.find((c) => c.id === focusCard)?.line : undefined;
      if (!v || !line) return;
      requestAnimationFrame(() => {
        const at = v.state.doc.line(Math.min(line, v.state.doc.lines)).from;
        v.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: 'center' }) });
        v.focus();
      });
    },
    // Only where the editor starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div ref={wrap} className="h-full">
      <TypstEditor
        variant="notes"
        value={text}
        onChange={(v) => {
          setText(v);
          if (v === adopted.current) return;
          adopted.current = null;
          dirty.current = true;
          persist.call(v);
        }}
        extensions={cardExtension}
        label={t.deckEditor}
        placeholder={t.deckPlaceholder}
        status={saved === 'saving' ? t.saving : saved === 'saved' ? t.saved : saved === 'error' ? t.couldNotSave : ''}
        render={render}
        diagnostics={diagnostics}
        onView={onView}
        previewClassName="prose-deck"
        previewHeader={
          warnings.length ? (
            <details className="mb-3 rounded-md bg-review-soft px-3 py-2 text-[13px] text-review">
              <summary className="cursor-pointer font-medium">{t.deckWarningsCount(warnings.length)}</summary>
              <ul className="mt-1">
                {warnings.map((w, i) => (
                  <li key={i}>
                    {t.lineN(w.line)}
                    {t.deckWarning(w.code, w.detail)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null
        }
      />
    </div>
  );
}

// ───────────────────────── settings ─────────────────────────

function SettingsForm({ deck, onChange }: { deck: DeckDoc; onChange: (s: Partial<DeckSettings>) => void }) {
  const t = useT();
  const lang = useLang();
  const courses = useFlashcards().data?.courses ?? [];
  const s = deck.settings;
  const [retention, setRetention] = useState(Math.round(s.retention * 100));
  const [readyBy, setReadyBy] = useState(s.readyBy ?? '');
  const input = 'h-8 wb-field px-2 text-sm';
  const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  const setDate = (d: string) => {
    setReadyBy(d);
    onChange({ readyBy: d || null });
  };
  const titleOf = (id: string) => courses.find((c) => c.id === id)?.title ?? id;

  return (
    <div className="grid max-w-3xl gap-x-6 gap-y-4 sm:grid-cols-2">
      <label className="block">
        <span className="block font-medium">
          {t.retention}: {retention} %
        </span>
        <input
          type="range"
          min={85}
          max={95}
          value={retention}
          onChange={(e) => setRetention(Number(e.target.value))}
          onPointerUp={() => onChange({ retention: retention / 100 })}
          onKeyUp={() => onChange({ retention: retention / 100 })}
          className="mt-2 w-full wb-range"
        />
        <span className="mt-1 block text-[12.5px] text-ink-3">{t.retentionHint}</span>
      </label>
      <div className="flex gap-6">
        <label className="block">
          <span className="block font-medium">{t.newPerDay}</span>
          <input type="number" min={0} max={500} defaultValue={s.newPerDay} onBlur={(e) => onChange({ newPerDay: clamp(e.target.value, 500) })} className={`${input} mt-1 w-24`} />
          <span className="mt-1 block text-[12.5px] text-ink-3">{t.newPerDayHint}</span>
        </label>
        <label className="block">
          <span className="block font-medium">{t.maxCards}</span>
          <input type="number" min={0} max={10000} defaultValue={s.maxCards} onBlur={(e) => onChange({ maxCards: clamp(e.target.value, 10000) })} className={`${input} mt-1 w-24`} />
          <span className="mt-1 block text-[12.5px] text-ink-3">{t.maxCardsHint}</span>
        </label>
      </div>
      <div>
        <label className="block">
          <span className="block font-medium">{t.readyBy}</span>
          <input type="date" value={readyBy} onChange={(e) => setDate(e.target.value)} className={`${input} mt-1`} />
        </label>
        <span className="mt-1 block text-[12.5px] text-ink-3">{t.readyByHint}</span>
        {deck.exams.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {deck.exams.map((e) => (
              <button
                key={`${e.courseTitle}${e.date}`}
                type="button"
                onClick={() => setDate(e.date)}
                aria-pressed={readyBy === e.date}
                className={clsx('rounded-full border px-2.5 py-0.5 text-[12.5px]', readyBy === e.date ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-sheet hover:border-accent')}
              >
                {e.title ? `${e.title}: ` : ''}
                {date(e.date)} <span className="text-ink-3">· {e.courseTitle}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <fieldset>
        <legend className="block font-medium">{t.deckCourses}</legend>
        {courses.length ? (
          <div className="mt-1 space-y-1">
            {courses.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.courses.includes(c.id)}
                  onChange={(e) => onChange({ courses: e.target.checked ? [...s.courses, c.id] : s.courses.filter((x) => x !== c.id) })}
                  className="wb-check"
                />
                {c.title}
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[12.5px] text-ink-3">{t.noCoursesYet}</p>
        )}
        {deck.suggestedCourses.length ? (
          <p className="mt-2 text-[12.5px] text-ink-2">
            {t.deckCoursesSuggestion(deck.suggestedCourses.map(titleOf).join(', '))}{' '}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => onChange({ courses: [...s.courses, ...deck.suggestedCourses] })}>
              {t.addThem}
            </button>
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

const clamp = (v: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

/** Like the AI review of an answer: a prompt to paste into the student's own chat. */
function CheckDeckDialog({ open, onClose, deckId }: { open: boolean; onClose: () => void; deckId: string }) {
  const t = useT();
  const lang = useLang();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);

  const copy = async () => {
    setCopied(null);
    const { text } = await deckPrompt(deckId, lang);
    setPrompt(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.checkDeckWithAi} width="max-w-lg">
      <p className="text-sm text-ink-2">{t.checkDeckIntro}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void copy()}>
          {copied === 'yes' ? <Check size={15} /> : <Copy size={15} />} {t.aiCopy}
        </Button>
        {CHATS.map(([name, url]) => (
          <a key={name} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            {t.aiOpenChat(name)} <ExternalLink size={13} />
          </a>
        ))}
      </div>
      {copied ? (
        <p className={copied === 'yes' ? 'mt-3 text-sm font-medium text-done' : 'mt-3 text-sm font-medium text-danger'} role="status">
          {copied === 'yes' ? t.aiCopied : t.aiCopyFailed}
        </p>
      ) : null}
      {prompt !== null && copied === 'failed' ? (
        <textarea readOnly value={prompt} rows={10} aria-label={t.aiShowPrompt} onFocus={(e) => e.target.select()} className="mt-3 w-full resize-y wb-field wb-field-sunk p-3 font-mono text-[12px] leading-relaxed" />
      ) : null}
    </Dialog>
  );
}

