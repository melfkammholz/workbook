import * as Popover from '@radix-ui/react-popover';
import { MoreHorizontal } from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Tip, clsx } from './ui';

const CloseMenu = createContext<() => void>(() => undefined);

/**
 * The "⋯" of a row: what is not the row's main job, grouped. It shows while the row (a `group/row`) is pointed at or
 * has focus, and stays while open or with `pinned` (something in it needs the student's eye).
 */
export function MoreMenu({ label, children, pinned = false, dot = false, width = 'w-60', className }: { label: string; children: ReactNode; pinned?: boolean; dot?: boolean; width?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <CloseMenu.Provider value={() => setOpen(false)}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tip label={label}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={label}
              className={clsx(
                'relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-sunk hover:text-ink focus-visible:opacity-100',
                open || pinned ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
                open && 'bg-sunk text-ink',
                className,
              )}
            >
              <MoreHorizontal size={16} />
              {dot ? <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-review" /> : null}
            </button>
          </Popover.Trigger>
        </Tip>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={4}
            role="menu"
            aria-label={label}
            className={clsx('wb-menu p-1', width)}
            onKeyDown={(e) => {
              const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')];
              const at = items.indexOf(document.activeElement as HTMLElement);
              if (e.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
              else if (e.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
              else return;
              e.preventDefault();
            }}
          >
            {children}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </CloseMenu.Provider>
  );
}

const ITEM = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13.5px] text-ink outline-none hover:bg-sunk focus-visible:bg-sunk';

/** One entry of a `MoreMenu`: an action, a router link (`to`) or a file link (`href`). Picking it closes the menu. */
export function MenuItem({
  icon,
  children,
  onSelect,
  to,
  href,
  download,
  danger = false,
  trailing,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect?: () => void;
  to?: string;
  href?: string;
  download?: string;
  danger?: boolean;
  trailing?: ReactNode;
}) {
  const close = useContext(CloseMenu);
  const cls = clsx(ITEM, danger && 'text-danger');
  const inner = (
    <>
      <span aria-hidden className={clsx('grid size-4 shrink-0 place-items-center', danger ? 'text-danger' : 'text-ink-2')}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="shrink-0 text-[12px] text-ink-3">{trailing}</span> : null}
    </>
  );
  if (to) {
    return (
      <Link href={to} role="menuitem" onClick={close} className={cls}>
        {inner}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} download={download} role="menuitem" onClick={close} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        close();
        onSelect?.();
      }}
      className={cls}
    >
      {inner}
    </button>
  );
}

export const MenuRule = () => <div role="separator" className="my-1 h-px bg-line" />;
