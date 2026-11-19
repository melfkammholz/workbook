import clsx from 'clsx';
import { todoProgress, type Todo } from '@wb/shared';

/** One segment per direct part (done green, doing half, open empty); above 10 parts one continuous bar. */
export function TodoSegments({ todo }: { todo: Todo }) {
  const { done, doing, total } = todoProgress(todo);
  if (total === 0) return null;
  if (total > 10) {
    return (
      <span aria-hidden className="relative h-1.5 w-[84px] shrink-0 overflow-hidden rounded-full bg-sunk">
        <span className="absolute inset-y-0 left-0 bg-accent/40" style={{ width: `${((done + doing) / total) * 100}%` }} />
        <span className="absolute inset-y-0 left-0 bg-done" style={{ width: `${(done / total) * 100}%` }} />
      </span>
    );
  }
  return (
    <span aria-hidden className="flex shrink-0 gap-0.5">
      {todo.children.map((c) => (
        <span key={c.id} className={clsx('h-1.5 w-[13px] rounded-sm', c.status === 'done' ? 'bg-done' : c.status === 'doing' ? 'bg-gradient-to-r from-accent from-50% to-sunk to-50%' : 'bg-sunk')} />
      ))}
    </span>
  );
}
