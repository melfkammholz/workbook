import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { Status } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { StatusMark, clsx } from './ui';

const ORDER: Status[] = ['todo', 'in_progress', 'done', 'review'];

export function StatusControl({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={clsx(
            'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-[13px] font-medium transition-colors',
            status === 'done' && 'border-done/40 bg-done-soft text-done',
            status === 'review' && 'border-review/40 bg-review-soft text-review',
            status === 'in_progress' && 'border-accent/40 bg-accent-soft text-accent',
            status === 'todo' && 'border-line-strong bg-sheet text-ink hover:bg-sunk',
          )}
        >
          <StatusMark status={status} size={14} />
          {t.status[status]}
          <ChevronDown size={14} className="opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="wb-menu w-56 p-1.5">
          {ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setOpen(false);
                if (s !== status) onChange(s);
              }}
              className={clsx('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-sunk', s === status && 'bg-sunk')}
            >
              <StatusMark status={s} size={16} />
              <span>
                <span className="block text-sm font-medium">{t.status[s]}</span>
                <span className="block text-xs text-ink-3">{t.statusHint[s]}</span>
              </span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
