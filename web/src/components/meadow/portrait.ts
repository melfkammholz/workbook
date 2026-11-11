import { INK, pen } from './pen';
import { DRAWN, HALF, TALL, variantOf } from './species';
import { SPRITES } from './sprites';
import type { Actor } from './types';

/** Whether the meadow has its own drawing of this animal (author emoji may not). */
export const isDrawn = (emoji: string) => !!DRAWN[emoji];

/**
 * One animal, standing, outside the meadow: for the friend tiles and the visitors of a garden bed. The context must
 * already be transformed so that its feet are at 0,0. Uses the meadow's pen, so it saves and restores what the meadow
 * may be in the middle of.
 */
export function drawAnimal(ctx: CanvasRenderingContext2D, emoji: string, t: number, o: { seed?: number; nth?: number; go?: boolean; alt?: number } = {}): boolean {
  const sprite = DRAWN[emoji];
  if (!sprite || sprite === 'emoji') return false;
  const a = {
    sprite, variant: variantOf(sprite, o.nth ?? 0), state: o.go ? 'go' : 'idle', phase: t * 6, t, seed: o.seed ?? 1.3,
    sleep: 0, special: null, hop: 0, sink: 0, alt: o.alt ?? 0, talt: 0, dir: 1, highlight: 0, size: 1, x: 0, y: 0, look: 0, ex: { emoji },
  } as unknown as Actor;
  const saved = { ctx: pen.ctx, shade: pen.shade, glows: pen.glows.length };
  pen.ctx = ctx;
  pen.shade = a.variant.shade;
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  SPRITES[sprite](a);
  // An owl's eyes shine in the meadow's night; here there is none, so its lights are dropped.
  pen.glows.length = saved.glows;
  pen.ctx = saved.ctx;
  pen.shade = saved.shade;
  return true;
}

/**
 * Fits an animal into a tile of w × h. Small animals fit whole; big ones are drawn larger, head first, and the tile
 * crops the rest (the giraffe is a neck and a head). Returns the translation of its feet and the scale.
 */
export function fitTile(emoji: string, w: number, h: number): { x: number; y: number; k: number } | null {
  const sp = DRAWN[emoji];
  if (!sp || sp === 'emoji') return null;
  const tall = TALL[sp], half = HALF[sp];
  const big = tall > 18 || half > 13;
  const k = big ? Math.min(2.2, w / (half * 2)) : Math.min(2.2, (h * 0.68) / (tall + 2), (w * 0.74) / (half * 2 + 4));
  // The sloth hangs from a branch: its feet are at the top.
  const feet = sp === 'sloth' ? h * 0.2 : big ? Math.max(h * 0.92, h * 0.12 + tall * k) : h * 0.84;
  return { x: big ? w / 2 - half * k * 0.3 : w / 2, y: feet, k };
}
