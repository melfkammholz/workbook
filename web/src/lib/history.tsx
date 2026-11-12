import { ArrowLeft } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useHashLocation, navigate as hashNavigate } from 'wouter/use-hash-location';
import { clsx } from 'clsx';

/**
 * Hash routing that numbers its history entries, so a back button knows whether the
 * previous page is one of ours. Entries made otherwise (a typed address, a reload of
 * an old link) have no number: a back button then goes to its page's parent instead.
 */
const indexNow = (): number => {
  const s = history.state as { wbIndex?: unknown } | null;
  return typeof s?.wbIndex === 'number' ? s.wbIndex : 0;
};

const navigate = (to: string, opts: { replace?: boolean; state?: unknown } = {}) =>
  hashNavigate(to, { replace: !!opts.replace, state: { wbIndex: opts.replace ? indexNow() : indexNow() + 1 } });

export const useAppLocation = Object.assign((opts?: { ssrPath?: string }): [string, typeof navigate] => [useHashLocation(opts)[0], navigate], {
  // How links are written, as wouter's own hash hook does.
  hrefs: (href: string) => `#${href}`,
});

/**
 * A link that goes where wouter's `Link` goes, the same way (a numbered entry), but does not follow the location
 * itself: `Link` re-renders on every page change, which adds up for the hundreds of rows in the outline.
 */
export function NavLink({ href, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={`#${href}`} onClick={click} {...rest} />;
}

/** Whether going back stays in the app. */
export const canGoBack = () => indexNow() > 0;

/**
 * Back to the page before, wherever that was (a deck, an exercise, the help);
 * to `fallback` if there was none in the app.
 */
export function BackLink({ fallback, label, className, children }: { fallback: string; label: string; className?: string; children?: React.ReactNode }) {
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !canGoBack()) return;
    e.preventDefault();
    history.back();
  };
  return (
    <a
      href={`#${fallback}`}
      onClick={onClick}
      aria-label={children ? undefined : label}
      title={label}
      className={clsx(children ? 'inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink' : 'inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink', className)}
    >
      <ArrowLeft size={children ? 15 : 17} /> {children}
    </a>
  );
}
