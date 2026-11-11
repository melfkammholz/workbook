import { Lock, Trophy } from "lucide-react";
import { ACHIEVEMENTS, type EarnedEvent, type Outline } from "@wb/shared";
import { AnimalCollection } from "@/components/AnimalCollection";
import { describeEvent } from "@/components/Celebration";
import { FLOWERS, PlantPicture, Visitor, type Growth } from "@/components/Garden";
import { Empty, clsx } from "@/components/ui";
import { useAchievements, useOutline, useSettings, useState_ } from "@/lib/api";
import { BackLink } from "@/lib/history";
import { useLang, useT } from "@/lib/i18n";
import { useRewards } from "@/lib/rewards";

/** Everything earned in this course. It only ever grows. */
export function AchievementsPage() {
  const t = useT();
  const settings = useSettings().data;
  const outline = useOutline().data;
  const earned = useAchievements().data?.earned ?? [];
  // Only the animals: no achievements, no comebacks.
  const { zooOnly } = useRewards();
  if (!settings?.showAchievements) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.achievementsOffTitle}>{t.achievementsOffBody}</Empty>
      </div>
    );
  }
  const has = new Set(
    earned.flatMap((e) => (e.event.kind === "achievement" ? [e.event.id] : [])),
  );
  const comebacks = earned.filter((e) => e.event.kind === "comeback");
  const shown = ACHIEVEMENTS.filter((a) => !a.hidden || has.has(a.id));
  const hiddenLeft = ACHIEVEMENTS.filter(
    (a) => a.hidden && !has.has(a.id),
  ).length;
  return (
    <div className="h-full overflow-y-auto">
      <div className="settle wb-page mx-auto max-w-[52rem] px-6 pb-12 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">
          {zooOnly ? t.animals : t.achievements}
        </h1>
        {zooOnly ? null : (
          <p className="mt-2 max-w-prose text-ink-2">{t.achievementsIntro}</p>
        )}

        {zooOnly ? null : (
          <>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {shown.map((a) => {
                const on = has.has(a.id);
                const text = t.achievementList[a.id]!;
                return (
                  <li
                    key={a.id}
                    className={clsx(
                      "flex items-start gap-3 rounded-lg border p-3.5",
                      on
                        ? "border-accent/40 bg-accent-soft/40"
                        : "border-line bg-sheet opacity-60",
                    )}
                  >
                    {on ? (
                      <Trophy
                        size={17}
                        className="mt-0.5 shrink-0 text-accent"
                        aria-label={t.achievementEarned}
                      />
                    ) : (
                      <Lock
                        size={15}
                        className="mt-1 shrink-0 text-ink-3"
                        aria-label={t.achievementOpen}
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-semibold">
                        {text.title}
                      </span>
                      <span className="block text-[13.5px] text-ink-2">
                        {text.body}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {hiddenLeft ? (
              <p className="mt-3 text-[13.5px] text-ink-3">
                {t.achievementsHidden(hiddenLeft)}
              </p>
            ) : null}
          </>
        )}
        {outline ? (
          <AnimalCollection outline={outline} earned={earned} alone={zooOnly} />
        ) : null}

        {zooOnly ? null : (
          <section className="mt-10">
            <h2 className="text-[15px] font-semibold">{t.comebacks}</h2>
            <p className="mt-0.5 text-[13.5px] text-ink-2">{t.comebacksBody}</p>
            {comebacks.length ? <Comebacks events={comebacks} /> : <p className="mt-3 text-sm text-ink-3">{t.comebacksNone}</p>}
          </section>
        )}

        {zooOnly || !outline ? null : (
          <section className="mt-10">
            <h2 className="text-[15px] font-semibold">{t.chapters}</h2>
            <p className="mt-0.5 text-[13.5px] text-ink-2">{t.plantsBody}</p>
            <Garden outline={outline} earned={earned} />
          </section>
        )}
      </div>
    </div>
  );
}

const STEPS = [1, 2, 3, 4, 5] as const;

/** Each comeback on the confidence scale: a ring where you started, a filled dot where you are now, an arc between. */
function Comebacks({ events }: { events: EarnedEvent[] }) {
  const t = useT();
  const date = new Intl.DateTimeFormat(useLang(), { day: "numeric", month: "short" });
  return (
    <div className="mt-3 overflow-x-auto pb-2 pt-1.5">
      <div className="grid min-w-[640px] grid-cols-[minmax(150px,1fr)_repeat(5,80px)_72px] items-center">
        <span />
        {STEPS.map((c) => (
          <span key={c} className="pb-0.5 pt-1.5 text-center text-xs text-ink-3">
            {t.confidence[c]}
          </span>
        ))}
        <span />
        {events.map((e) => {
          if (e.event.kind !== "comeback") return null;
          const { from, to, title } = e.event;
          return (
            <div key={e.key} className="col-span-full grid grid-cols-subgrid items-center border-t border-line py-1 first-of-type:border-t-0">
              <span className="min-w-0 pr-3 text-[14px] font-medium">{title}</span>
              <ComebackScale from={from} to={to} label={t.comebackFromTo(t.confidence[from as 1]!, t.confidence[to as 1]!)} />
              <span className="text-right text-xs tabular-nums text-ink-3">{date.format(e.earnedAt)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComebackScale({ from, to, label }: { from: number; to: number; label: string }) {
  const X = (i: number) => (i - 1) * 80 + 40, y = 22;
  return (
    <svg viewBox="0 0 400 34" role="img" aria-label={label} className="col-span-5 h-[34px] w-[400px]">
      <line x1={X(1)} x2={X(5)} y1={y} y2={y} stroke="var(--line)" strokeWidth={2} strokeLinecap="round" />
      {STEPS.map((i) => (
        <circle key={i} cx={X(i)} cy={y} r={3} fill="var(--line-strong)" />
      ))}
      <path d={`M${X(from)} ${y - 8} Q ${(X(from) + X(to)) / 2} ${y - 22} ${X(to) - 8} ${y - 9}`} fill="none" stroke="var(--done)" strokeWidth={1.4} strokeLinecap="round" />
      <path d={`M${X(to) - 13} ${y - 13} L ${X(to) - 8} ${y - 9} L ${X(to) - 14} ${y - 7}`} fill="none" stroke="var(--done)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={X(from)} cy={y} r={6} fill="var(--sheet)" stroke="var(--ink-3)" strokeWidth={1.5} />
      <circle cx={X(to)} cy={y} r={7} fill="var(--done)" />
    </svg>
  );
}

/** How far a chapter has grown: 0 to 3, as earned. It only ever grows. */
const stageOf = (earned: EarnedEvent[], chapterId: string) =>
  earned.reduce<0 | 1 | 2 | 3>((best, e) => (e.event.kind === "plant" && e.event.chapterId === chapterId && e.event.stage > best ? e.event.stage : best), 0);
/** The drawing for an earned stage: a seedling before anything, in bloom when fully grown. */
const GROWTH: Record<0 | 1 | 2 | 3, Growth> = { 0: 0, 1: 1, 2: 3, 3: 4 };

/** One garden bed per chapter, grouped by part. Each chapter has its own flower. */
function Garden({ outline, earned }: { outline: Outline; earned: EarnedEvent[] }) {
  const t = useT();
  const suggestions = useState_().data?.suggestions ?? [];
  const next = suggestions.find((s) => s.reason === "continue") ?? suggestions.find((s) => s.reason === "next-up");
  const currentId = next ? outline.chapters.find((c) => c.items.some((i) => i.id === next.id))?.id : undefined;
  const index = new Map(outline.chapters.map((c, i) => [c.id, i]));
  const groups = outline.parts.length
    ? outline.parts.map((p) => ({ id: p.id, title: p.title as string | null, chapters: outline.chapters.filter((c) => c.partId === p.id) }))
    : [{ id: "all", title: null, chapters: outline.chapters }];
  let blooming = 0;
  return (
    <div className="mt-1">
      {groups.map((g) =>
        g.chapters.length ? (
          <div key={g.id}>
            {g.title ? (
              <div className="mb-2 mt-4 flex items-baseline gap-2.5 text-[13px] font-semibold text-ink-2 after:h-px after:flex-1 after:bg-line">{g.title}</div>
            ) : null}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
              {g.chapters.map((c) => {
                const i = index.get(c.id) ?? 0;
                const stage = stageOf(earned, c.id);
                const visitor = stage === 3 ? (blooming++ % 2 ? "🦋" : "🐝") : null;
                return (
                  <li
                    key={c.id}
                    aria-current={c.id === currentId ? "true" : undefined}
                    className={`flex flex-col overflow-hidden rounded-xl border bg-sheet ${c.id === currentId ? "border-accent ring-2 ring-accent-soft" : "border-[color-mix(in_srgb,var(--leaf)_28%,var(--line))]"}`}
                  >
                    <div className="wb-bed-pic relative">
                      <PlantPicture stage={GROWTH[stage]} kind={FLOWERS[i % FLOWERS.length]!} seed={i} />
                      {visitor ? <Visitor emoji={visitor} seed={i * 2.3} nth={blooming} /> : null}
                    </div>
                    <div className="grid gap-px px-2.5 pb-2.5 pt-2">
                      <span className="hyphens-auto text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]">{c.title}</span>
                      <span className="text-xs text-ink-3">{stage ? t.plantStage[stage] : t.plantSeedling}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
