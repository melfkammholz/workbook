import { describe, expect, it } from 'vitest';
import { hitsRects, mergeLineRects, rectsTop, toPageRects } from '@wb/shared';

describe('anchors in PDFs', () => {
  const box = { left: 100, top: 50, width: 400, height: 800 };

  it('turns screen rectangles into fractions of the page, dropping empty and outside ones', () => {
    const r = toPageRects(
      [
        { left: 140, top: 130, width: 100, height: 16 },
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 200, top: 200, width: 0, height: 10 },
      ],
      box,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.x).toBeCloseTo(0.1);
    expect(r[0]!.y).toBeCloseTo(0.1);
    expect(r[0]!.w).toBeCloseTo(0.25);
    expect(r[0]!.h).toBeCloseTo(0.02);
    expect(toPageRects([{ left: 0, top: 0, width: 1, height: 1 }], { left: 0, top: 0, width: 0, height: 0 })).toEqual([]);
  });

  it('merges the pieces of a line into one rectangle and keeps lines apart', () => {
    const merged = mergeLineRects([
      { x: 0.3, y: 0.101, w: 0.2, h: 0.02 },
      { x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
      { x: 0.1, y: 0.1, w: 0.4, h: 0.021 },
      { x: 0.1, y: 0.2, w: 0.3, h: 0.02 },
      { x: 0.8, y: 0.2, w: 0.1, h: 0.02 },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0]!.x).toBeCloseTo(0.1);
    expect(merged[0]!.w).toBeCloseTo(0.4);
    expect(merged[1]!.w).toBeCloseTo(0.3);
  });

  it('knows whether a point is on a highlight, and where it is on the page', () => {
    const rects = [{ x: 0.1, y: 0.5, w: 0.2, h: 0.02 }, { x: 0.1, y: 0.3, w: 0.5, h: 0.02 }];
    expect(hitsRects(rects, 0.2, 0.51)).toBe(true);
    expect(hitsRects(rects, 0.5, 0.51)).toBe(false);
    expect(rectsTop(rects)).toBe(0.3);
  });
});
