import type { CardKind, RenderedCard } from '@wb/shared';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { cardText, previewDeck, type CardFields } from '@/lib/flashcards';
import { useT } from '@/lib/i18n';
import { typstContext } from '@/lib/typst';
import { CardFace } from './CardFace';
import { CodeEditor } from './CodeEditor';
import { Button, Segmented } from './ui';

const KINDS: CardKind[] = ['basic', 'both', 'cloze'];

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
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        ref={(el) => {
          if (focus && el && !el.dataset.focused) {
            el.dataset.focused = '1';
            requestAnimationFrame(() => el.querySelector<HTMLElement>('.cm-content')?.focus());
          }
        }}
      >
        <CodeEditor value={value} onChange={set} language="typst" variant="notes" wrap lineNumbers={false} label={label} />
      </div>
    </label>
  );

  return (
    <div className="space-y-4 text-sm">
      <div>
        <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => [k, t.cardKind[k]])} />
        <p className="mt-1.5 text-[12.5px] text-ink-3">{t.cardKindHint[kind]}</p>
      </div>
      {field(kind === 'cloze' ? t.clozeText : t.cardFront, front, setFront, kind === 'cloze' ? 5 : 3, !!autoFocus)}
      {kind !== 'cloze' ? field(t.cardBack, back, setBack, 3, false) : null}
      <TagPicker tags={tags} onChange={setTags} />

      {preview ? (
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
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        {footer ?? <span className="flex-1" />}
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            {t.cancel}
          </Button>
        ) : null}
        <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
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
  const labelOf = (id: string) => known.find((k) => k.id === id)?.label ?? id;
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
