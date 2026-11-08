import { useSettings } from './api';

/** Whether rewards are on, and whether only the animal friends: then achievements, plants and other news stay away. */
export function useRewards(): { on: boolean; zooOnly: boolean; icon: 'trophy' | 'paw' } {
  const s = useSettings().data;
  const on = !!s?.showAchievements;
  return { on, zooOnly: on && s?.rewards === 'zoo', icon: s?.rewardIcon ?? 'trophy' };
}
