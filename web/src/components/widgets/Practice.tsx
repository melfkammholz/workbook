import { Bookmark, Check, ChevronRight, GraduationCap, PencilLine } from 'lucide-react';
import { Link } from 'wouter';
import { statusOf, useOutline, useState_ } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Title } from '../Title';
import { clsx } from '../ui';

/**
 * Exercises (or lessons) to do next, at the end of a lesson: a list to click through. Each row says what it is and whether
 * it is done; the row itself is the way there. The call to action is the author's, once, before the list.
 */
export function Practice({ ids }: { ids: string[] }) {
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  const items = ids.flatMap((id) => {
    const item = outline?.chapters.flatMap((c) => c.items).find((i) => i.id === id);
    return item ? [item] : [];
  });
  if (!items.length) return null;
  return (
    <div role="list" className="space-y-1.5">
      {items.map((item) => {
        const status = statusOf(state, item.id);
        const done = status === 'done';
        // The tile says how far the student is; before that, what it is: an exercise or a lesson.
        const tile =
          done ? { cls: 'bg-done-soft text-done', icon: <Check size={16} strokeWidth={2.75} /> }
          : status === 'review' ? { cls: 'bg-review-soft text-review', icon: <Bookmark size={15} /> }
          : status === 'in_progress' ? { cls: 'bg-accent text-accent-ink', icon: item.type === 'lesson' ? <GraduationCap size={15} /> : <PencilLine size={15} /> }
          : { cls: 'bg-accent-soft text-accent', icon: item.type === 'lesson' ? <GraduationCap size={15} /> : <PencilLine size={15} /> };
        return (
          <div role="listitem" key={item.id}>
            <Link
              href={`/item/${item.id}`}
              className="group flex items-center gap-3 rounded-lg border border-line bg-sheet px-3 py-2.5 !text-ink !no-underline shadow-[0_1px_2px_rgb(26_32_51/0.05)] transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-accent/50 hover:shadow-[0_3px_10px_-4px_rgb(26_32_51/0.18)]"
            >
              <span className={clsx('grid size-8 shrink-0 place-items-center rounded-lg', tile.cls)} title={t.status[status]}>
                {tile.icon}
              </span>
              <span className={clsx('min-w-0 flex-1 text-[15px] font-medium', done && 'text-ink-2')}>
                <Title text={item.title} />
              </span>
              <ChevronRight size={18} className="shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
