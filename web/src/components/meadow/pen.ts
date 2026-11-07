import type { Actor } from './types';
import { W } from './world';

export const INK = '#2b2536';

export type Glow =
  | { m: DOMMatrix; pts: readonly (readonly [number, number])[] }
  | { m: DOMMatrix; soft: readonly [number, number, number, number] };

/**
 * What is being drawn on, and how. The meadow draws on more than one canvas (the ground layer,
 * a scratch canvas for animals in the water), so the helpers draw on whichever is current.
 */
export const pen = {
  ctx: null as unknown as CanvasRenderingContext2D,
  /** Coat colours of the animal being drawn are shifted by its variant's shade. */
  shade: 0,
  /** Lights that shine through the night tint, collected while drawing. */
  glows: [] as Glow[],
};

/** The camera and the canvas. One meadow at a time. */
export const view = {
  cam: { x: 0, y: 0, z: 1 },
  CW: 0,
  CH: 0,
  dpr: 1,
  base: 1,
  night: 0,
  paused: false,
  clock: 0,
  accent: '#5a3fd0',
  open: { l: 0, r: W, gl: 0, gr: W },
};
export const scale = () => view.base * view.cam.z;
export const viewW = () => view.CW / scale();
export const viewH = () => view.CH / scale();
export const visible = (x: number, pad = 80) => x > view.cam.x - pad && x < view.cam.x + viewW() + pad;
export const inOpen = (x: number) => x > view.open.gl + 20 && x < view.open.gr - 20;
export function worldTransform() {
  const s = scale() * view.dpr;
  pen.ctx.setTransform(s, 0, 0, s, -view.cam.x * s, -view.cam.y * s);
}
export const screenTransform = () => pen.ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

const tcache = new Map<string, string>();
export function T(hex: string): string {
  const shade = pen.shade;
  if (!shade) return hex;
  const key = hex + shade;
  let v = tcache.get(key);
  if (!v) {
    const to = shade < 0 ? 0 : 255, f = Math.abs(shade);
    v = '#' + [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16); return Math.round(c + (to - c) * f).toString(16).padStart(2, '0'); }).join('');
    tcache.set(key, v);
  }
  return v;
}
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * t)).join(',')})`;
}

export function E(x: number, y: number, rx: number, ry: number, rot = 0) {
  const c = pen.ctx;
  c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
}
export function P(pts: readonly (readonly [number, number])[]) {
  const c = pen.ctx;
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
}
export function F(color: string) { const c = pen.ctx; c.fillStyle = color; c.fill(); c.stroke(); }
export function dot(x: number, y: number, r: number, color = INK) { E(x, y, r, r); pen.ctx.fillStyle = color; pen.ctx.fill(); }
export function line(x0: number, y0: number, x1: number, y1: number) { const c = pen.ctx; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
export function outline(w = 1) { const c = pen.ctx; c.strokeStyle = INK; c.lineWidth = w; c.lineJoin = 'round'; c.stroke(); }
/** Closed while asleep, blinking now and then. */
export function eye(a: Actor, x: number, y: number, r = 0.6) {
  const c = pen.ctx;
  c.save(); c.strokeStyle = INK; c.lineWidth = Math.max(0.5, r * 0.8); c.lineCap = 'round';
  if (a.sleep > 0) { c.beginPath(); c.arc(x, y - r * 0.6, r * 1.2, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); }
  else if ((a.t + a.seed * 7) % 4.3 < 0.13) line(x - r, y, x + r, y);
  else dot(x, y, r);
  c.restore();
}
/** A thick outlined stroke: legs, necks, tails. */
export function leg(x0: number, y0: number, x1: number, y1: number, w: number, color: string) {
  const c = pen.ctx;
  c.save(); c.lineCap = 'round';
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
  c.lineWidth = w + 1.1; c.strokeStyle = INK; c.stroke();
  c.lineWidth = w; c.strokeStyle = color; c.stroke(); c.restore();
}
/** Like `leg`, along a quadratic (6 numbers) or cubic (8 numbers) curve. */
export function curve(pts: readonly number[], w: number, color: string) {
  const c = pen.ctx, p = (i: number) => pts[i] ?? 0;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(p(0), p(1));
  if (pts.length === 6) c.quadraticCurveTo(p(2), p(3), p(4), p(5));
  else c.bezierCurveTo(p(2), p(3), p(4), p(5), p(6), p(7));
  c.lineWidth = w + 1.1; c.strokeStyle = INK; c.stroke(); c.lineWidth = w; c.strokeStyle = color; c.stroke(); c.restore();
}
/** Fill a shape, draw stripes clipped to it, then outline it. */
export function striped(shape: () => void, color: string, stripes: () => void) {
  const c = pen.ctx;
  shape(); c.fillStyle = color; c.fill();
  c.save(); c.clip(); c.strokeStyle = INK; c.lineCap = 'round'; stripes(); c.restore();
  shape(); c.stroke();
}
export function heart(x: number, y: number, s: number) {
  const c = pen.ctx;
  c.beginPath(); c.moveTo(x, y + s * 0.9);
  c.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
  c.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  c.fill();
}
export function spikes(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, n: number) {
  const c = pen.ctx;
  c.beginPath();
  for (let i = 0; i <= n * 2; i++) {
    const ang = a0 + ((a1 - a0) * i) / (n * 2), r = i % 2 ? r1 : r0;
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.85;
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  }
  c.closePath();
}
