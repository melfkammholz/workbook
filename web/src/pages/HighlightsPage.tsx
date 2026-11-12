import { useQueryClient } from '@tanstack/react-query';
import { itemOfTarget, type AnnotationEntry, type Outline } from '@wb/shared';
import { Check, Layers, MessageSquare, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { MakeCardDialog } from '@/components/MakeCardDialog';
import { Quote, useGoToAnnotation } from '@/components/Marks';
import { Title } from '@/components/Title';
import { Button, Empty, Segmented, Spinner, clsx } from '@/components/ui';
import { addAnnotation, deleteAnnotation, escapeMarkup, updateAnnotation, useAnnotations } from '@/lib/annotations';
import { useOutline, useSettings } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { useDebouncedCallback } from '@/lib/useDebounced';

type HighlightFilter = 'all' | 'open' | 'missing';
const HIGHLIGHT_FILTERS: readonly HighlightFilter[] = ['all', 'open', 'missing'];

interface Group {
  key: string;
  title: string;
  texts: { target: string; title: string; href: string | null; list: AnnotationEntry[] }[];
}

/** The course's texts in the course's order, each with its highlights; what no longer exists comes last. */
function grouped(outline: Outline, list: AnnotationEntry[], t: ReturnType<typeof useT>): Group[] {
  const by = new Map<string, AnnotationEntry[]>();
  for (const a of list) (by.get(a.target) ?? by.set(a.target, []).get(a.target)!).push(a);
  const seen = new Set<string>();
  const text = (target: string, title: string, href: string) => {
    seen.add(target);
    const l = by.get(target);
    return l?.length ? [{ target, title, href, list: l }] : [];
  };
  const groups: Group[] = [];
  const start = text('landing', t.highlightsWelcome, '/welcome');
  if (start.length) groups.push({ key: 'landing', title: outline.title, texts: start });
  for (const c of outline.chapters) {
    const texts = [text(`chapter/${c.id}`, t.highlightsIntroOf(c.title), `/chapter/${c.id}`), ...c.items.map((i) => text(i.id, i.title, `/item/${i.id}`))].flat();
    if (texts.length) groups.push({ key: c.id, title: c.title, texts });
  }
  const other = [
    ...outline.threads.flatMap((th) => text(`thread/${th.id}`, th.title, `/adventure/${th.id}`)),
    // A course update can remove a text. What the student wrote about it is still theirs.
    ...[...by.keys()].filter((k) => !seen.has(k)).map((k) => ({ target: k, title: k, href: null, list: by.get(k)! })),
  ];
  if (other.length) groups.push({ key: 'other', title: t.highlightsOther, texts: other });
  return groups;
}

/** Every highlight in the course: the second pass, where what was unclear gets cleared up. */
/** `filter` from the address; anything unknown shows all. */
export function HighlightsPage({ filter: asked }: { filter?: string }) {
  const filter: HighlightFilter = HIGHLIGHT_FILTERS.includes(asked as HighlightFilter) ? (asked as HighlightFilter) : 'all';
  const t = useT();
  const outline = useOutline().data;
  const settings = useSettings().data;
  const list = useAnnotations();
  const [shown, setShown] = useState<HighlightFilter>(filter);
  const [card, setCard] = useState<AnnotationEntry | null>(null);
  const [removed, setRemoved] = useState<AnnotationEntry | null>(null);
  const qc = useQueryClient();
  const all = list.data ?? [];
  const counts = { all: all.length, open: all.filter((a) => a.review === 'open').length, missing: all.filter((a) => !a.found).length };
  const visible = all.filter((a) => (shown === 'open' ? a.review === 'open' : shown === 'missing' ? !a.found : true));
  const groups = useMemo(() => (outline ? grouped(outline, visible, t) : []), [outline, visible, t]);

  if (settings && !settings.showAnnotations) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.highlightsOffTitle}>
          <Link href="/settings" className="text-accent hover:underline">
            {t.highlightsOffBody}
          </Link>
        </Empty>
      </div>
    );
  }
  if (!outline || list.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="settle wb-page mx-auto max-w-3xl px-6 pb-12 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.highlights}</h1>
        {all.length === 0 ? (
          <Empty title={t.highlightsNone}>{t.highlightsNoneBody}</Empty>
        ) : (
          <>
            <p className="mt-2 max-w-prose text-ink-2">{t.highlightsIntro}</p>
            <div className="mt-4">
              <Segmented<HighlightFilter>
                value={shown}
                options={HIGHLIGHT_FILTERS.filter((f) => f !== 'missing' || counts.missing > 0).map((f) => [f, `${t.highlightsFilter[f]} (${counts[f]})`])}
                onChange={setShown}
              />
            </div>
            {visible.length === 0 ? <p className="mt-8 text-ink-2">{t.highlightsNoneHere}</p> : null}
          </>
        )}
        {groups.map((g) => (
          <section key={g.key} className="mt-8">
            <h2 className="mb-3 text-[15px] font-semibold">
              <Title text={g.title} />
            </h2>
            <div className="space-y-6">
              {g.texts.map((x) => (
                <article key={x.target}>
                  {x.href ? (
                    <Link href={x.href} className="mb-1.5 block text-sm font-medium text-accent hover:underline">
                      <Title text={x.title} />
                    </Link>
                  ) : (
                    <p className="mb-1.5 font-mono text-xs text-ink-3">{x.title}</p>
                  )}
                  <ul className="divide-y divide-line">
                    {x.list.map((a) => (
                      <Row
                        key={a.id}
                        a={a}
                        onCard={settings?.showFlashcards ? () => setCard(a) : undefined}
                        onRemove={() => {
                          setRemoved(a);
                          void deleteAnnotation(qc, a.id);
                        }}
                      />
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {removed ? (
        // The last one removed can come back, until the next one is removed or the page is left.
        <div role="status" className="wb-pop fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-line-strong bg-sheet py-1.5 pl-4 pr-1.5 text-[13px] shadow-[var(--shadow)]">
          <span className="text-ink-2">{t.annRemoved}</span>
          <Button size="sm" variant="ghost" onClick={() => {
              addAnnotation(qc, removed);
              setRemoved(null);
            }}>
            <Undo2 size={14} /> {t.undo}
          </Button>
        </div>
      ) : null}
      {card ? (
        <MakeCardDialog
          open
          onClose={() => setCard(null)}
          exerciseId={itemOfTarget(card.target)}
          initial={{ kind: 'basic', front: card.comment.trim() ? escapeMarkup(card.comment.trim()) : '', back: escapeMarkup(card.quote.trim()) }}
        />
      ) : null}
    </div>
  );
}

function Row({ a, onCard, onRemove }: { a: AnnotationEntry; onCard?: () => void; onRemove: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const go = useGoToAnnotation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.comment);
  const save = useDebouncedCallback((comment: string) => void updateAnnotation(qc, a.id, { comment }), 500);

  return (
    <li className="px-4 py-3">
      <Quote a={a} className="text-[15px]" />
      {!a.found ? <p className="mt-1 pl-3 text-[13px] text-ink-3">{t.highlightsMissing}</p> : null}
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          rows={3}
          maxLength={4000}
          placeholder={t.annCommentPlaceholder}
          aria-label={t.annCommentLabel}
          onChange={(e) => {
            setDraft(e.target.value);
            save.call(e.target.value);
          }}
          onBlur={() => {
            save.flush();
            setEditing(false);
          }}
          className="mt-2 block w-full resize-y wb-field px-2.5 py-1.5 text-[14px]"
        />
      ) : a.comment.trim() ? (
        <button type="button" onClick={() => setEditing(true)} className="mt-1.5 block w-full whitespace-pre-wrap rounded-md py-0.5 pl-3 text-left text-[14px] text-ink-2 hover:bg-sunk">
          {a.comment.trim()}
        </button>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1 pl-2">
        {a.review === 'open' ? (
          <span className="mr-1 inline-flex items-center gap-1 text-[13px] font-medium text-review">
            <RotateCcw size={13} /> {t.annMarked}
          </span>
        ) : a.review === 'resolved' ? (
          <span className="mr-1 inline-flex items-center gap-1 text-[13px] font-medium text-done">
            <Check size={13} /> {t.annIsClearedUp}
          </span>
        ) : null}
        {a.found ? (
          <Button size="sm" variant="ghost" onClick={() => go(a)}>
            {t.highlightsGoTo}
          </Button>
        ) : null}
        {a.review === 'open' ? (
          <Button size="sm" variant="ghost" onClick={() => void updateAnnotation(qc, a.id, { review: 'resolved' })}>
            <Check size={14} /> {t.annClearUp}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => void updateAnnotation(qc, a.id, { review: 'open' })}>
            {a.review === 'resolved' ? t.annReopen : t.annComeBack}
          </Button>
        )}
        {!editing && !a.comment.trim() ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <MessageSquare size={14} /> {t.annComment}
          </Button>
        ) : null}
        {onCard ? (
          <Button size="sm" variant="ghost" onClick={onCard}>
            <Layers size={14} /> {t.annMakeCard}
          </Button>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t.annRemove}
          title={t.annRemove}
          onClick={onRemove}
          className={clsx('grid size-7 place-items-center rounded-md text-ink-3 hover:bg-sunk hover:text-danger')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
