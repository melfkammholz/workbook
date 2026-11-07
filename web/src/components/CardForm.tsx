import type { CardKind, RenderedCard } from '@wb/shared';
import { Columns2, PanelBottom, X } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { cardText, previewDeck, type CardFields } from '@/lib/flashcards';
import { useT } from '@/lib/i18n';
import { modKey } from '@/lib/keys';
import { readPref, writePref } from '@/lib/shell';
import { useMediaQuery } from '@/lib/useActiveTime';
import { tagLabel, typstContext } from '@/lib/typst';
import { CardFace } from './CardFace';
import { CodeEditor } from './CodeEditor';
import { Button, IconButton, Segmented, clsx } from './ui';

const KINDS: CardKind[] = ['basic', 'both', 'cloze'];

// ───────────────────────── where the preview goes ─────────────────────────

const LAYOUTS = ['below', 'side'] as const;
export type CardLayout = (typeof LAYOUTS)[number];
const LAYOUT_KEY = 'wb-card-preview';
/** Side by side needs room; on a narrow screen the preview goes below, and the choice is kept. */
export const ROOMY = '(min-width: 900px)';
let layoutNow: CardLayout = readPref(LAYOUT_KEY, LAYOUTS, 'below');
const layoutListeners = new Set<() => void>();

/** Below or beside the inputs: one choice for every card form, and the dialog around one widens with it. */
export function useCardLayout(): [CardLayout, (l: CardLayout) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      layoutListeners.add(cb);
      return () => layoutListeners.delete(cb);
    },
    () => layoutNow,
  );
  const set = useCallback((l: CardLayout) => {
    layoutNow = l;
    writePref(LAYOUT_KEY, l);
    layoutListeners.forEach((cb) => cb());
  }, []);
  return [value, set];
}

/**
 * One card as a form: kind, front and back in small Typst editors, tags, and a
 * preview of how it will look. Used wherever a card is written or rewritten, so
 * nobody has to know the deck's text to work with cards.
 */
