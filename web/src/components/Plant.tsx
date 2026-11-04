import { useAchievements } from '@/lib/api';
import { useT } from '@/lib/i18n';

export const PLANTS: Record<1 | 2 | 3, string> = { 1: '🌱', 2: '🌿', 3: '🌳' };

/** How far a chapter has grown. Nothing at all until it has started, or with achievements off. */
export function Plant({ chapterId, className }: { chapterId: string; className?: string }) {
  const t = useT();
  const { data } = useAchievements();
  const stage = (data?.earned ?? []).reduce<0 | 1 | 2 | 3>((best, e) => (e.event.kind === 'plant' && e.event.chapterId === chapterId && e.event.stage > best ? e.event.stage : best), 0);
  if (stage === 0) return null;
  return (
    <span role="img" aria-label={t.plantStage[stage]} title={t.plantStage[stage]} className={className}>
      {PLANTS[stage]}
    </span>
  );
}
