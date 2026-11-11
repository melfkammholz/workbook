import { BookOpen, ChevronRight, PencilLine } from 'lucide-react';
import { Link } from 'wouter';
import { statusOf, useOutline, useState_ } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Title } from '../Title';
import { Level, StatusMark, clsx } from '../ui';
import { Prose } from '../Prose';
import { Inline, type Part } from './index';

/**
 * Exercises (or lessons) to do next, at the end of a lesson: a list to click through. A heading says what the list is,
 * so the text needs no call to action.
 */
export function Practice({ ids, parts = [] }: { ids: string[]; parts?: Part[] }) {
  const note = parts.find((p) => p.name === 'note');
  const comment = (id: string) => parts.find((p) => p.name === 'comment' && p.attrs.id === id);
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  const items = ids.flatMap((id) => {
    const item = outline?.chapters.flatMap((c) => c.items).find((i) => i.id === id);
    return item ? [item] : [];
  });
  if (!items.length) return null;
  const head = `practice-${items[0]!.id}`;
  // One of the lesson's blocks: the pencil on the left, a headline, then a row per item. Each row says what it is and
  // whether it is done; the row itself is the way there.
  return (
    <section aria-labelledby={head} className="flex gap-3 rounded-xl border border-line bg-sheet px-4 py-3.5">
      <span aria-hidden className="flex h-[22.5px] shrink-0 items-center text-done">
        <PencilLine size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={head} className="!mb-1 !mt-0 !text-[15.5px] !font-semibold !leading-[22.5px] !text-ink">
          {t.practiceTitle}
        </h3>
        {note ? <Prose html={note.html} className="-mt-1 mb-1.5 !text-[14px] !text-ink-3" /> : null}
        <div role="list" className="-mb-1.5 -ml-2">
          {items.map((item) => {
            const status = statusOf(state, item.id);
            const done = status === 'done';
            const remark = comment(item.id);
            return (
              <div role="listitem" key={item.id}>
                <Link
                  href={`/item/${item.id}`}
                  className="group grid grid-cols-[16px_minmax(0,1fr)_auto_auto_16px] items-center gap-2.5 rounded-lg px-2 py-[7px] text-[14px] !text-ink !no-underline transition-colors hover:bg-sunk"
                >
                  {/* What it is and how far the student is: a status circle for an exercise, a book for a lesson. */}
                  <span className="flex justify-center">
                    {item.type === 'exercise' ? <StatusMark status={status} /> : <BookOpen size={15} strokeWidth={1.75} className={done ? 'text-done' : 'text-ink-3'} aria-label={t.status[status]} />}
                  </span>
                  <span className={clsx('min-w-0', done && 'text-ink-2')}>
                    <Title text={item.title} />
                  </span>
                  <span className="text-[12.5px] text-ink-3">{remark ? <Inline html={remark.html} className="hidden sm:inline" /> : null}</span>
                  <span className="flex justify-end">{item.type === 'exercise' ? <Level level={item.level} compact /> : null}</span>
                  <ChevronRight size={15} className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
