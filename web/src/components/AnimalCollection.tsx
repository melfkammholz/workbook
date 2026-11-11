import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'wouter';
import type { EarnedEvent, ExerciseMeta, Outline } from '@wb/shared';
import { Meadow } from './Meadow';
import { drawAnimal, fitTile, isDrawn } from './meadow/portrait';
import { clsx } from './ui';
import { useT } from '@/lib/i18n';

interface Group {
  emoji: string;
  /** Exercises this animal belongs to, with whether they have been collected. */
  members: { id: string; title: string; collected: boolean; inCourse: boolean }[];
}

/**
 * One entry per kind of animal: several exercises can have the same one. What was
 * collected stays, even if a course update has since removed or changed the exercise.
 */
export function groupAnimals(outline: Outline, earned: EarnedEvent[]): Group[] {
  const groups = new Map<string, Group>();
  const collected = new Set<string>();
  const add = (emoji: string, m: Group['members'][number]) => {
    const g = groups.get(emoji) ?? { emoji, members: [] };
    g.members.push(m);
    groups.set(emoji, g);
  };
  for (const { event } of earned) {
    if (event.kind !== 'animal') continue;
    collected.add(event.exerciseId);
    add(event.emoji, { id: event.exerciseId, title: event.title, collected: true, inCourse: false });
  }
  for (const e of outline.chapters.flatMap((c) => c.items)) {
    if (e.type !== 'exercise') continue;
    const ex: ExerciseMeta = e;
    if (!ex.startHere || !ex.emoji) continue;
    if (collected.has(ex.id)) {
      const known = [...groups.values()].flatMap((g) => g.members).find((m) => m.id === ex.id);
      if (known) known.inCourse = true;
    } else add(ex.emoji, { id: ex.id, title: ex.title, collected: false, inCourse: true });
  }
  return [...groups.values()];
}

/** Every animal of the course: what is collected, and, for the completionists, what is still out there. */
/** `alone`: the page is only about the animals, so its title already names them. */
export function AnimalCollection({ outline, earned, alone = false }: { outline: Outline; earned: EarnedEvent[]; alone?: boolean }) {
  const t = useT();
  const groups = useMemo(() => groupAnimals(outline, earned), [outline, earned]);
  const all = groups.flatMap((g) => g.members);
  if (all.length === 0) return null;
  const count = (g: Group) => g.members.filter((m) => m.collected).length;
  // What is complete first, then what has been started, then what is still missing.
  const ordered = [...groups].sort((a, b) => Number(count(b) === b.members.length) - Number(count(a) === a.members.length) || count(b) - count(a));

  return (
    <section className={alone ? 'mt-3' : 'mt-10'}>
      <div className="flex items-baseline justify-between gap-3">
        {alone ? <p className="max-w-prose text-ink-2">{t.animalsBody}</p> : <h2 className="text-[15px] font-semibold">{t.animals}</h2>}
        <span className="shrink-0 text-[13px] tabular-nums text-ink-2">{t.animalsCount(all.filter((m) => m.collected).length, all.length)}</span>
      </div>
      {alone ? null : <p className="mt-0.5 max-w-prose text-[13.5px] text-ink-2">{t.animalsBody}</p>}
      {earned.some((e) => e.event.kind === 'animal') ? (
        <>
          <Meadow outline={outline} earned={earned} />
          <p className="mt-1.5 text-[12.5px] text-ink-3">{t.meadowHint}</p>
        </>
      ) : null}
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
        {ordered.map((g, i) => {
          const have = count(g);
          const next = g.members.find((m) => !m.collected && m.inCourse) ?? g.members.find((m) => m.inCourse);
          const inner = (
            <>
              {isDrawn(g.emoji) ? (
                <Portrait emoji={g.emoji} seed={i * 1.7} still={have === 0} />
              ) : (
                <span className={clsx('absolute inset-x-0 top-[38%] -translate-y-1/2 text-center text-[1.6rem] leading-none', have === 0 && 'opacity-35 grayscale')}>{g.emoji}</span>
              )}
              {g.members.length > 1 ? (
                <span className={clsx('absolute inset-x-0 bottom-0.5 text-center text-[10.5px] leading-[13px] tabular-nums', have ? 'font-semibold text-leaf-2' : 'text-ink-3')}>
                  {have === g.members.length ? `×${have}` : `${have}/${g.members.length}`}
                </span>
              ) : null}
            </>
          );
          const label = `${g.emoji}: ${g.members.map((m) => `${m.title} (${m.collected ? t.animalCollected : t.animalMissing})`).join(', ')}`;
          // A friend you met stands on a strip of grass; one still out there is a faded shadow.
          const box = clsx(
            'relative block aspect-square overflow-hidden rounded-[10px] border',
            have ? 'wb-friend-met border-[color-mix(in_srgb,var(--leaf)_30%,var(--line))]' : 'wb-friend-not border-line bg-sheet',
          );
          return (
            <li key={g.emoji}>
              {next ? (
                <Link href={`/item/${next.id}`} title={label} aria-label={label} className={clsx(box, 'hover:border-accent')}>
                  {inner}
                </Link>
              ) : (
                <span title={label} aria-label={label} role="img" className={box}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Every portrait on the page, drawn in one animation loop. */
const portraits = new Set<(now: number) => void>();
let loop = 0;
const tick = (now: number) => {
  portraits.forEach((draw) => draw(now));
  loop = portraits.size ? requestAnimationFrame(tick) : 0;
};

/** A friend in its tile, drawn with the meadow's own drawing: small animals whole, big ones head first, cropped. */
function Portrait({ emoji, seed, still }: { emoji: string; seed: number; still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    const fit = fitTile(emoji, w, h);
    if (!fit) return;
    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(fit.x, fit.y);
      ctx.scale(fit.k, fit.k);
      drawAnimal(ctx, emoji, still ? 0 : now / 1000 + seed, { seed });
    };
    draw(0);
    if (still || reduced()) return;
    portraits.add(draw);
    if (!loop) loop = requestAnimationFrame(tick);
    return () => void portraits.delete(draw);
  }, [emoji, seed, still]);
  return <canvas ref={ref} aria-hidden className={clsx('absolute inset-x-0 top-0 h-[calc(100%-15px)] w-full', still && 'opacity-[0.22] brightness-[0.6] grayscale')} />;
}
