import { createContext, useContext, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';

/*
 * Panels side by side or on top of each other, with separators to drag between them. Sizes are flex values set while
 * rendering, so a page with panels is laid out once and nothing is measured until a separator is dragged. (A library
 * did this before; it measured and set state while mounting, which drew an exercise page twice before it painted.)
 *
 * A size is a percent of the group (as a flex-grow, so the percent panels share what is left) or, when collapsed or
 * given as a number, fixed pixels. A separator resizes the panels just before and after it.
 */

type Orientation = 'horizontal' | 'vertical';
type Size = { pct: number } | { px: number };

export interface PanelHandle {
  collapse(): void;
  expand(): void;
  isCollapsed(): boolean;
}

export const usePanelRef = () => useRef<PanelHandle | null>(null);

/** What a separator needs of its neighbours, found from their elements. */
interface Controller {
  size(): Size;
  set(size: Size): void;
  minPct: () => number;
  collapsible: () => boolean;
  collapsedPx: () => number;
}
const controllers = new WeakMap<Element, Controller>();

const OrientationContext = createContext<Orientation>('horizontal');

export function Group({ orientation, className, children }: { orientation: Orientation; className?: string; children: ReactNode }) {
  return (
    <OrientationContext.Provider value={orientation}>
      <div data-group="" className={className} style={{ display: 'flex', flexDirection: orientation === 'horizontal' ? 'row' : 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
        {children}
      </div>
    </OrientationContext.Provider>
  );
}

const parse = (s: string | number | undefined): Size => (typeof s === 'number' ? { px: s } : { pct: s === undefined ? 50 : Number(s) });

export function Panel({
  defaultSize,
  minSize,
  collapsible,
  collapsedSize = 0,
  panelRef,
  onResize,
  children,
}: {
  /** A percent as a string, or pixels as a number. Read when the panel mounts. */
  defaultSize?: string | number;
  /** A percent. */
  minSize?: string;
  collapsible?: boolean;
  /** Pixels. */
  collapsedSize?: number;
  panelRef?: RefObject<PanelHandle | null>;
  /** After every change of size (not when mounting). */
  onResize?: () => void;
  children?: ReactNode;
}) {
  const [size, setSizeState] = useState<Size>(() => parse(defaultSize));
  const props = useRef({ defaultSize, minSize, collapsible, collapsedSize, onResize });
  props.current = { defaultSize, minSize, collapsible, collapsedSize, onResize };
  const current = useRef(size);
  /** The percent before collapsing, to go back to. */
  const open = useRef<number | null>('pct' in size ? size.pct : null);

  const ctl = useRef<Controller>(null!);
  ctl.current ??= {
    size: () => current.current,
    set: (s) => {
      const was = current.current;
      if ('pct' in was && 'px' in s) open.current = was.pct;
      current.current = s;
      setSizeState(s);
      props.current.onResize?.();
    },
    minPct: () => Number(props.current.minSize ?? 0),
    collapsible: () => !!props.current.collapsible,
    collapsedPx: () => props.current.collapsedSize ?? 0,
  };
  const isCollapsed = () => !!props.current.collapsible && 'px' in current.current && current.current.px === (props.current.collapsedSize ?? 0);
  useImperativeHandle(
    panelRef,
    () => ({
      isCollapsed,
      collapse: () => {
        if (!isCollapsed()) ctl.current.set({ px: props.current.collapsedSize ?? 0 });
      },
      expand: () => {
        if (!isCollapsed()) return;
        const d = props.current.defaultSize;
        ctl.current.set({ pct: open.current ?? (typeof d === 'string' ? Number(d) : 50) });
      },
    }),
    // The handle reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div
      data-panel=""
      ref={(el) => {
        if (el) controllers.set(el, ctl.current);
      }}
      style={{ display: 'flex', minWidth: 0, minHeight: 0, overflow: 'visible', flex: 'pct' in size ? `${size.pct} 1 0px` : `0 0 ${size.px}px` }}
    >
      <div style={{ flexGrow: 1, maxWidth: '100%', maxHeight: '100%', overflow: 'auto' }}>{children}</div>
    </div>
  );
}

/** Gives `before` the size `want` (pixels) out of the `sum` the two have, within their minimums; below half a minimum, a collapsible panel collapses. */
function resize(before: Controller, after: Controller, want: number, sum: number, total: number) {
  const fit = (c: Controller, px: number): { px: number; collapsed: boolean } => {
    const min = (c.minPct() / 100) * total;
    if (px >= min) return { px, collapsed: false };
    if (c.collapsible() && px < (min + c.collapsedPx()) / 2) return { px: c.collapsedPx(), collapsed: true };
    return { px: min, collapsed: false };
  };
  let a = fit(before, Math.max(0, Math.min(sum, want)));
  const b = fit(after, sum - a.px);
  // The panel after keeps its minimum (or collapses); the one before gets the rest, unless that is below its own.
  if (a.px + b.px !== sum) {
    a = { px: sum - b.px, collapsed: false };
    if (a.px < (before.minPct() / 100) * total) return;
  }
  before.set(a.collapsed ? { px: a.px } : { pct: (a.px / total) * 100 });
  after.set(b.collapsed ? { px: b.px } : { pct: (b.px / total) * 100 });
}

/** Between two panels. Dragged with the pointer, or moved with the arrow keys once focused. */
export function Separator({ disabled, className, children }: { disabled?: boolean; className?: string; children?: ReactNode }) {
  const orientation = useContext(OrientationContext);
  const horizontal = orientation === 'horizontal';
  const neighbours = (sep: HTMLElement) => {
    const before = sep.previousElementSibling && controllers.get(sep.previousElementSibling);
    const after = sep.nextElementSibling && controllers.get(sep.nextElementSibling);
    if (!before || !after) return null;
    const length = (el: Element) => (horizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height);
    return { before, after, a: length(sep.previousElementSibling!), b: length(sep.nextElementSibling!), total: length(sep.parentElement!) };
  };
  const showValue = (sep: HTMLElement) => {
    const s = sep.previousElementSibling && controllers.get(sep.previousElementSibling)?.size();
    if (s && 'pct' in s) sep.setAttribute('aria-valuenow', String(Math.round(s.pct)));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const sep = e.currentTarget;
    const n = neighbours(sep);
    if (!n) return;
    e.preventDefault();
    sep.setPointerCapture(e.pointerId);
    const start = horizontal ? e.clientX : e.clientY;
    sep.setAttribute('data-separator', 'active');
    const cursor = document.body.style.cursor;
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    const move = (ev: globalThis.PointerEvent) => {
      resize(n.before, n.after, n.a + (horizontal ? ev.clientX : ev.clientY) - start, n.a + n.b, n.total);
      showValue(sep);
    };
    const up = () => {
      sep.removeEventListener('pointermove', move);
      sep.removeEventListener('pointerup', up);
      sep.removeEventListener('pointercancel', up);
      sep.removeAttribute('data-separator');
      document.body.style.cursor = cursor;
    };
    sep.addEventListener('pointermove', move);
    sep.addEventListener('pointerup', up);
    sep.addEventListener('pointercancel', up);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const forth = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (disabled || (e.key !== back && e.key !== forth)) return;
    const n = neighbours(e.currentTarget);
    if (!n) return;
    e.preventDefault();
    const step = n.total * 0.05 * (e.key === back ? -1 : 1);
    resize(n.before, n.after, n.a + step, n.a + n.b, n.total);
    showValue(e.currentTarget);
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? undefined : 0}
      ref={(el) => {
        if (el) showValue(el);
      }}
      onPointerDown={down}
      onKeyDown={key}
      className={className}
      style={{ cursor: disabled ? undefined : horizontal ? 'col-resize' : 'row-resize', touchAction: 'none' }}
    >
      {children}
    </div>
  );
}
