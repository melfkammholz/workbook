import * as DialogPrimitive from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Status } from '@wb/shared';
import { useT } from '@/lib/i18n';

export { clsx };

// ───────────────────────── buttons ─────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      type="button"
      {...p}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8.5 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
        variant === 'secondary' && 'border border-line-strong bg-sheet text-ink hover:bg-sunk',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunk hover:text-ink',
        className,
      )}
    />
  );
}

/** One choice out of a few, always visible. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-md bg-sunk p-0.5 text-sm">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={clsx('rounded px-3 py-1', value === v ? 'bg-sheet font-medium shadow-sm' : 'text-ink-2')}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({ label, children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        {...p}
        className={clsx('inline-flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-sunk hover:text-ink disabled:opacity-40', className)}
      >
        {children}
      </button>
    </Tip>
  );
}

/**
 * A tooltip over its one child, which must pass `data-tip` on to its element (elements, `Link`, Radix triggers do).
 * Nothing is mounted per tip: one `TipLayer` finds `[data-tip]` under the pointer or focus, so a page full of icon
 * buttons costs nothing extra to render.
 */
export function Tip({ label, children }: { label: string; children: ReactElement<{ 'data-tip'?: string }> }) {
  return cloneElement(children, { 'data-tip': label });
}

const TIP_DELAY = 400;
/** Moving from one tip to the next within this shows the next at once. */
const TIP_SKIP = 300;
const TIP_GAP = 6;

/** The one tooltip of the app, mounted once at the root. */
export function TipLayer() {
  const [tip, setTip] = useState<{ anchor: HTMLElement; label: string } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const tipId = useId();

  useEffect(() => {
    let timer = 0;
    let shown: HTMLElement | null = null;
    let pending: HTMLElement | null = null;
    let hiddenAt = 0;
    const show = (el: HTMLElement) => {
      pending = null;
      shown = el;
      setTip({ anchor: el, label: el.dataset.tip ?? '' });
    };
    const hide = () => {
      clearTimeout(timer);
      pending = null;
      if (shown) hiddenAt = performance.now();
      shown = null;
      setTip(null);
    };
    const want = (el: HTMLElement | null, now: boolean) => {
      if (el === shown || (el && el === pending && !now)) return;
      clearTimeout(timer);
      if (!el) return hide();
      if (now || shown || performance.now() - hiddenAt < TIP_SKIP) show(el);
      else {
        pending = el;
        timer = window.setTimeout(() => show(el), TIP_DELAY);
      }
    };
    const target = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null);
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') want(target(e), false);
    };
    const out = (e: PointerEvent) => {
      if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest('[data-tip]') === target(e))) want(null, false);
    };
    // Only keyboard focus shows a tip; a click focuses too and should not.
    const focusIn = (e: FocusEvent) => {
      const el = target(e);
      if (el?.matches(':focus-visible')) want(el, true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shown) hide();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    // A trigger that goes away (a page change) takes its tip with it.
    const gone = setInterval(() => {
      if (shown && !shown.isConnected) hide();
    }, 250);
    return () => {
      clearTimeout(timer);
      clearInterval(gone);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Above the trigger, or below when there is no room; kept inside the window.
  useLayoutEffect(() => {
    const b = bubble.current;
    if (!tip || !b) return;
    const a = tip.anchor.getBoundingClientRect();
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const top = a.top - TIP_GAP - h >= 4 ? a.top - TIP_GAP - h : a.bottom + TIP_GAP;
    const left = Math.min(Math.max(a.left + a.width / 2 - w / 2, 4), window.innerWidth - w - 4);
    b.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    b.style.visibility = 'visible';
    // Described by the tip, unless it only repeats the trigger's name.
    const describe = tip.anchor.getAttribute('aria-label') !== tip.label;
    if (describe) tip.anchor.setAttribute('aria-describedby', tipId);
    return () => {
      if (describe) tip.anchor.removeAttribute('aria-describedby');
    };
  }, [tip, tipId]);

  if (!tip) return null;
  return createPortal(
    <div ref={bubble} id={tipId} role="tooltip" style={{ visibility: 'hidden' }} className="pointer-events-none fixed left-0 top-0 z-50 max-w-xs rounded-md bg-ink px-2 py-1 text-xs text-paper shadow-md">
      {tip.label}
    </div>,
    document.body,
  );
}

// ───────────────────────── dialog ─────────────────────────

/**
 * Grows and shrinks smoothly with what is inside: a banner that appears, a preview that comes, fields that change.
 * The first size is taken as it is, so opening is not slowed down.
 */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || typeof ResizeObserver === 'undefined') return;
    let last = -1;
    let settle = 0;
    const ro = new ResizeObserver(() => {
      const h = i.offsetHeight;
      if (h === last) return;
      if (last < 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        o.style.height = '';
        o.style.overflow = '';
      } else {
        // From where it is now to where it goes; afterwards the height is free again, so nothing gets cut off.
        o.style.overflow = 'clip';
        // Mid-way through a change it starts from where it is; otherwise from the size it had before.
        const from = o.style.height ? o.offsetHeight : last;
        o.style.transition = 'none';
        o.style.height = `${from}px`;
        void o.offsetHeight;
        o.style.transition = '';
        o.style.height = `${h}px`;
        clearTimeout(settle);
        settle = window.setTimeout(() => {
          o.style.height = '';
          o.style.overflow = '';
        }, 240);
      }
      last = h;
    });
    ro.observe(i);
    return () => {
      ro.disconnect();
      clearTimeout(settle);
    };
  }, []);
  return (
    <div ref={outer} className={clsx('wb-autoheight', className)}>
      <div ref={inner} className="flow-root">
        {children}
      </div>
    </div>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: string;
}) {
  const closeLabel = useT().close;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="wb-overlay fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={clsx('wb-dialog fixed left-1/2 top-[12vh] z-50 max-h-[78vh] w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-xl border border-line-strong bg-sheet p-6 shadow-[var(--shadow)]', width)}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-sm text-ink-2">{description}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close className="-mr-2 -mt-1 rounded-md p-1.5 text-ink-3 hover:bg-sunk hover:text-ink" aria-label={closeLabel}>
              <X size={18} />
            </DialogPrimitive.Close>
          </div>
          <AutoHeight>{children}</AutoHeight>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ───────────────────────── small marks ─────────────────────────

/**
 * Progress glyph. These are the stops on the outline's thread, so they are
 * distinguishable by shape and not only by colour: ring, half-filled ring,
 * solid disc with a tick, amber diamond.
 */
export function StatusMark({ status, size = 14, className }: { status: Status; size?: number; className?: string }) {
  const t = useT();
  const common = { width: size, height: size, viewBox: '0 0 16 16', className, role: 'img', 'aria-label': t.status[status] } as const;
  switch (status) {
    case 'done':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill="var(--done)" />
          <path d="M4.7 8.3l2.2 2.2 4.4-4.7" fill="none" stroke="var(--sheet)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.2" fill="var(--sheet)" stroke="var(--accent)" strokeWidth="1.6" />
          <path d="M8 1.8a6.2 6.2 0 0 0 0 12.4z" fill="var(--accent)" />
        </svg>
      );
    case 'review':
      return (
        <svg {...common}>
          <path d="M8 1.2l6.8 6.8L8 14.8 1.2 8z" fill="var(--review)" />
          <path d="M8 5v3.3l2 1.2" fill="none" stroke="var(--sheet)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.2" fill="var(--sheet)" stroke="var(--line-strong)" strokeWidth="1.6" />
        </svg>
      );
  }
}

