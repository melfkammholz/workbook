import { Clock, Compass, Flame, ListChecks } from 'lucide-react';
import { useOutline, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Level } from './ui';

/** Everything a marker in the outline or on an exercise can mean, in one place. */
export function Legend() {
  const t = useT();
  const outline = useOutline().data;
  const achievementsOn = !!useSettings().data?.showAchievements;
  const tags = outline?.tags.filter((tag) => tag.description) ?? [];
  const rows: [React.ReactNode, string, string][] = [
    ...([1, 2, 3] as const).map((l): [React.ReactNode, string, string] => [<Level key={l} level={l} />, [t.easy, t.medium, t.hard][l - 1]!, t.legendLevels[l - 1]!]),
    [<Flame key="c" size={14} className="text-review" />, t.challenge, t.legendChallenge],
    [<Clock key="l" size={14} className="text-ink-3" />, t.takesAWhile, t.legendLong],
    [<span key="e">🦔</span>, t.recommendedFirst, t.legendEmoji],
    [<Compass key="a" size={14} className="text-accent" />, t.adventure, t.legendAdventure],
    [<ListChecks key="s" size={14} className="text-ink-3" />, t.legendChecklistName, t.legendChecklist],
    ...(achievementsOn ? ([[<span key="p">🌿</span>, t.legendPlantName, t.plantsBody]] as [React.ReactNode, string, string][]) : []),
  ];
  return (
    <section>
      <h3 className="font-semibold">{t.legendTitle}</h3>
      <dl className="mt-2 divide-y divide-line rounded-lg border border-line">
        {rows.map(([mark, name, meaning]) => (
          <div key={name} className="grid items-baseline gap-x-3 gap-y-0.5 px-3 py-2 sm:grid-cols-[1.5rem_9rem_1fr]">
            <span aria-hidden className="hidden sm:inline-flex sm:justify-center">
              {mark}
            </span>
            <dt className="font-medium">{name}</dt>
            <dd className="text-ink-2">{meaning}</dd>
          </div>
        ))}
      </dl>
      {tags.length ? (
        <>
          <h4 className="mt-3 text-[13px] font-semibold text-ink-2">{t.legendTags}</h4>
          <dl className="mt-1 divide-y divide-line rounded-lg border border-line">
            {tags.map((tag) => (
              <div key={tag.id} className="grid gap-x-3 gap-y-0.5 px-3 py-2 sm:grid-cols-[10.75rem_1fr]">
                <dt className="font-medium">{tag.label}</dt>
                <dd className="text-ink-2">{tag.description}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </section>
  );
}
