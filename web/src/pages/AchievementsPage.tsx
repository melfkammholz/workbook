import { Lock, Trophy } from 'lucide-react';
import { ACHIEVEMENTS } from '@wb/shared';
import { AnimalCollection } from '@/components/AnimalCollection';
import { describeEvent } from '@/components/Celebration';
import { Plant } from '@/components/Plant';
import { Empty, clsx } from '@/components/ui';
import { useAchievements, useOutline, useSettings } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';

/** Everything earned in this course. It only ever grows. */
export function AchievementsPage() {
  const t = useT();
  const settings = useSettings().data;
  const outline = useOutline().data;
  const earned = useAchievements().data?.earned ?? [];
  if (!settings?.showAchievements) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.achievementsOffTitle}>{t.achievementsOffBody}</Empty>
      </div>
    );
  }
  const has = new Set(earned.flatMap((e) => (e.event.kind === 'achievement' ? [e.event.id] : [])));
  const comebacks = earned.filter((e) => e.event.kind === 'comeback');
  const shown = ACHIEVEMENTS.filter((a) => !a.hidden || has.has(a.id));
  const hiddenLeft = ACHIEVEMENTS.filter((a) => a.hidden && !has.has(a.id)).length;
  return (
    <div className="h-full overflow-y-auto">
      <div className="settle mx-auto max-w-3xl px-6 pb-24 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.achievements}</h1>
        <p className="mt-2 max-w-prose text-ink-2">{t.achievementsIntro}</p>

        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {shown.map((a) => {
            const on = has.has(a.id);
            const text = t.achievementList[a.id]!;
            return (
              <li key={a.id} className={clsx('flex items-start gap-3 rounded-lg border p-3.5', on ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-sheet opacity-60')}>
                {on ? <Trophy size={17} className="mt-0.5 shrink-0 text-accent" aria-label={t.achievementEarned} /> : <Lock size={15} className="mt-1 shrink-0 text-ink-3" aria-label={t.achievementOpen} />}
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold">{text.title}</span>
                  <span className="block text-[13.5px] text-ink-2">{text.body}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {hiddenLeft ? <p className="mt-3 text-[13.5px] text-ink-3">{t.achievementsHidden(hiddenLeft)}</p> : null}

        {outline ? <AnimalCollection outline={outline} earned={earned} /> : null}

        <section className="mt-10">
          <h2 className="text-[15px] font-semibold">{t.comebacks}</h2>
          <p className="mt-0.5 text-[13.5px] text-ink-2">{t.comebacksBody}</p>
          {comebacks.length ? (
            <ul className="mt-3 space-y-2">
              {comebacks.map((e) => (
                <li key={e.key} className="rounded-lg border border-line bg-sheet px-4 py-2.5 text-sm">
                  {describeEvent(t, e.event).body}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-3">{t.comebacksNone}</p>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-[15px] font-semibold">{t.chapters}</h2>
          <p className="mt-0.5 text-[13.5px] text-ink-2">{t.plantsBody}</p>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-sheet">
            {outline?.chapters.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                {c.title}
                <Plant chapterId={c.id} className="text-lg leading-none" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
