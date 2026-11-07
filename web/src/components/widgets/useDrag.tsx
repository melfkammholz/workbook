import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from '../ui';

/**
 * Drag pieces onto targets with mouse, pen or finger. A piece that is clicked instead is selected, and
 * a click on a target then places it, which is also how it works with the keyboard.
 * Targets carry `data-drop="<key>"`; `onDrop` decides whether the piece fits.
 */
export function useDrag(onDrop: (piece: number, target: string, el: HTMLElement) => void) {
  const [selected, setSelected] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ piece: number; x: number; y: number; dx: number; dy: number; width: number; html: string } | null>(null);
  const start = useRef<{ piece: number; x: number; y: number; el: HTMLElement } | null>(null);
  const hot = useRef<HTMLElement | null>(null);
  const dragged = useRef(false);

  const targetAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]:not(:disabled)') ?? null;
  const setHot = (el: HTMLElement | null) => {
    if (hot.current === el) return;
    hot.current?.removeAttribute('data-hot');
    el?.setAttribute('data-hot', '');
    hot.current = el;
  };

  const piece = (id: number) => ({
    'aria-pressed': selected === id,
    'data-dragging': ghost?.piece === id ? '' : undefined,
    style: { touchAction: 'none' as const },
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragged.current = false;
      start.current = { piece: id, x: e.clientX, y: e.clientY, el: e.currentTarget };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || s.piece !== id) return;
      if (!dragged.current) {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
        dragged.current = true;
        const r = s.el.getBoundingClientRect();
        setSelected(id);
        setGhost({ piece: id, x: e.clientX, y: e.clientY, dx: s.x - r.left, dy: s.y - r.top, width: r.width, html: s.el.innerHTML });
      } else setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g));
      setHot(targetAt(e.clientX, e.clientY));
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      if (!s || !dragged.current) return;
      const target = targetAt(e.clientX, e.clientY);
      setHot(null);
      setGhost(null);
      setSelected(null);
      if (target) onDrop(id, target.dataset.drop!, target);
    },
    onPointerCancel: () => {
      start.current = null;
      setHot(null);
      setGhost(null);
    },
    onClick: () => {
      // The click that ends a drag is not a selection.
      if (dragged.current) {
        dragged.current = false;
        return;
      }
      setSelected((s) => (s === id ? null : id));
    },
  });

  /** For a target: a click places the selected piece. */
  const target = (key: string) => ({
    'data-drop': key,
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (selected === null) return;
      const p = selected;
      setSelected(null);
      onDrop(p, key, e.currentTarget);
    },
  });

  const layer = ghost
    ? createPortal(
        <div
          aria-hidden
          className={clsx('pointer-events-none fixed left-0 top-0 z-50 rounded-md border border-accent bg-sheet px-2.5 py-1 font-mono text-[13.5px] shadow-[var(--shadow)]')}
          style={{ width: ghost.width, transform: `translate(${ghost.x - ghost.dx}px, ${ghost.y - ghost.dy}px) rotate(-2deg)` }}
          dangerouslySetInnerHTML={{ __html: ghost.html }}
        />,
        document.body,
      )
    : null;

  return { selected, setSelected, piece, target, layer, dragging: ghost !== null };
}
