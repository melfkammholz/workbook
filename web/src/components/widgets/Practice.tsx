import { PencilLine } from 'lucide-react';
import { Link } from 'wouter';
import { statusOf, useOutline, useState_ } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Prose } from '../Prose';
import { Level, StatusMark, clsx } from '../ui';
import type { Part } from './index';
import { Title } from '@/components/Title';

/**
 * The exercise to do next, in a box of its own at the end of a lesson: what it is, how hard, how far the
 * student is, and one click to it. Everything but the author's sentence comes from the outline.
 */
export function Practice({ id, parts }: { id: string; parts: Part[] }) {
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  const chapter = outline?.chapters.find((c) => c.items.some((i) => i.id === id));
  const item = chapter?.items.find((i) => i.id === id);
  if (!item) return null;
  const ex = item.type === 'exercise' ? item : null;
  const status = statusOf(state, id);
  const text = parts.find((p) => p.name === 'text');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-accent/35 bg-accent-soft/50 p-4 sm:flex-nowrap">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink">
        <PencilLine size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-accent">{t.widget.practice}</p>
        <p className="text-[16px] font-semibold leading-snug">
          {ex?.startHere && ex.emoji ? <span className="mr-1.5">{ex.emoji}</span> : null}
          {ex?.number ? <span className="mr-1.5 tabular-nums text-ink-3">{ex.number}</span> : null}
          <Title text={item.title} />
        </p>
        {text ? <Prose html={text.html} className="mt-0.5 text-[14.5px] text-ink-2" /> : null}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <StatusMark status={status} size={12} /> {t.status[status]}
          </span>
          {ex ? (
            <span className="inline-flex items-center gap-1.5">
              <Level level={ex.level} /> {[t.easy, t.medium, t.hard][ex.level - 1]}
            </span>
          ) : null}
          {chapter ? <span className="truncate">{chapter.title}</span> : null}
        </p>
      </div>
      <Link
        href={`/item/${id}`}
        className={clsx(
          // In a lesson the text's own rules for links (accent, underline) would win otherwise.
          'inline-flex h-8.5 shrink-0 items-center rounded-md px-3.5 text-sm font-medium !no-underline',
          status === 'done' ? 'border border-line-strong bg-sheet !text-ink hover:bg-sunk' : 'bg-accent !text-accent-ink hover:brightness-110',
        )}
      >
        {status === 'done' ? t.widget.practiceAgain : t.widget.practiceOpen}
      </Link>
    </div>
  );
}