/** Difficulty as three dots. */
export function Level({ level, className, compact }: { level: 1 | 2 | 3; className?: string; compact?: boolean }) {
  const t = useT();
  const name = [t.easy, t.medium, t.hard][level - 1];
  // Compact: only the filled dots, so a row of exercises reads as 1, 2 or 3 dots rather than a wall of grey.
  const dots = compact ? Array.from({ length: level }, (_, i) => i + 1) : [1, 2, 3];
  return (
    <span className={clsx('inline-flex items-center gap-[3px]', className)} role="img" aria-label={`${t.difficulty}: ${name}`} title={`${t.difficulty}: ${name}`}>
      {dots.map((n) => (
        <span key={n} className={clsx('size-[5px] rounded-full', n <= level ? 'bg-ink-3' : 'bg-line-strong')} />
      ))}
    </span>
  );
}

export function Chip({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'accent' | 'amber' | 'danger' | 'signal'; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'plain' && 'bg-sunk text-ink-2',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'amber' && 'bg-review-soft text-review',
        tone === 'danger' && 'bg-danger-soft text-danger',
        // Signals say what an exercise will be like; outlined so they do not read as topics.
        tone === 'signal' && 'border border-line-strong text-ink-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block size-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent', className)} aria-hidden />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">{children}</p> : null}
    </div>
  );
}

/** A number field with its own small stepper: the browser's spin buttons ignore the theme and come out dark. Commits on every step and on blur. */
export function NumberField({ value, min = 0, max, onCommit, className, ...rest }: { value: number; min?: number; max: number; onCommit: (n: number) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'>) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (n: number) => {
    const c = Math.max(min, Math.min(max, Math.round(n) || 0));
    setText(String(c));
    if (c !== value) onCommit(c);
  };
  const step = (d: number) => commit((Number(text) || 0) + d);
  const btn = 'flex h-1/2 w-5 items-center justify-center text-ink-3 hover:text-ink';
  return (
    <span className={clsx('relative inline-block', className)}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => commit(Number(text))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            step(e.key === 'ArrowUp' ? 1 : -1);
          } else if (e.key === 'Enter') commit(Number(text));
        }}
        className="wb-field h-8 w-full pl-2 pr-6 text-sm"
      />
      <span className="absolute inset-y-px right-px flex w-5 flex-col" aria-hidden>
        <button type="button" tabIndex={-1} className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => step(1)}>
          <ChevronUp size={12} />
        </button>
        <button type="button" tabIndex={-1} className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => step(-1)}>
          <ChevronDown size={12} />
        </button>
      </span>
    </span>
  );
}
