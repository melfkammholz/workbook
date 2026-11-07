import { Flag } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { focusOf, inFocus, type ItemMeta, type StudentState, type ThreadInfo } from '@wb/shared';
import { statusOf } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { StatusMark, clsx } from './ui';

const NODE = 44;
const LABEL = 54;
/** One stop: the circle and its title. */
const STOP = NODE + LABEL;
const OPTION_GAP = 10;
const ROW_GAP = 30;
/** Every other stop sits a little lower, so a row reads as a winding route. */
const WIND = 18;
const MIN_SLOT = 150;
const CHOICE_LABEL = 20;

interface Placed {
  id: string;
  step: number;
  /** Centre of the circle. */
  x: number;
  y: number;
}

/**
 * Where everything goes: rows of stops that run back and forth, so the route never
 * jumps across the page, or a single zigzag column when there is no room for rows.
 */
export function layOut(steps: string[][], width: number): { stops: Placed[]; choices: { step: number; x: number; y: number }[]; height: number; slot: number } {
  const columns = Math.max(1, Math.min(steps.length, Math.floor(width / MIN_SLOT)));
  const slot = width / columns;
  const narrow = columns === 1;
  const stops: Placed[] = [];
  const choices: { step: number; x: number; y: number }[] = [];
  let top = 0;

  for (let row = 0; row * columns < steps.length; row++) {
    const inRow = steps.slice(row * columns, (row + 1) * columns);
    const tallest = Math.max(...inRow.map((options) => options.length * (STOP + OPTION_GAP) - OPTION_GAP + (options.length > 1 ? CHOICE_LABEL : 0)));
    inRow.forEach((options, i) => {
      const step = row * columns + i;
      const column = row % 2 === 0 ? i : columns - 1 - i;
      const x = narrow ? width * (step % 2 === 0 ? 0.32 : 0.68) : slot * (column + 0.5);
      const own = options.length * (STOP + OPTION_GAP) - OPTION_GAP + (options.length > 1 ? CHOICE_LABEL : 0);
      const start = top + (tallest - own) / 2 + (!narrow && step % 2 === 1 ? WIND : 0);
      if (options.length > 1) choices.push({ step, x, y: start });
      options.forEach((id, n) => stops.push({ id, step, x, y: start + (options.length > 1 ? CHOICE_LABEL : 0) + n * (STOP + OPTION_GAP) + NODE / 2 }));
    });
    top += tallest + (narrow ? 0 : WIND) + ROW_GAP;
  }
  return { stops, choices, height: top - ROW_GAP, slot };
}

/** A curve between two stops: gently bent along a row, and an S between rows. */
function curve(a: Placed, b: Placed): string {
  if (Math.abs(a.y - b.y) > NODE * 1.5) {
    const middle = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} C ${a.x} ${middle}, ${b.x} ${middle}, ${b.x} ${b.y}`;
  }
  const bend = a.step % 2 === 0 ? 14 : -14;
  return `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + bend} ${b.x} ${b.y}`;
}

/** The way through an adventure. Everything stays clickable: this shows the suggested order, and locks nothing. */
export function AdventureMap({ thread, byId, state }: { thread: ThreadInfo; byId: Map<string, ItemMeta>; state: StudentState | undefined }) {
  const t = useT();
  const host = useRef<HTMLOListElement>(null);
  const [width, setWidth] = useState(640);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const steps = useMemo(() => thread.steps.map((s) => s.filter((id) => byId.has(id))).filter((s) => s.length > 0), [thread, byId]);
  const { stops, choices, height, slot } = useMemo(() => layOut(steps, width), [steps, width]);
  const done = (id: string) => statusOf(state, id) === 'done';
  const current = steps.findIndex((options) => !options.some(done));
  const labelWidth = Math.min(slot - 12, 190);

  return (
    <ol ref={host} className="relative" style={{ height }} aria-label={t.adventurePath}>
      <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width="100%" height={height}>
        {stops.flatMap((from) =>
          stops
            .filter((to) => to.step === from.step + 1)
            .map((to) => (
              <path
                key={`${from.id}-${to.id}`}
                d={curve(from, to)}
                fill="none"
                strokeWidth={2.5}
                strokeLinecap="round"
                stroke={done(from.id) ? 'var(--done)' : 'var(--line-strong)'}
                strokeDasharray={done(from.id) ? undefined : '2 8'}
              />
            )),
        )}
      </svg>

      {choices.map((c) => (
        <li key={`choice-${c.step}`} aria-hidden className="absolute -translate-x-1/2 whitespace-nowrap rounded bg-paper px-1 text-xs text-ink-3" style={{ left: c.x, top: c.y }}>
          {t.pickAny}
        </li>
      ))}

      {stops.map((stop) => {
        const item = byId.get(stop.id)!;
        const status = statusOf(state, stop.id);
        const here = stop.step === current;
        const finale = thread.finale === stop.id;
        const emoji = item.type === 'exercise' && item.startHere ? item.emoji : null;
        // Cutting steps would break the story, so they stay, faded but reachable.
        const outside = item.type === 'exercise' && !inFocus(item, focusOf(state));
        return (
          <li key={stop.id} className="absolute" style={{ left: stop.x - labelWidth / 2, top: stop.y - NODE / 2, width: labelWidth }}>
            <Link
              href={`/item/${stop.id}`}
              aria-current={here ? 'step' : undefined}
              title={item.title}
              aria-label={`${item.title}: ${finale ? `${t.finale}, ` : ''}${here ? `${t.youAreHere}, ` : ''}${t.status[status]}${outside ? `, ${t.outsideFocus}` : ''}`}
              className={clsx('group flex flex-col items-center text-center focus:outline-none', outside && !here && 'opacity-55 hover:opacity-100 focus-visible:opacity-100')}
            >
              <span
                className={clsx(
                  'relative grid place-items-center rounded-full border-2 bg-sheet transition-transform group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-accent',
                  here ? 'border-accent ring-4 ring-accent-soft' : status === 'done' ? 'border-done' : 'border-line-strong',
                )}
                style={{ width: NODE, height: NODE }}
              >
                {finale && status !== 'done' ? <Flag size={19} className={here ? 'text-accent' : 'text-ink-2'} /> : <StatusMark status={status} size={20} />}
                {emoji ? <span aria-hidden className="absolute -bottom-1 -right-2 text-[15px] leading-none">{emoji}</span> : null}
              </span>
              {/* On the page's colour, so the route passes behind the words instead of through them. */}
              <span className="mt-1.5 rounded bg-paper px-1">
                <span className={clsx('line-clamp-2 text-[13px] leading-tight group-hover:underline', here || finale ? 'font-semibold' : status === 'done' ? 'text-ink-2' : '')}>{item.title}</span>
                {here || finale ? <span className={clsx('block text-xs leading-tight', here ? 'font-medium text-accent' : 'text-ink-3')}>{here ? t.youAreHere : t.finale}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
