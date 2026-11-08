import { ArrowRight, FileText, GraduationCap, ListChecks } from 'lucide-react';
import { Link } from 'wouter';
import type { ItemMeta, StudentState } from '@wb/shared';
import { itemHref, statusOf } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Level, StatusMark, clsx } from './ui';
import { Title } from '@/components/Title';

/** One exercise, page or checklist in a list, with how far along it is. */
export function ItemRow({ item, state, outside = false, className, group }: { item: ItemMeta; state: StudentState | undefined; outside?: boolean; className?: string; group?: string }) {
  const t = useT();
  const answered = item.type === 'checklist' && Object.keys(state?.checklists[item.id] ?? {}).length > 0;
  return (
    <Link href={itemHref(item.id, group)} className={clsx('group flex items-center gap-3 px-4 py-2.5 hover:bg-paper/60', className)}>
      {item.type === 'exercise' ? (
        <StatusMark status={statusOf(state, item.id)} size={16} />
      ) : item.type === 'checklist' ? (
        <ListChecks size={16} className={answered ? 'text-done' : 'text-ink-3'} />
      ) : item.type === 'lesson' ? (
        <GraduationCap size={16} className={statusOf(state, item.id) === 'done' ? 'text-done' : 'text-ink-3'} />
      ) : (
        <FileText size={16} className="text-ink-3" />
      )}
      <span className={clsx('min-w-0 flex-1 truncate text-[14.5px]', outside && 'italic text-ink-3')}>
        {item.type === 'exercise' && item.startHere && item.emoji ? <span className="mr-1.5">{item.emoji}</span> : null}
        <Title text={item.title} />
      </span>
      {outside ? <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">{t.outsideFocus}</span> : null}
      {item.type === 'exercise' ? <Level level={item.level} /> : null}
      <ArrowRight size={14} className="text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

export function ProgressLine({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
      <div className="h-full rounded-full bg-done transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </div>
  );
}
