import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { EarnedEvent, Outline } from '@wb/shared';
import { createMeadow, type Meadow as Engine, type Selection } from './meadow/engine';
import type { Friend, TraceId } from './meadow/types';
import { useT } from '@/lib/i18n';

/** Which achievement leaves which trace in the meadow: habits, never speed. */
const TRACE_OF: Record<string, TraceId> = { 'note-taker': 'nest', curious: 'ring', adventurer: 'dandelion', persistent: 'rockflower' };

/**
 * The friends in the order they arrived. What was collected stays, even if a course update has
 * since removed the exercise; then the chapter is unknown.
 */
export function meadowFriends(outline: Outline, earned: EarnedEvent[]) {
  const where = new Map<string, { title: string; chapter: string }>();
  let total = 0;
  for (const c of outline.chapters)
    for (const i of c.items)
      if (i.type === 'exercise' && i.startHere && i.emoji) { total++; where.set(i.id, { title: i.title, chapter: c.title }); }
  const friends: Friend[] = [];
  for (const { event } of [...earned].sort((a, b) => a.earnedAt - b.earnedAt)) {
    if (event.kind !== 'animal') continue;
    const w = where.get(event.exerciseId);
    friends.push({ id: event.exerciseId, title: w?.title ?? event.title, chapter: w?.chapter ?? '', emoji: event.emoji });
  }
  return { friends, total: Math.max(total, friends.length) };
}

/** The animal friends, living in a meadow you can look around in. */
export function Meadow({ outline, earned }: { outline: Outline; earned: EarnedEvent[] }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [zoom, setZoom] = useState({ in: true, out: false });
  const [caption, setCaption] = useState<string | null>(null);

  const { friends, total } = useMemo(() => meadowFriends(outline, earned), [outline, earned]);
  const traces = useMemo(() => {
    const has = new Set(earned.flatMap((e) => (e.event.kind === 'achievement' ? [e.event.id] : [])));
    const out: Record<TraceId, boolean> = { nest: false, ring: false, dandelion: false, rockflower: false };
    for (const [id, trace] of Object.entries(TRACE_OF)) if (has.has(id)) out[trace] = true;
    return out;
  }, [earned]);

  useEffect(() => {
    const e = createMeadow({
      canvas: canvas.current!,
      popover: popover.current!,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      onSelect: setSelection,
      onZoom: setZoom,
    });
    engine.current = e;
    return () => { e.destroy(); engine.current = null; };
  }, []);

  useEffect(() => {
    const result = engine.current?.set(friends, total, traces);
    const last = result?.arrived.at(-1);
    const friend = last ? friends.find((f) => f.id === last) : undefined;
    if (!result || !friend) return;
    setCaption([t.animalJoined(friend.emoji), result.grew ? t.meadowGrew : ''].join(' ').trim());
    const timer = setTimeout(() => setCaption(null), 4000);
    return () => clearTimeout(timer);
  }, [friends, total, traces, t]);

  const friend = selection?.kind === 'friend' ? friends.find((f) => f.id === selection.id) : undefined;
  return (
    <div className="relative mt-3 overflow-hidden rounded-xl border border-line bg-sunk">
      <canvas
        ref={canvas}
        tabIndex={0}
        role="img"
        aria-label={t.meadowLabel}
        className="block w-full cursor-grab touch-pan-y focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-accent data-dragging:cursor-grabbing"
      />
      <div className="absolute right-2.5 top-2.5 flex flex-col overflow-hidden rounded-lg border border-line bg-sheet/90 shadow-[var(--shadow)]">
        {(['in', 'out'] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            aria-label={dir === 'in' ? t.zoomIn : t.zoomOut}
            title={dir === 'in' ? t.zoomIn : t.zoomOut}
            disabled={!zoom[dir]}
            onClick={() => engine.current?.zoom(dir === 'in' ? 1.25 : 1 / 1.25)}
            className="grid size-[30px] place-items-center text-[17px] leading-none text-ink hover:bg-accent-soft disabled:text-ink-3 disabled:hover:bg-transparent [&+&]:border-t [&+&]:border-line"
          >
            {dir === 'in' ? '+' : '−'}
          </button>
        ))}
      </div>
      {caption ? (
        <div role="status" className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-16rem)] rounded-full bg-sheet/90 px-3 py-1 text-[13px] shadow-[var(--shadow)]">
          {caption}
        </div>
      ) : null}
      <div
        ref={popover}
        hidden={!selection}
        style={{ visibility: 'hidden' }}
        className="absolute z-10 flex w-[12.5rem] max-w-[calc(100%-16px)] flex-col gap-px rounded-lg border border-line bg-sheet px-2.5 pb-2 pt-1.5 text-[12.5px] leading-snug shadow-[var(--shadow)]"
      >
        {selection?.kind === 'friend' ? (
          <>
            <strong className="text-[13.5px] font-semibold">
              {selection.emoji} {selection.sprite === 'emoji' ? '' : t.meadowAnimals[selection.sprite]}
              {selection.count > 1 ? `, ${t.friendOneOf(selection.count, t.meadowVariants[selection.variant])}` : ''}
            </strong>
            {friend ? <span className="text-ink-2">{t.friendJoined(friend.title, friend.chapter || null)}{selection.asleep ? ` ${t.friendAsleep}` : ''}</span> : null}
            <Link href={`/item/${selection.id}`} className="mt-0.5 font-medium text-accent hover:underline">
              {t.openExercise}
            </Link>
          </>
        ) : selection?.kind === 'trace' ? (
          <>
            <strong className="text-[13.5px] font-semibold">{t.meadowTraces[selection.trace].name}</strong>
            <span className="text-ink-2">{t.meadowTraces[selection.trace].why}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
