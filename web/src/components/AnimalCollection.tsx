import { useMemo } from 'react';
import { Link } from 'wouter';
import type { EarnedEvent, ExerciseMeta, Outline } from '@wb/shared';
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
export function AnimalCollection({ outline, earned }: { outline: Outline; earned: EarnedEvent[] }) {
  const t = useT();
  const groups = useMemo(() => groupAnimals(outline, earned), [outline, earned]);
  const all = groups.flatMap((g) => g.members);
  if (all.length === 0) return null;
  const count = (g: Group) => g.members.filter((m) => m.collected).length;
  // What is complete first, then what has been started, then what is still missing.
  const ordered = [...groups].sort((a, b) => Number(count(b) === b.members.length) - Number(count(a) === a.members.length) || count(b) - count(a));

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t.animals}</h2>
        <span className="text-[13px] tabular-nums text-ink-2">{t.animalsCount(all.filter((m) => m.collected).length, all.length)}</span>
      </div>
      <p className="mt-0.5 text-[13.5px] text-ink-2">{t.animalsBody}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {ordered.map((g) => {
          const have = count(g);
          const next = g.members.find((m) => !m.collected && m.inCourse) ?? g.members.find((m) => m.inCourse);
          const inner = (
            <>
              <span className={clsx('text-[1.6rem] leading-none', have === 0 && 'opacity-35 grayscale')}>{g.emoji}</span>
              {g.members.length > 1 ? <span className="text-[11px] tabular-nums text-ink-3">{have === g.members.length ? `×${have}` : `${have}/${g.members.length}`}</span> : null}
            </>
          );
          const label = `${g.emoji}: ${g.members.map((m) => `${m.title} (${m.collected ? t.animalCollected : t.animalMissing})`).join(', ')}`;
          const box = clsx('flex size-14 flex-col items-center justify-center gap-0.5 rounded-lg border', have ? 'border-accent/40 bg-accent-soft/40' : 'border-dashed border-line-strong bg-sheet');
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