export function CardForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  footer,
  autoFocus,
}: {
  initial?: Partial<CardFields>;
  submitLabel: string;
  /** Resolves when saved; the form then empties itself, unless it edits a card. */
  onSubmit: (fields: CardFields) => Promise<unknown>;
  onCancel?: () => void;
  /** Next to the submit button, e.g. which deck. */
  footer?: ReactNode;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [kind, setKind] = useState<CardKind>(initial?.kind ?? 'basic');
  const [front, setFront] = useState(initial?.front ?? '');
  const [back, setBack] = useState(initial?.back ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ card: RenderedCard; css: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [layout, setLayout] = useCardLayout();
  const roomy = useMediaQuery(ROOMY);
  const side = layout === 'side' && roomy;

  const ready = front.trim() !== '' && (kind === 'cloze' || back.trim() !== '');

  // A preview a moment after typing stops. The last one that compiled stays up.
  useEffect(() => {
    if (!front.trim()) {
      setPreview(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      previewDeck(cardText(kind, front, back)).then(
        (p) => {
          const card = p.cards[0];
          if (!stale && card && !p.diagnostics.some((d) => d.severity === 'error')) setPreview({ card, css: p.css });
        },
        () => undefined,
      );
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [kind, front, back]);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ kind, front, back: kind === 'cloze' ? '' : back, tags });
      if (!initial?.front) {
        setFront('');
        setBack('');
        setPreview(null);
      }
    } catch (err) {
      setError(err instanceof ApiError && err.message === 'unbalanced' ? t.cardUnbalanced : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, rows: number, focus: boolean) => (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div
        className="mt-1 overflow-hidden rounded-md border border-line-strong bg-sheet focus-within:border-accent"
        style={{ height: `${rows * 1.6 + 1.9}em` }}
        ref={(el) => {
          if (focus && el && !el.dataset.focused) {
            el.dataset.focused = '1';
            requestAnimationFrame(() => el.querySelector<HTMLElement>('.cm-content')?.focus());
          }
        }}
      >
        <CodeEditor value={value} onChange={set} language="typst" variant="notes" wrap lineNumbers={false} label={label} tabMovesFocus />
      </div>
    </label>
  );

  const previewBox = preview ? (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-ink-3">{t.preview}</span>
        {kind === 'cloze' ? (
          <button type="button" className="text-[12.5px] text-accent hover:underline" onClick={() => setRevealed(!revealed)}>
            {revealed ? t.hideGap : t.showAnswer}
          </button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-sheet">
        <CardFace html={preview.card.front} css={preview.css} gap={kind === 'cloze' ? 1 : null} revealed={revealed} className="px-4 py-3" />
        {kind !== 'cloze' ? <CardFace html={preview.card.back} css={preview.css} gap={null} revealed className="border-t border-line bg-paper px-4 py-3" /> : null}
      </div>
    </div>
  ) : side ? (
    // Beside the inputs the place stays, so nothing jumps when the first preview comes.
    <div>
      <span className="mb-1 block text-[12.5px] font-medium text-ink-3">{t.preview}</span>
      <p className="grid min-h-32 place-items-center rounded-lg border border-dashed border-line-strong px-4 text-center text-[13px] text-ink-3">{t.previewHere}</p>
    </div>
  ) : null;

  const inputs = (
    <>
      <div>
        <div className="flex items-center justify-between gap-3">
          <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => [k, t.cardKind[k]])} />
          {roomy ? (
            <div className="flex items-center" role="group" aria-label={t.cardPreviewPlace}>
              {(
                [
                  ['below', PanelBottom, t.cardPreviewBelow],
                  ['side', Columns2, t.cardPreviewBeside],
                ] as const
              ).map(([l, Icon, name]) => (
                <IconButton key={l} label={name} aria-pressed={layout === l} onClick={() => setLayout(l)} className={clsx('size-7', layout === l && 'bg-sunk text-ink')}>
                  <Icon size={15} />
                </IconButton>
              ))}
            </div>
          ) : null}
        </div>
        <p className="mt-1.5 text-[12.5px] text-ink-3">{t.cardKindHint[kind]}</p>
      </div>
      {field(kind === 'cloze' ? t.clozeText : t.cardFront, front, setFront, kind === 'cloze' ? 8 : 5, !!autoFocus)}
      {kind !== 'cloze' ? field(t.cardBack, back, setBack, 5, false) : null}
      <TagPicker tags={tags} onChange={setTags} />
    </>
  );

  return (
    <div
      className="space-y-4 text-sm"
      // Ctrl+Enter saves from anywhere in the form, the tags included.
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      {side ? (
        <div className="grid grid-cols-2 items-start gap-5">
          <div className="min-w-0 space-y-4">{inputs}</div>
          <div className="sticky top-0 min-w-0">{previewBox}</div>
        </div>
      ) : (
        <>
          {inputs}
          {previewBox}
        </>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {footer ?? <span className="flex-1" />}
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            {t.cancel}
          </Button>
        ) : null}
        <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()} title={`${submitLabel} (${modKey}+Enter)`}>
          {submitLabel}
        </Button>
      </div>
      {error ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A card's own tags. The tags of its exercise come on top without being listed here. */
function TagPicker({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const known = typstContext.tags;
  const labelOf = tagLabel;
  const add = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const id = known.find((k) => k.label.toLowerCase() === value.toLowerCase())?.id ?? value;
    if (!tags.includes(id)) onChange([...tags, id]);
    setDraft('');
  };
  return (
    <div>
      <span className="text-sm font-medium">{t.cardTags}</span>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-sheet px-2 py-1.5 focus-within:border-accent">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {labelOf(tag)}
            <button type="button" aria-label={t.removeTag(labelOf(tag))} onClick={() => onChange(tags.filter((x) => x !== tag))} className="hover:text-ink">
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          list="wb-card-tags"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => add(draft)}
          placeholder={tags.length ? '' : t.cardTagsPlaceholder}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm focus:outline-none"
        />
        <datalist id="wb-card-tags">
          {known.map((k) => (
            <option key={k.id} value={k.label} />
          ))}
        </datalist>
      </div>
      <p className="mt-1 text-[12px] text-ink-3">{t.cardTagsHint}</p>
    </div>
  );
}
