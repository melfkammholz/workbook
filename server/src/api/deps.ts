import type { Config } from '../config.js';
import type { ContentService } from '../content/service.js';
import type { TypstRenderer } from '../content/typst.js';
import type { CourseManager } from '../courses/manager.js';
import type { Store } from '../db/store.js';
import type { SessionPool } from '../runners/pool.js';

export interface Deps {
  config: Config;
  courses: CourseManager;
  /** The work, content and renderer of the open course. Routes only get here once one is open. */
  readonly store: Store;
  readonly content: ContentService;
  readonly renderer: TypstRenderer;
  pool: SessionPool;
  /** Directory with `Workbook/Check.hs` and friends. */
  haskellLib: string;
  /** Directory with the Prolog driver and test harness. */
  prologLib: string;
}

/** Looks up the open course on every use, so a route never holds on to the previous one. */
export function makeDeps(d: Pick<Deps, 'config' | 'courses' | 'pool' | 'haskellLib' | 'prologLib'>): Deps {
  const open = () => {
    const course = d.courses.active;
    if (!course) throw new Error('no course is open');
    return course;
  };
  return {
    ...d,
    get store() {
      return open().store;
    },
    get content() {
      return open().content;
    },
    get renderer() {
      return open().renderer;
    },
  };
}
