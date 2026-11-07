import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content/loader.js';
import { suggestNext } from '../src/suggest.js';
import type { StudentState } from '@wb/shared';
import { EXAMPLE_CONTENT } from './helpers.js';

const outline = loadContent(EXAMPLE_CONTENT).outline;
const NOW = 1_700_000_000_000;
const empty = (): StudentState => ({ progress: {}, reflections: {}, stats: {}, lastOpenedId: null });
const done = (state: StudentState, id: string, at = NOW - 1000) => {
  state.progress[id] = { status: 'done', updatedAt: at, reviewDueAt: null, reviewCount: 0 };
};

describe('suggestNext', () => {
  it('starts a newcomer on the recommended path, earliest first', () => {
    const s = suggestNext(outline, empty(), NOW);
    expect(s[0]).toEqual({ id: 'expressions-everything', reason: 'start-here' });
    expect(s.every((x) => outline.chapters.flatMap((c) => c.items).find((i) => i.id === x.id)!.type === 'exercise')).toBe(true);
  });

  it('prefers what follows the last finished exercise', () => {
    const st = empty();
    done(st, 'recursion-care');
    const s = suggestNext(outline, st, NOW);
    const ids = s.map((x) => x.id);
    expect(ids.indexOf('binary-exponentiation')).toBeLessThan(ids.indexOf('expressions-everything'));
    expect(s.find((x) => x.id === 'binary-exponentiation')!.reason).toBe('next-up');
  });

  it('deprioritises exercises whose prerequisites are not done', () => {
    const ids = suggestNext(outline, empty(), NOW, 20).map((x) => x.id);
    expect(ids.indexOf('slot-machine')).toBeGreaterThan(ids.indexOf('imperative-variables'));
  });

  it('surfaces due reviews first, then unfinished work', () => {
    const st = empty();
    st.progress['loops'] = { status: 'review', updatedAt: NOW - 5 * 86_400_000, reviewDueAt: NOW - 1, reviewCount: 1 };
    st.progress['strong-typing'] = { status: 'review', updatedAt: NOW, reviewDueAt: NOW + 86_400_000, reviewCount: 1 };
    st.progress['conditionals'] = { status: 'in_progress', updatedAt: NOW, reviewDueAt: null, reviewCount: 0 };
    const s = suggestNext(outline, st, NOW);
    expect(s[0]).toEqual({ id: 'loops', reason: 'review-due' });
    expect(s[1]).toEqual({ id: 'conditionals', reason: 'continue' });
    expect(s.filter((x) => x.id === 'strong-typing' && x.reason === 'review-due')).toEqual([]);
  });

  it('suggests new exercises only from the focus, but keeps what was started', () => {
    const essentials: StudentState = { ...empty(), focus: 'essentials' };
    const all = outline.chapters.flatMap((c) => c.items).filter((i) => i.type === 'exercise');
    const outside = all.find((e) => !e.startHere)!;
    expect(suggestNext(outline, essentials, NOW, 50).every((s) => all.find((e) => e.id === s.id)!.startHere)).toBe(true);
    essentials.progress[outside.id] = { status: 'in_progress', updatedAt: NOW, reviewDueAt: null, reviewCount: 0 };
    expect(suggestNext(outline, essentials, NOW, 50)).toContainEqual({ id: outside.id, reason: 'continue' });
    const thorough = suggestNext(outline, { ...empty(), focus: 'thorough' }, NOW, 50).map((s) => s.id);
    expect(thorough).not.toContain('mergesort-python');
    expect(suggestNext(outline, { ...empty(), focus: 'everything' }, NOW, 50).map((s) => s.id)).toContain('mergesort-python');
  });
});
