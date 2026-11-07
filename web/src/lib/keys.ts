import { useEffect, useRef } from 'react';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** How Ctrl (or ⌘) is written in a hint. */
export const modKey = isMac ? '⌘' : 'Ctrl';
/** How Alt (or ⌥) is written in a hint. */
export const altKey = isMac ? '⌥' : 'Alt';

/** Whether a key goes into text: then single-letter shortcuts must leave it alone. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable=true], .cm-editor');
}

const dialogOpen = () => !!document.querySelector('[role=dialog]');

/**
 * Single keys, as on many sites (`?`, `g` then `h`), only while nothing is being typed
 * and no dialog is open. `handlers` maps a key (`e.key`) to what it does; a key that
 * starts with `g ` is the second key after `g`. Returns nothing; reads the newest handlers.
 */
export function usePageKeys(handlers: Record<string, ((e: KeyboardEvent) => void) | undefined>, enabled = true): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    let prefix: number | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isTyping(e.target) || dialogOpen()) return;
      const sequence = prefix !== null && Date.now() - prefix < 1200;
      prefix = null;
      const fn = ref.current[sequence ? `g ${e.key}` : e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      } else if (e.key === 'g' && !sequence && Object.keys(ref.current).some((k) => k.startsWith('g '))) {
        prefix = Date.now();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [enabled]);
}

const scrollable = (el: Element) => {
  const style = getComputedStyle(el);
  return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
};

/** The pane `j` and `k` scroll: the one around the focus, else the biggest one in the main area. */
function scrollTarget(): Element | null {
  for (let el = document.activeElement; el && el !== document.body; el = el.parentElement) if (scrollable(el)) return el;
  const panes = [...document.querySelectorAll('main *')].filter(scrollable);
  return panes.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? document.scrollingElement;
}

const TOP_SPEED = 1100; // px per second while held
const EASE = 9; // how fast the speed follows, per second
const MIN_STEP = 45; // a tap goes on this far before slowing down (about 120px in all)

let glide: { el: Element; dir: 1 | -1; held: boolean; v: number; pos: number; travelled: number; last: number } | null = null;

function frame(now: number) {
  const g = glide;
  if (!g) return;
  const dt = Math.min(0.05, (now - g.last) / 1000);
  g.last = now;
  const wanted = g.held || g.travelled < MIN_STEP ? TOP_SPEED : 0;
  g.v += (wanted - g.v) * Math.min(1, dt * EASE);
  const max = g.el.scrollHeight - g.el.clientHeight;
  g.pos = Math.max(0, Math.min(max, g.pos + g.dir * g.v * dt));
  g.travelled += g.v * dt;
  g.el.scrollTop = g.pos;
  const atEnd = g.pos <= 0 || g.pos >= max;
  if ((!g.held && g.v < 15) || atEnd) glide = null;
  else requestAnimationFrame(frame);
}

const release = (e: KeyboardEvent | FocusEvent) => {
  if (glide && (!('key' in e) || e.key === 'j' || e.key === 'k')) glide.held = false;
};
let listening = false;

/**
 * `j` and `k`: the page glides while the key is held, speeding up and slowing down
 * smoothly, and a tap moves a short step. Key repeats only keep it going.
 */
export function scrollPage(direction: 1 | -1, repeat: boolean): void {
  if (!listening) {
    listening = true;
    addEventListener('keyup', release);
    addEventListener('blur', release);
  }
  if (glide && glide.dir === direction) {
    glide.held = true;
    return;
  }
  if (repeat && glide) return;
  const el = scrollTarget();
  if (!el) return;
  const start = !glide;
  // Turning around keeps no speed, so it never jerks.
  glide = { el, dir: direction, held: true, v: 0, pos: el.scrollTop, travelled: 0, last: performance.now() };
  if (start) requestAnimationFrame(frame);
}
