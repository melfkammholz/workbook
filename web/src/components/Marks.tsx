import { useQueryClient } from '@tanstack/react-query';
import { itemOfTarget, targetHref, type AnnotationEntry } from '@wb/shared';
import { Check, RotateCcw } from 'lucide-react';
import { useLocation } from 'wouter';
import { revealPending, showAnnotationOnArrival, updateAnnotation, useAnnotations } from '@/lib/annotations';
import { useOutline } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Title } from './Title';
import { clsx } from './ui';

/** Takes the student to a highlight: on this page it scrolls there, otherwise it opens the text first. */
export function useGoToAnnotation() {
  const [location, navigate] = useLocation();
  return (a: AnnotationEntry) => {
    showAnnotationOnArrival(a.id);
    const href = targetHref(a.target);
    if (location === href || location.startsWith(`${href}/in/`)) revealPending();
    else navigate(href);
  };
}

/** The quote as it was highlighted, in its colour. */
export function Quote({ a, className }: { a: AnnotationEntry; className?: string }) {
  return (
    <span className={clsx('flex min-w-0 gap-2', className)}>
      <span data-color={a.color} aria-hidden className="wb-ann-swatch mt-[0.2em] w-1 shrink-0 self-stretch rounded-full" />
      <span className={clsx('min-w-0 break-words', !a.found && 'text-ink-3')}>{a.quote.trim()}</span>
    </span>
  );
}

/** One open mark: the quote leads to it, the button clears it up. */
function OpenMark({ a }: { a: AnnotationEntry }) {
  const t = useT();
  const qc = useQueryClient();
  const go = useGoToAnnotation();
  return (
    <li className="flex items-start gap-2">
      <button type="button" onClick={() => go(a)} disabled={!a.found} className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left text-[14px] hover:bg-sunk disabled:hover:bg-transparent">
        <Quote a={a} className="line-clamp-3" />
        {a.comment.trim() ? <span className="mt-0.5 block whitespace-pre-wrap pl-3 text-[13px] text-ink-2">{a.comment.trim()}</span> : null}
      </button>
      <button type="button" onClick={() => void updateAnnotation(qc, a.id, { review: 'resolved' })} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-sunk hover:text-ink">
        <Check size={14} /> {t.annClearUp}
      </button>
    </li>
  );
}

/** At the top of a text: what the student wanted to come back to in it. */
export function OpenMarks({ target }: { target: string }) {
  const t = useT();
  const open = (useAnnotations().data ?? []).filter((a) => a.target === target && a.review === 'open');
  if (!open.length) return null;
  return (
    <aside className="mb-6 rounded-lg border border-review/30 bg-review-soft/50 px-3 py-2.5">
      <p className="mb-1 flex items-center gap-2 px-1.5 text-[13px] font-medium text-review">
        <RotateCcw size={14} /> {t.openMarksHere(open.length)}
      </p>
      <ul className="space-y-0.5">
        {open.map((a) => (
          <OpenMark key={a.id} a={a} />
        ))}
      </ul>
    </aside>
  );
}

/** On a chapter's checklist: the second pass over the chapter, before the student rates themselves. */
export function ChapterMarks({ chapterId }: { chapterId: string }) {
  const t = useT();
  const outline = useOutline().data;
  const all = useAnnotations().data ?? [];
  const chapter = outline?.chapters.find((c) => c.id === chapterId);
  if (!chapter) return null;
  const order = [`chapter/${chapter.id}`, ...chapter.items.map((i) => i.id)];
  const open = all.filter((a) => a.review === 'open' && order.includes(a.target)).sort((a, b) => order.indexOf(a.target) - order.indexOf(b.target));
  if (!open.length) return null;
  const titleOf = (target: string) => chapter.items.find((i) => i.id === itemOfTarget(target))?.title ?? t.highlightsIntroOf(chapter.title);
  const targets = [...new Set(open.map((a) => a.target))];
  return (
    <section className="mb-8 rounded-lg border border-review/30 bg-review-soft/50 px-4 py-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <RotateCcw size={15} className="text-review" /> {t.openMarksChapter}
      </h2>
      <p className="mt-0.5 text-[13px] text-ink-2">{t.openMarksChapterBody}</p>
      {targets.map((target) => (
        <div key={target} className="mt-3">
          <p className="mb-0.5 px-1.5 text-[13px] font-medium text-ink-2">
            <Title text={titleOf(target)} />
          </p>
          <ul className="space-y-0.5">
            {open
              .filter((a) => a.target === target)
              .map((a) => (
                <OpenMark key={a.id} a={a} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
