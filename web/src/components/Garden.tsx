import { useEffect, useRef } from 'react';
import { drawAnimal } from './meadow/portrait';

/**
 * A chapter's plant, drawn: each chapter has its own flower, which grows with the chapter and never wilts. One piece:
 * the leaves grow out of the stem, and the head sits on its top.
 */
export const FLOWERS = ['daisy', 'tulip', 'sunflower', 'lavender', 'poppy', 'bluebell', 'cosmos', 'allium'] as const;
export type Flower = (typeof FLOWERS)[number];

const HEAD: Record<Flower, number> = { daisy: 13, tulip: 10, sunflower: 17, lavender: 3, poppy: 12, bluebell: 4, cosmos: 13, allium: 11 };
const COLOR: Record<Flower, string> = { daisy: '#f7f4ec', tulip: '#e8607a', sunflower: '#f2c230', lavender: '#9b82d6', poppy: '#e5533d', bluebell: '#7f8fe0', cosmos: '#ee8fbd', allium: '#b57ad6' };

/** Drawing stage 0 (a seedling) to 4 (in bloom). */
export type Growth = 0 | 1 | 2 | 3 | 4;

/** SVG markup of a plant. Generated here from numbers only, never from course text. */
function plantMarkup(stage: Growth, kind: Flower, seed: number): string {
  const gx = 75, gy = 90, C = COLOR[kind];
  const taller: Partial<Record<Flower, number>> = { sunflower: 1.15, allium: 1.12, lavender: 1.05 };
  const want = [12, 26, 40, 50, 58][stage]! * (taller[kind] ?? 1);
  const room = stage === 4 ? HEAD[kind] * 1.6 : stage === 3 ? 13 : 3;
  const h = Math.min(want, gy - 5 - room), topY = gy - h;
  const bend = kind === 'bluebell' && stage >= 3;
  const P: [number, number][] = [[gx, gy], [gx - 3, gy - h * 0.4], bend ? [gx + 1, topY - 2] : [gx + 3, gy - h * 0.7], bend ? [gx + 17, topY + 7] : [gx, topY]];
  const bez = (t: number): [number, number] => {
    const u = 1 - t;
    const at = (i: 0 | 1) => u * u * u * P[0]![i] + 3 * u * u * t * P[1]![i] + 3 * u * t * t * P[2]![i] + t * t * t * P[3]![i];
    return [at(0), at(1)];
  };
  const [tx, ty] = bez(1);
  const leaf = (t: number, side: number, len: number, ang: number, wid: number, fill: string) => {
    const [sx, sy] = bez(t), a = (ang * Math.PI) / 180, ex = sx + side * len * Math.cos(a), ey = sy - len * Math.sin(a);
    const dx = (ex - sx) / len, dy = (ey - sy) / len, mx = (sx + ex) / 2, my = (sy + ey) / 2, w = len * wid;
    return `<path d="M${sx} ${sy} Q${mx - dy * w} ${my + dx * w} ${ex} ${ey} Q${mx + dy * w} ${my - dx * w} ${sx} ${sy}Z" fill="${fill}"/>`;
  };
  const E = (cx: number, cy: number, rx: number, ry: number, f: string, rot = 0) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${f}" ${rot ? `transform="rotate(${rot} ${cx} ${cy})"` : ''} stroke="rgb(0 0 0 / .1)" stroke-width=".6"/>`;
  const ring = (cx: number, cy: number, n: number, r: number, rx: number, ry: number, f: string) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i * 2 * Math.PI) / n;
      return E(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rx, ry, f, (a * 180) / Math.PI);
    }).join('');
  let s = `<ellipse cx="${gx}" cy="${gy + 3}" rx="34" ry="5" fill="var(--bed-2)"/>`;
  for (const [x, hh] of [[24, 7], [29, 10], [120, 8], [125, 11], [130, 6]] as const)
    s += `<path d="M${x} ${gy + 3} q 1 -${hh} 3 -${hh}" stroke="var(--leaf)" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>`;
  // The plant sways a little, each out of step with the others.
  s += `<g class="wb-plant" style="animation-delay:-${(seed * 0.9).toFixed(2)}s">`;
  s += `<path d="M${P[0]} C ${P[1]}, ${P[2]}, ${P[3]}" stroke="var(--stem)" stroke-width="${kind === 'sunflower' && stage > 2 ? 3.2 : stage < 2 ? 2 : 2.4}" fill="none" stroke-linecap="round"/>`;
  const narrow = kind === 'lavender' || kind === 'allium' || kind === 'tulip', thin = kind === 'cosmos';
  if (stage === 0) s += leaf(1, -1, 8, 25, 0.32, 'var(--leaf)') + leaf(1, 1, 8, 25, 0.32, 'var(--leaf-2)');
  else {
    const n = Math.min(stage + 1, 4);
    for (let i = 0; i < n; i++) {
      const t = 0.1 + i * (stage > 2 ? 0.17 : 0.22), side = i % 2 ? 1 : -1;
      const len = (14 - i * 1.5) * (kind === 'sunflower' ? 1.35 : kind === 'tulip' ? 1.25 : 1);
      s += leaf(t, side, len, narrow ? 62 : thin ? 40 : 30, narrow ? 0.16 : thin ? 0.12 : 0.3, i % 2 ? 'var(--leaf-2)' : 'var(--leaf)');
    }
  }
  if (stage === 3) {
    if (kind === 'lavender')
      for (let i = 0; i < 5; i++) {
        const [x, y] = bez(1 - i * 0.05);
        s += E(x + (i % 2 ? 1.6 : -1.6), y - 1, 1.6, 2.2, '#8fae7a');
      }
    else if (kind === 'bluebell') s += `<path d="M${tx} ${ty} v3" stroke="var(--stem)" stroke-width="1.2"/>` + E(tx, ty + 6, 2.6, 3.4, C);
    else s += E(tx, ty - 6, 4.5, 7, C) + leaf(1, -1, 5, 70, 0.5, 'var(--leaf-2)') + leaf(1, 1, 5, 70, 0.5, 'var(--leaf-2)');
  }
  if (stage === 4) {
    const R = HEAD[kind], cy = ty - R * 0.5;
    if (kind === 'daisy') s += ring(tx, cy, 14, 7, 6, 1.9, C) + `<circle cx="${tx}" cy="${cy}" r="4" fill="#ecb53a"/>`;
    if (kind === 'cosmos') s += ring(tx, cy, 8, 7.5, 6.2, 3.6, C) + `<circle cx="${tx}" cy="${cy}" r="3.6" fill="#f0c53c"/>`;
    if (kind === 'sunflower') s += ring(tx, cy, 16, 10.5, 6.5, 2.6, C) + `<circle cx="${tx}" cy="${cy}" r="7" fill="#7a4a24"/><circle cx="${tx - 2}" cy="${cy - 2}" r="2.4" fill="#93603a"/>`;
    if (kind === 'poppy') {
      for (const [dx, dy] of [[-5, -3], [5, -3], [-3.5, 3], [3.5, 3]] as const) s += `<circle cx="${tx + dx}" cy="${cy + dy}" r="6.4" fill="${C}" stroke="rgb(0 0 0 / .1)" stroke-width=".6"/>`;
      s += `<circle cx="${tx}" cy="${cy}" r="2.8" fill="#2b2536"/>`;
    }
    if (kind === 'allium')
      for (let i = 0; i < 28; i++) {
        const a = i * 2.4, r = Math.sqrt(i / 28) * 9.5;
        s += `<circle cx="${tx + Math.cos(a) * r}" cy="${cy + Math.sin(a) * r}" r="2" fill="${i % 3 ? C : '#cfa4ea'}"/>`;
      }
    if (kind === 'tulip') {
      const b = ty + 1;
      s += `<path d="M${tx - 8} ${b - 14} C ${tx - 10} ${b - 2}, ${tx + 10} ${b - 2}, ${tx + 8} ${b - 14} L ${tx + 4} ${b - 10} L ${tx} ${b - 17} L ${tx - 4} ${b - 10} Z" fill="${C}" stroke="rgb(0 0 0 / .1)" stroke-width=".6"/><path d="M${tx - 3} ${b - 10} q3 -7 6 0" fill="color-mix(in srgb, ${C} 70%, #fff)"/>`;
    }
    if (kind === 'lavender')
      for (let i = 0; i < 9; i++) {
        const [x, y] = bez(1 - i * 0.035);
        s += E(x + (i % 2 ? 2 : -2), y - 2, 2, 2.6, i < 2 ? '#b8a3e8' : C);
      }
    if (kind === 'bluebell')
      for (const t of [0.78, 0.88, 1]) {
        const [x, y] = bez(t);
        s += `<path d="M${x} ${y} v3" stroke="var(--stem)" stroke-width="1.1"/><path d="M${x - 3.4} ${y + 3} q3.4 -2 6.8 0 l.8 7 q-4.2 2 -8.4 0 z" fill="${C}" stroke="rgb(0 0 0 / .1)" stroke-width=".6"/>`;
      }
  }
  return s + '</g>';
}

export function PlantPicture({ stage, kind, seed = 0 }: { stage: Growth; kind: Flower; seed?: number }) {
  return <svg viewBox="0 0 150 104" aria-hidden className="block h-auto w-full" dangerouslySetInnerHTML={{ __html: plantMarkup(stage, kind, seed) }} />;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A bee or a butterfly flying around a flower in bloom. Still when motion is reduced. */
export function Visitor({ emoji, seed, nth = 0 }: { emoji: '🐝' | '🦋'; seed: number; nth?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    const k = emoji === '🐝' ? 1.5 : 1.25;
    let raf = 0;
    const frame = (now: number) => {
      const t = now / 1000 + seed;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w * 0.5 + Math.sin(t * 0.7) * w * 0.2, h * 0.3 + Math.cos(t * 1.1) * h * 0.08);
      ctx.scale(Math.cos(t * 0.7) > 0 ? k : -k, k);
      drawAnimal(ctx, emoji, t, { go: true, nth, alt: 8 });
      if (!still) raf = requestAnimationFrame(frame);
    };
    const still = reducedMotion();
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [emoji, seed, nth]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />;
}
