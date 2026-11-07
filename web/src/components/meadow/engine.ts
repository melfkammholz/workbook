import { E, F, INK, P, heart, line, pen, scale, screenTransform, view, viewH, viewW, visible, inOpen, worldTransform } from './pen';
import { DECOR, drawGround, drawMist, drawNightLights, drawSky, hills, waterColor } from './scenery';
import { DEEP, HALF, HOME, NOCTURNAL, SLEEPLESS, SPEC, TALL, spriteOf, variantOf } from './species';
import { SPRITES } from './sprites';
import type { Actor, Decor, Ellipse, Friend, Plan, Spot, Sprite, TraceId, VariantLabel } from './types';
import {
  ACACIAS, BAMBOO, CANOPIES, CENTRE, DANDELIONS, FLOE, H, HZ, POND, POOL, ROCKS, START_VIEW, STUMP, TREES, TREE_KINDS, W, WORLD,
  clamp, depth, inEll, inFloe, inPond, inSea, pick, rand, shoreX, unit, type Perch,
} from './world';

export type Selection =
  | { kind: 'friend'; id: string; emoji: string; sprite: Sprite; count: number; variant: VariantLabel; asleep: boolean }
  | { kind: 'trace'; trace: TraceId };

export interface MeadowOptions {
  canvas: HTMLCanvasElement;
  /** Positioned next to whatever is selected; its content is up to the caller. */
  popover: HTMLElement;
  reducedMotion: boolean;
  onSelect: (selection: Selection | null) => void;
  onZoom: (can: { in: boolean; out: boolean }) => void;
}

export interface Meadow {
  /**
   * The friends in the order they arrived, how many there can be at most, and the traces earned.
   * Friends that are new since the last call walk in. Says who arrived and whether the meadow grew.
   */
  set(friends: readonly Friend[], total: number, traces: Readonly<Record<TraceId, boolean>>): { arrived: string[]; grew: boolean };
  zoom(factor: number): void;
  /** Moves the view to a friend and selects it. */
  show(id: string): void;
  deselect(): void;
  destroy(): void;
}

type Particle =
  | { kind: 'heart'; x: number; y: number; life: number; seed: number; s?: number }
  | { kind: 'z'; x: number; y: number; life: number; max: number; size: number; dir: number }
  | { kind: 'fish'; x: number; y: number; dir: number; life: number }
  | { kind: 'drop' | 'chip'; x: number; y: number; vx: number; vy: number; life: number }
  | { kind: 'ring' | 'bubble'; x: number; y: number; life: number }
  | { kind: 'leaf' | 'seed'; x: number; y: number; life: number; seed: number; vx?: number };

const ZMIN = 1, ZMAX = 2.4;

export function createMeadow(o: MeadowOptions): Meadow {
  const cv = o.canvas, mainCtx = cv.getContext('2d')!;
  const holder = cv.parentElement!;
  // The ground is drawn on its own layer, so the night tint can leave the sky (moon, stars) alone.
  const fg = document.createElement('canvas'), fgCtx = fg.getContext('2d')!;
  const mask = document.createElement('canvas'), maskCtx = mask.getContext('2d')!;
  const scratch = document.createElement('canvas'), sctx = scratch.getContext('2d')!;
  pen.ctx = mainCtx;
  Object.assign(view, { cam: { x: 0, y: 0, z: 1 }, CW: 0, CH: 0, dpr: 1, base: 1, night: 0, clock: 0, paused: o.reducedMotion });

  let actors: Actor[] = [], particles: Particle[] = [], friends: readonly Friend[] = [], total = 1, started = false;
  let traces: Readonly<Record<TraceId, boolean>> = { nest: false, ring: false, dandelion: false, rockflower: false };
  let nightTarget = 0, selected: Actor | Decor | null = null, dirty = true, seedT = 0;
  let camGoal: { x: number; y: number } | null = null;
  const vel = { x: 0, y: 0 };
  let minimap: { x: number; y: number; w: number; h: number; ix: number; iw: number } | null = null;
  const fontFamily = getComputedStyle(cv).fontFamily;

  const shown = (d: Decor) => !d.trace || traces[d.trace];
  let obstacles: Decor[] = [];
  const refreshObstacles = () => { obstacles = WORLD.decor.filter((d) => d.fx !== undefined && shown(d)); };
  refreshObstacles();

  // ───────────── the meadow grows with the friends ─────────────
  function openGoal(list: readonly Friend[]) {
    const span = 900 + (W - 900) * Math.min(1, list.length / Math.max(1, total)) * 0.5;
    let l = CENTRE - span / 2, r = CENTRE + span / 2;
    // always far enough to reach the places the friends live
    for (const f of list) { const h = HOME[spriteOf(f.emoji)]; l = Math.min(l, h[0]); r = Math.max(r, h[1]); }
    return { l: Math.max(0, l), r: Math.min(W, r) };
  }

  // ───────────── camera ─────────────
  function clampCam() {
    const { cam, open } = view;
    const lo = open.l - 50, hi = open.r + 50 - viewW();
    cam.x = hi < lo ? (lo + hi) / 2 : clamp(cam.x, lo, hi);
    cam.x = clamp(cam.x, 0, Math.max(0, W - viewW()));
    cam.y = clamp(cam.y, 0, Math.max(0, H - viewH()));
  }
  const toScreen = (x: number, y: number) => ({ x: (x - view.cam.x) * scale(), y: (y - view.cam.y) * scale() });
  const toWorld = (sx: number, sy: number) => ({ x: view.cam.x + sx / scale(), y: view.cam.y + sy / scale() });
  const zoomButtons = () => o.onZoom({ in: view.cam.z < ZMAX - 0.01, out: view.cam.z > ZMIN + 0.01 });
  function zoomAt(sx: number, sy: number, z: number) {
    const before = toWorld(sx, sy);
    view.cam.z = clamp(z, ZMIN, ZMAX);
    view.cam.x = before.x - sx / scale(); view.cam.y = before.y - sy / scale();
    clampCam(); zoomButtons(); dirty = true;
  }
  function lookAt(x: number, y: number) {
    const { cam } = view, keep = { x: cam.x, y: cam.y };
    cam.x = x - viewW() / 2; cam.y = y - viewH() * 0.6; clampCam();
    const goal = { x: cam.x, y: cam.y };
    cam.x = keep.x; cam.y = keep.y;
    if (o.reducedMotion) { cam.x = goal.x; cam.y = goal.y; camGoal = null; dirty = true; } else camGoal = goal;
  }
  function resize() {
    // Shown larger, the meadow fills its box; otherwise its height follows its width.
    const w = holder.clientWidth, h = 'fill' in holder.dataset ? holder.clientHeight : Math.round(clamp(w * 0.46, 270, 380));
    if (w === view.CW && h === view.CH) return;
    const centre = view.CW ? view.cam.x + viewW() / 2 : START_VIEW;
    view.CW = w; view.CH = h; view.dpr = window.devicePixelRatio || 1; view.base = h / H;
    for (const c of [cv, fg, mask]) { c.width = Math.round(w * view.dpr); c.height = Math.round(h * view.dpr); }
    cv.style.height = `${h}px`;
    view.cam.x = centre - viewW() / 2; clampCam();
    dirty = true;
  }

  // ───────────── footprints ─────────────
  // Animals and objects take up an ellipse on the ground: as wide as the body and about as deep
  // as it is thick, so two animals may pass one in front of the other but never stand inside each other.
  const onGround = (a: Actor) => a.move !== 'fly' && a.move !== 'perch' && a.move !== 'sit' && a.move !== 'hang';
  const grounded = (a: Actor) => onGround(a) && !a.climb && a.alt < 2 && !a.jump;
  const half = (a: Actor, y = a.y) => HALF[a.sprite] * unit(y, a.size);
  const deep = (a: Actor, y = a.y) => (DEEP[a.sprite] ?? 4.5) * unit(y, a.size);
  const vis = (a: Actor) => a.y - a.alt;
  const inHome = (a: Actor, x: number) => x >= HOME[a.sprite][0] - 40 && x <= HOME[a.sprite][1] + 40;
  function overlaps(a: Actor, x: number, y: number, b: Actor, pad = 1) {
    const u = (x - b.x) / (0.8 * (half(a, y) + half(b)) * pad), v = (y - b.y) / ((deep(a, y) + deep(b)) * pad);
    return u * u + v * v < 1;
  }
  function ignores(a: Actor, d: Decor) {
    if (a.move === 'swim' || (a.move === 'amph' && inPond(a.x, a.y))) return d.kind !== 'lodge';
    if (d.kind === 'lodge') return true;
    if (a.sprite === 'squirrel' && TREE_KINDS.has(d.kind)) return true;
    if (a.sprite === 'lizard' && (d.kind === 'rock' || d.kind === 'rockflower')) return true;
    return false;
  }
  function blockedStatic(a: Actor, x: number, y: number, pad = 1) {
    const h = half(a, y) * 0.85, dp = deep(a, y);
    for (const d of obstacles) {
      const fx = d.fx ?? 0, fy = d.fy ?? 0;
      if (Math.abs(d.x - x) > (fx + h) * pad + 2 || ignores(a, d)) continue;
      const u = (x - d.x) / ((fx + h) * pad), v = (y - d.y) / ((fy + dp) * pad);
      if (u * u + v * v < 1) return true;
    }
    return false;
  }
  /** Where an animal may be: swimmers in their water, waders in the shallows, walkers on dry land. */
  function canStand(a: Actor, x: number, y: number) {
    if (y < HZ + 6 || y > H - 3) return false;
    const pond = inPond(x, y, 1.02), sea = inSea(x + 4, y);
    switch (a.move) {
      case 'swim': {
        if (a.water === 'pond') return inEll(POND, x, y, 0.95);
        // the whole body, not just its middle, keeps clear of the ice
        const fx = (x - FLOE.cx) / (FLOE.rx + half(a, y) * 0.9), fy = (y - FLOE.cy) / (FLOE.ry + deep(a, y) + 10);
        if (fx * fx + fy * fy < 1) return false;
        return a.water === 'far' ? inSea(x - 160, y) && y < HZ + 56 : inSea(x - 14, y);
      }
      case 'amph': return a.water === 'sea' ? !pond && x > shoreX(y) - 75 : !sea;
      case 'wade': return !pond && !inSea(x - 45, y);
      default:
        if (a.wet) return !sea && !inEll(a.wetPond, x, y, 0.8) && !inEll(a.wetPond === POND ? POOL : POND, x, y, 1.02);
        return !pond && !sea;
    }
  }
  const bumps = (a: Actor, x: number, y: number) => actors.some((b) => b !== a && grounded(b) && overlaps(a, x, y, b) && !overlaps(a, a.x, a.y, b));
  /** A straight walk is only planned if nothing stands in the way. */
  function pathClear(a: Actor, x1: number, y1: number) {
    const d = Math.hypot(x1 - a.x, y1 - a.y), n = Math.max(1, Math.ceil(d / 6));
    const startBlocked = blockedStatic(a, a.x, a.y), startBad = !canStand(a, a.x, a.y);
    for (let i = 1; i <= n; i++) {
      const x = a.x + ((x1 - a.x) * i) / n, y = a.y + ((y1 - a.y) * i) / n, leaving = i * 6 < 24;
      if (!(startBlocked && leaving) && blockedStatic(a, x, y, 1.05)) return false;
      if (!(startBad && leaving) && !canStand(a, x, y)) return false;
    }
    return true;
  }
  function crowded(a: Actor, x: number, y: number) {
    for (const b of actors) {
      if (b === a || !grounded(b)) continue;
      if (overlaps(a, x, y, b, 1.6)) return true;
      const u = (x - b.tx) / (0.8 * (half(a, y) + half(b)) * 1.6), v = (y - b.ty) / ((deep(a, y) + deep(b)) * 1.6);
      if (u * u + v * v < 1) return true;
    }
    return false;
  }

  // ───────────── where to go ─────────────
  function spotWhere(a: Actor, gen: () => Spot, tries = 70, needPath = true): Spot | null {
    for (let i = 0; i < tries; i++) {
      const p = gen();
      if (!inOpen(p.x) || !canStand(a, p.x, p.y) || blockedStatic(a, p.x, p.y, 1.15)) continue;
      if (i < tries * 0.7 && crowded(a, p.x, p.y)) continue;
      if (needPath && !pathClear(a, p.x, p.y)) continue;
      return p;
    }
    return null;
  }
  const landSpot = (a: Actor, x0: number, x1: number, needPath = true) => spotWhere(a, () => ({ x: rand(x0, x1), y: rand(HZ + 22, H - 8) }), 70, needPath);
  const homeSpot = (a: Actor) => { const [h0, h1] = HOME[a.sprite]; return landSpot(a, Math.max(h0, a.x - 360), Math.min(h1, a.x + 360)) ?? landSpot(a, h0, h1); };
  function waterSpot(a: Actor, needPath = true) {
    return spotWhere(a, () => {
      if (a.water === 'pond') { const ang = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.66; return { x: POND.cx + Math.cos(ang) * POND.rx * r, y: POND.cy + Math.sin(ang) * POND.ry * r }; }
      if (a.water === 'far') { const y = rand(HZ + 6, HZ + 52); return { x: rand(shoreX(y) + 200, W - 40), y }; }
      const y = rand(HZ + 20, H - 8);
      if (a.sprite === 'octopus') return { x: shoreX(y) + rand(24, 110), y };
      if (a.move === 'amph') return { x: shoreX(y) + rand(20, 380), y };
      return { x: shoreX(y) + rand(80, 520), y }; // dolphins keep away from the beach
    }, 40, needPath);
  }
  const floeSpot = (a: Actor) => spotWhere(a, () => { const ang = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.7; return { x: FLOE.cx + Math.cos(ang) * FLOE.rx * r, y: FLOE.cy + Math.sin(ang) * FLOE.ry * r }; }, 30);
  const beachSpot = (a: Actor) => spotWhere(a, () => { const y = rand(HZ + 30, H - 10); return { x: shoreX(y) - rand(10, 52), y }; });
  const wadeSpot = (a: Actor) => spotWhere(a, () => { const y = rand(HZ + 30, H - 8); return { x: shoreX(y) + rand(6, 36), y }; }, 40);
  function flowerSpot(a: Actor): Spot {
    const near = WORLD.flat.filter((f) => inOpen(f.x) && Math.abs(f.x - a.x) < 320 && inHome(a, f.x));
    const list = near.length ? near : WORLD.flat.filter((f) => inOpen(f.x) && inHome(a, f.x));
    const f = pick(list.length ? list : WORLD.flat)!;
    return { x: f.x, y: f.y + 0.5, alt: 9 * depth(f.y), perch: true };
  }
  function canopySpot(a: Actor): Spot {
    const list = CANOPIES.filter((c) => inOpen(c.t.x) && inHome(a, c.t.x) && Math.abs(c.t.x - a.x) < 600);
    return { ...pick(list.length ? list : CANOPIES)!.spot(), perch: true };
  }
  function airSpot(a: Actor): Spot {
    if (a.sprite === 'bee' && Math.random() < 0.6) return flowerSpot(a);
    if (a.sprite === 'butterfly' && Math.random() < 0.4) return flowerSpot(a);
    if (a.sprite === 'ladybug') {
      if (Math.random() < 0.5) return flowerSpot(a);
      const b = pick(WORLD.decor.filter((d) => d.kind === 'bush' && inOpen(d.x) && inHome(a, d.x) && Math.abs(d.x - a.x) < 400));
      return b ? { x: b.x + rand(-6, 6) * b.s, y: b.y + 0.6, alt: 22 * b.s, perch: true } : flowerSpot(a);
    }
    if (a.sprite === 'parrot' && Math.random() < 0.6) return canopySpot(a);
    const [h0, h1] = HOME[a.sprite];
    return { x: clamp(a.x + rand(-300, 300), Math.max(h0, view.open.gl + 20), Math.min(h1, view.open.gr - 20)), y: rand(HZ + 20, H - 10), alt: rand(18, 64), perch: false };
  }
  function besideSpot(a: Actor, b: Actor | Decor) {
    const isActor = 'sprite' in b;
    const gap = 0.8 * (half(a, b.y) + (isActor ? half(b) : (b.fx ?? 0))) + 4, first = a.x < b.x ? -1 : 1;
    for (const side of [first, -first]) {
      const p = { x: b.x + side * gap, y: b.y + (isActor ? 0 : (b.fy ?? 0) + deep(a, b.y) + 2) };
      if (!inOpen(p.x) || !canStand(a, p.x, p.y) || blockedStatic(a, p.x, p.y, 1.02)) continue;
      if (actors.some((c) => c !== a && c !== b && grounded(c) && overlaps(a, p.x, p.y, c, 1.2))) continue;
      if (!pathClear(a, p.x, p.y)) continue;
      return p;
    }
    return null;
  }
  function shoreSpot(a: Actor, pond: Ellipse) {
    a.wet = true; a.wetPond = pond;
    // the tiger lies down in the middle of the pool's front, where it fits
    const [a0, a1] = pond === POOL ? [0.38, 0.62] : [0.15, 0.85];
    const p = spotWhere(a, () => { const ang = rand(a0, a1) * Math.PI; return { x: pond.cx + Math.cos(ang) * pond.rx * 0.88, y: pond.cy + Math.sin(ang) * pond.ry * 0.88 }; }, 14);
    a.wet = false;
    return p;
  }
  function go(a: Actor, p: Spot, plan: Plan | null = null, partner: Actor | null = null, goal: Decor | null = null) {
    a.tx = p.x; a.ty = p.y; if (p.alt !== undefined) a.talt = p.alt;
    a.perchSpot = !!p.perch;
    a.state = 'go'; a.special = null; a.plan = plan; a.partner = partner; a.goal = goal; a.dodge = null; a.wait = 0; a.resume = 0;
    a.wet = plan === 'fish' || plan === 'soak';
    a.wd = { t: 0, d: Math.hypot(p.x - a.x, p.y - a.y) };
  }
  function rest(a: Actor, secs: number) { a.state = 'idle'; a.timer = secs; a.plan = null; a.partner = null; a.goal = null; a.dodge = null; a.wait = 0; a.resume = 0; }
  /** Stand still for a moment, then carry on to the same place: someone is in the way. */
  function pause(a: Actor) { a.state = 'idle'; a.timer = rand(0.5, 0.9); a.resume++; a.dodge = null; a.wait = 0; }

  /** Things an animal does with its surroundings or with the others, instead of just wandering. */
  function plan(a: Actor) {
    if (!grounded(a) || a.sink > 1 || (a.move !== 'walk' && a.move !== 'amph')) return false;
    const near = (list: readonly Decor[], d = 500) => list.filter((x) => inOpen(x.x) && inHome(a, x.x) && Math.abs(x.x - a.x) < d);
    const r = Math.random();
    const tryGo = (p: Spot | null, name: Plan, partner: Actor | null, goal: Decor | null = null) => { if (!p) return false; go(a, p, name, partner, goal); return true; };
    switch (a.sprite) {
      case 'bear': if (r < 0.3 && Math.abs(a.x - POND.cx) < 700 && tryGo(shoreSpot(a, POND), 'fish', null)) return true; break;
      case 'tiger': if (r < 0.3 && Math.abs(a.x - POOL.cx) < 700 && tryGo(shoreSpot(a, POOL), 'soak', null)) { a.wetPond = POOL; return true; } break;
      case 'fox': if (r < 0.3) { const h = actors.find((b) => b.sprite === 'hedgehog' && grounded(b) && Math.abs(b.x - a.x) < 500); if (h && tryGo(besideSpot(a, h), 'sniff', h)) return true; } break;
      case 'giraffe': if (r < 0.5) {
        const t = pick(near(ACACIAS));
        if (t) { const k = unit(t.y + 16, a.size), side = a.x < t.x ? -1 : 1; if (tryGo(spotWhere(a, () => ({ x: t.x + side * rand(12, 15) * k, y: t.y + (t.fy ?? 0) + deep(a) + 3 }), 3), 'browse', null, t)) return true; }
      } break;
      case 'panda': if (r < 0.5) { const b = pick(near(BAMBOO, 700)); if (b && tryGo(besideSpot(a, b), 'eat', null, b)) return true; } break;
      case 'squirrel': if (r < 0.4) { const t = pick(near(TREES.filter((x) => x.kind === 'round' || x.kind === 'poplar'), 400)); if (t && tryGo(spotWhere(a, () => ({ x: t.x + 0.5, y: t.y + 1.5 }), 2), 'climb', null, t)) return true; } break;
      case 'lizard': if (r < 0.5) { const k = pick(near(ROCKS.filter(shown), 500)); if (k && tryGo(spotWhere(a, () => ({ x: k.x - 2 * k.s, y: k.y + 0.4 }), 2), 'bask', null, k)) return true; } break;
      case 'beaver': if (r < 0.3 && tryGo(besideSpot(a, STUMP), 'gnaw', null, STUMP)) return true; break;
      default: break;
    }
    if (Math.random() < 0.15 && a.move === 'walk') {
      const pool = actors.filter((b) => b !== a && grounded(b) && b.move === 'walk' && Math.abs(b.x - a.x) < 500 && inHome(a, b.x));
      const same = pool.filter((b) => b.ex.chapter === a.ex.chapter);
      const b = pick(same.length && Math.random() < 0.8 ? same : pool);
      if (b && tryGo(besideSpot(a, b), 'visit', b)) return true;
    }
    return false;
  }
  function nextTarget(a: Actor) {
    a.wet = false; a.diving = false;
    if (plan(a)) return;
    let p: Spot | null = null;
    const r = Math.random();
    switch (a.move) {
      case 'swim':
        p = waterSpot(a);
        if (p && a.sprite === 'whale' && r < 0.25) { a.special = 'fluke'; a.state = 'idle'; a.timer = 2.4; a.effT = 0; a.after = p; return; }
        break;
      case 'fly': p = airSpot(a); break;
      case 'wade': p = wadeSpot(a); break;
      case 'amph':
        if (a.water === 'sea') p = r < (a.sprite === 'penguin' ? 0.4 : 0.25) ? floeSpot(a) : r < 0.7 ? waterSpot(a) : beachSpot(a);
        else {
          const swim = a.sprite === 'otter' ? 0.6 : 0.4;
          p = r < swim ? waterSpot(a) : landSpot(a, POND.cx - POND.rx - 130, POND.cx + POND.rx + 130);
          if (p && a.sprite === 'otter' && r < swim && Math.random() < 0.4) { go(a, p); a.diving = true; return; }
        }
        break;
      default: p = homeSpot(a);
    }
    if (p) go(a, p); else rest(a, rand(1, 2.5));
  }
  const owlSpot = (a: Actor): Perch => (a.onPost ? WORLD.postTop : WORLD.perch);

  // ───────────── actors ─────────────
  function makeActor(ex: Friend, nth: number, arriving: boolean, slot: { i: number; n: number }): Actor {
    const sprite = spriteOf(ex.emoji), spec = SPEC[sprite], variant = variantOf(sprite, nth);
    const a: Actor = {
      ex, nth, variant, sprite, move: spec.move, water: spec.water, size: spec.size * variant.size, speed: spec.speed,
      x: 0, y: 0, tx: 0, ty: 0, alt: 0, talt: 0, alt0: 0, d0: 1, dir: Math.random() < 0.5 ? 1 : -1, hx: 0, hy: 0, flipT: 0,
      state: 'idle', timer: rand(0.3, 3), phase: 0, t: rand(0, 10), seed: Math.random() * 10, sink: 0, hop: 0, highlight: 0,
      special: null, look: 0, onPost: false, sleep: 0, zt: 0, toBed: false, plan: null, partner: null, goal: null, dodge: null, wait: 0, resume: 0,
      wet: false, wetPond: POND, diving: false, fishT: 0, swipe: 0, climb: null, jump: null, after: null, spoutT: rand(2, 8), yawn: 0, effT: 0,
      anchorY: null, perchSpot: true, wd: null,
    };
    const anchor = (p: Perch) => { a.x = a.tx = p.x; a.y = a.ty = p.gy; a.alt = a.talt = p.alt; };
    if (a.move === 'perch') {
      anchor(WORLD.perch); a.timer = rand(10, 20);
      if (arriving) { a.x = view.cam.x - 30; a.alt = a.alt0 = 90; a.d0 = Math.abs(WORLD.perch.x - a.x) || 1; a.state = 'go'; }
      return a;
    }
    if (a.move === 'sit') { anchor(WORLD.koalas[nth % WORLD.koalas.length]!); if (arriving) lookAt(a.x, vis(a)); return a; }
    if (a.move === 'hang') { anchor(WORLD.sloth); a.x = a.tx = WORLD.sloth.x + rand(-1, 1) * WORLD.sloth.span; if (arriving) lookAt(a.x, vis(a)); return a; }
    // Friends of one home are spread evenly over it.
    const [h0, h1] = HOME[sprite];
    const l = Math.max(h0, view.open.gl + 20), r = Math.min(h1, view.open.gr - 20), w = Math.max(0, r - l);
    const x0 = l + (w * slot.i) / slot.n, x1 = l + (w * (slot.i + 1)) / slot.n;
    a.x = rand(x0, x1); a.y = rand(HZ + 30, H - 10);
    let p: Spot | null;
    if (a.move === 'swim') p = waterSpot(a, false);
    else if (a.move === 'fly') p = { x: a.x, y: rand(HZ + 20, H - 10), alt: rand(16, 60) };
    else if (a.move === 'wade') p = wadeSpot(a);
    else if (a.move === 'amph') p = a.water === 'sea' ? (arriving ? waterSpot(a, false) : ((Math.random() < 0.5 ? floeSpot(a) : null) ?? beachSpot(a))) : Math.random() < 0.5 ? waterSpot(a, false) : landSpot(a, POND.cx - 250, POND.cx + 250, false);
    else p = landSpot(a, x0, x1, false) ?? landSpot(a, h0, h1, false);
    p ??= { x: (h0 + h1) / 2, y: 270 };
    a.x = a.tx = p.x; a.y = a.ty = p.y; a.alt = a.talt = p.alt ?? 0;
    a.sink = sinkTarget(a);
    if (arriving) {
      if (a.move === 'swim' || a.move === 'wade' || (a.move === 'amph' && a.water === 'sea')) { a.sink = 12; lookAt(a.x, a.y); }
      else if (a.move === 'fly') { a.x = view.cam.x - 20; a.alt = 80; go(a, { x: view.cam.x + viewW() * 0.4, y: rand(HZ + 40, H - 20), alt: rand(20, 50) }); }
      else if (a.x < view.cam.x || a.x > view.cam.x + viewW()) lookAt(a.x, a.y);
      else { const t = { x: a.x, y: a.y }; a.x = Math.max(view.cam.x - 40, h0 - 40); go(a, t); a.dir = 1; } // walks in from the edge
    }
    return a;
  }
  function syncActors(arriving: ReadonlySet<string>) {
    const have = new Map(actors.map((a) => [a.ex.id, a]));
    const seen = new Map<string, number>(), groups = new Map<string, number>(), slots = new Map<string, number>();
    const home = (f: Friend) => HOME[spriteOf(f.emoji)].join();
    for (const f of friends) groups.set(home(f), (groups.get(home(f)) ?? 0) + 1);
    // Built one by one, so each new friend looks for a spot away from those already placed.
    actors = [];
    for (const f of friends) {
      const nth = seen.get(f.emoji) ?? 0, si = slots.get(home(f)) ?? 0;
      seen.set(f.emoji, nth + 1); slots.set(home(f), si + 1);
      actors.push(have.get(f.id) ?? makeActor(f, nth, arriving.has(f.id), { i: si, n: groups.get(home(f)) ?? 1 }));
    }
    if (selected && 'sprite' in selected && !actors.includes(selected)) deselect();
  }

  // ───────────── sleep ─────────────
  const isDark = () => view.night > 0.6;
  const alwaysSleepy = (a: Actor) => a.sprite === 'koala' || a.sprite === 'sloth';
  function fallAsleep(a: Actor, secs: number) {
    rest(a, secs); a.sleep = secs; a.zt = rand(0.5, 2); a.toBed = false;
    a.special = a.sprite === 'otter' ? 'float' : a.sprite === 'hedgehog' ? 'curl' : a.sprite === 'seal' || a.sprite === 'lion' || a.sprite === 'tiger' ? 'lie' : null;
  }
  function wake(a: Actor) { a.sleep = 0; a.special = null; rest(a, rand(0.5, 2)); if (onGround(a)) a.hop = 0.6; }
  /** Day animals sometimes nap at night, night animals doze off during the day. Never for long. */
  function maybeSleep(a: Actor) {
    if (a.toBed) { fallAsleep(a, rand(14, 32)); return true; }
    if (SLEEPLESS.has(a.sprite)) return false;
    if (NOCTURNAL.has(a.sprite)) {
      if (!isDark() && a.sprite === 'hedgehog' && Math.random() < 0.25) { fallAsleep(a, rand(10, 20)); return true; }
      return false;
    }
    if (!isDark() || Math.random() > 0.4) return false;
    if ((a.move === 'amph' || a.wet) && a.sink > 1 && a.sprite !== 'otter') return false;
    if (a.move === 'fly') { go(a, a.sprite === 'parrot' ? canopySpot(a) : flowerSpot(a)); a.toBed = true; return true; }
    fallAsleep(a, rand(14, 32));
    return true;
  }

  // ───────────── behaviour ─────────────
  function arrived(a: Actor) {
    a.diving = false;
    if (maybeSleep(a)) return;
    // A parrot does not hang in the air: a point in the sky leads straight on to the next one.
    if ((a.sprite === 'parrot' || a.sprite === 'ladybug') && !a.perchSpot) { nextTarget(a); return; }
    const p = a.plan, b = a.partner, goal = a.goal;
    rest(a, a.move === 'fly' ? (a.alt > 30 ? rand(4, 10) : rand(0.8, 3)) : rand(1.5, 6));
    if (a.sprite === 'parrot' || a.sprite === 'ladybug') a.timer = rand(4, 10);
    const face = (x: number) => { a.dir = x > a.x ? 1 : -1; };
    if ((p === 'visit' || p === 'sniff') && b) {
      face(b.x); a.timer = rand(5, 9); a.partner = b;
      if (p === 'sniff') { a.special = 'sniff'; if (b.sleep <= 0) { b.special = 'curl'; b.state = 'idle'; b.timer = Math.max(b.timer, 4); } return; }
      if (a.sprite === 'fox' || a.sprite === 'bear' || a.sprite === 'wolf' || a.sprite === 'panda') a.special = 'sit';
      if (b.sleep <= 0 && b.state === 'idle') { b.dir = -a.dir; b.timer = Math.max(b.timer, 5); }
      particles.push({ kind: 'heart', x: (a.x + b.x) / 2, y: Math.min(extent(a).top, extent(b).top) - 2, life: 1.4, seed: 1, s: 2.6 });
      return;
    }
    switch (p) {
      case 'fish': a.wet = true; a.special = 'fish'; a.timer = rand(9, 15); face(POND.cx); a.fishT = rand(1.2, 2.5); return;
      case 'soak': a.wet = true; a.special = 'lie'; a.timer = rand(8, 14); face(POOL.cx); return;
      case 'browse': if (goal) face(goal.x); a.special = 'browse'; a.timer = rand(6, 11); return;
      case 'eat': if (goal) face(goal.x); a.special = 'eat'; a.timer = rand(7, 12); return;
      case 'gnaw': if (goal) face(goal.x); a.special = 'gnaw'; a.timer = rand(5, 9); return;
      case 'bask': a.special = 'bask'; a.timer = rand(8, 16); if (goal) a.anchorY = goal.y + 0.5; return;
      case 'climb': if (goal) { a.climb = { tree: goal, t: 0, top: rand(36, 50) * goal.s, stay: rand(3, 7), mode: 'up' }; a.anchorY = goal.y + 0.5; a.timer = 99; } return;
      default: break;
    }
    if (NOCTURNAL.has(a.sprite) && isDark()) a.timer *= 0.5;
    const r = Math.random(), s = a.sprite;
    if (s === 'hedgehog' && r < 0.3) a.special = 'curl';
    else if (s === 'otter' && r < 0.55 && a.sink > 1) { a.special = 'float'; a.timer = rand(4, 8); }
    else if ((s === 'bear' || s === 'panda') && r < 0.35) { a.special = 'sit'; a.timer = rand(4, 8); }
    else if (s === 'fox' && r < 0.3) { a.special = 'sit'; a.timer = rand(3, 6); }
    else if (s === 'wolf') { if (isDark() && r < 0.35) { a.special = 'howl'; a.timer = rand(4, 7); } else if (r < 0.25) { a.special = 'sit'; a.timer = rand(3, 6); } }
    else if (s === 'zebra' && r < 0.55) { a.special = 'graze'; a.timer = rand(4, 9); }
    else if (s === 'lion' && r < 0.45) { a.special = 'lie'; a.timer = rand(8, 14); }
    else if (s === 'peacock' && r < 0.25) { a.special = 'fan'; a.timer = rand(4, 7); a.effT = 0; }
    else if (s === 'flamingo' && r < 0.45 && a.sink > 1) { a.special = 'feed'; a.timer = rand(3, 6); }
    else if (s === 'octopus' && r < 0.45) { a.special = 'wave'; a.timer = rand(3, 5); }
    else if (s === 'seal' && a.sink < 1 && r < 0.4) { a.special = 'lie'; a.timer = rand(5, 10); }
    else if (s === 'squirrel' && r < 0.3) { a.special = 'nut'; a.timer = rand(2, 4); }
    else if (s === 'kangaroo' && r < 0.3) { a.special = 'graze'; a.timer = rand(3, 6); }
  }
  function sinkTarget(a: Actor) {
    if (inFloe(a.x, a.y)) return 0;
    if (!(inPond(a.x, a.y, 0.95) || inSea(a.x - 8, a.y)) || a.jump || a.climb) return 0;
    if (a.diving) return 10;
    if (a.move === 'wade') return 3;
    if (a.wet) return a.sprite === 'tiger' ? 6 : 3;
    if (a.sprite === 'whale' || a.sprite === 'octopus') return 5;
    if (a.sprite === 'otter') return 4;
    if (a.sprite === 'penguin') return 3;
    if (a.move === 'swim' || a.move === 'amph') return 7;
    return 0;
  }
  function update(a: Actor, dt: number) {
    a.t += dt; a.hop = Math.max(0, a.hop - dt * 2.2); a.highlight = Math.max(0, a.highlight - dt); a.swipe = Math.max(0, a.swipe - dt * 2);
    a.yawn = Math.max(0, a.yawn - dt * 0.7); a.effT += dt;
    if (a.sleep > 0) {
      a.sleep -= dt;
      if ((a.zt -= dt) <= 0) { snore(a); a.zt = rand(2.6, 3.6); }
      const nocturnal = NOCTURNAL.has(a.sprite);
      if (a.sleep <= 0 || (!alwaysSleepy(a) && ((!nocturnal && view.night < 0.3) || (nocturnal && isDark())))) wake(a);
      return;
    }
    // tree dwellers that stay put
    if (a.move === 'sit' || a.move === 'hang') {
      if (a.move === 'hang' && a.state === 'go') moveTowards(a, dt, a.speed, () => rest(a, rand(6, 14)));
      else if ((a.timer -= dt) <= 0) {
        const r = Math.random();
        if (r < (a.move === 'sit' ? 0.65 : 0.45)) fallAsleep(a, rand(15, 35));
        else if (a.move === 'hang' && r < 0.8) { a.tx = WORLD.sloth.x + rand(-1, 1) * WORLD.sloth.span; a.state = 'go'; }
        else { a.dir = -a.dir; rest(a, rand(4, 8)); }
      }
      return;
    }
    if (a.move === 'perch') {
      if (a.state === 'idle') {
        a.timer -= dt;
        if (Math.random() < dt * 0.4) a.look = [-1, 0, 1][Math.floor(Math.random() * 3)]!;
        if (!isDark() && Math.random() < dt * 0.05) { fallAsleep(a, rand(6, 14)); return; }
        if (a.timer <= 0) {
          a.onPost = !a.onPost; const s = owlSpot(a);
          a.alt0 = a.alt; a.d0 = Math.hypot(s.x - a.x, s.gy - a.y) || 1;
          a.tx = s.x; a.ty = s.gy; a.talt = s.alt; a.state = 'go';
        }
      } else {
        moveTowards(a, dt, a.speed, () => { a.alt = a.talt; rest(a, rand(14, 28)); });
        // the flight arcs up between the two perches
        const p = clamp(1 - Math.hypot(a.tx - a.x, a.ty - a.y) / a.d0, 0, 1);
        if (a.state === 'go') a.alt = a.alt0 + (a.talt - a.alt0) * p + Math.sin(p * Math.PI) * 24;
      }
      return;
    }
    if (a.climb) { climbing(a, dt); return; }
    if (a.state === 'idle') {
      a.timer -= dt;
      if (a.special === 'fish' && (a.fishT -= dt) <= 0) { a.fishT = rand(2, 4); a.swipe = 1; particles.push({ kind: 'fish', x: a.x + a.dir * 10 * unit(a.y, a.size), y: a.y - 3, dir: a.dir, life: 0.9 }); }
      if (a.special === 'browse' && a.effT > 1.6) { a.effT = 0; const e = extent(a); particles.push({ kind: 'leaf', x: a.x + a.dir * 13 * e.k, y: e.top + 4, life: 2.2, seed: Math.random() * 6 }); }
      if (a.special === 'gnaw' && a.effT > 0.7) { a.effT = 0; particles.push({ kind: 'chip', x: a.x + a.dir * 9 * unit(a.y, a.size), y: a.y - 5, vx: rand(-8, 8), vy: -rand(10, 18), life: 0.8 }); }
      if (a.special === 'lie' && a.sprite === 'lion' && a.yawn <= 0 && Math.random() < dt * 0.12) a.yawn = 1;
      if (a.special === 'fluke' && a.timer <= 0) { a.special = null; if (a.after) go(a, a.after); a.diving = true; }
      else if (a.timer <= 0) {
        if (a.resume > 0 && a.resume <= 3 && !a.special) { a.state = 'go'; a.wd = { t: 0, d: Math.hypot(a.tx - a.x, a.ty - a.y) }; }
        else { a.special = null; a.anchorY = null; a.resume = 0; nextTarget(a); }
      }
      if (grounded(a)) separate(a, dt);
    } else {
      const sp = a.speed * depth(a.y) * (a.sink > 3 && a.move === 'amph' ? 1.6 : 1) * (a.toBed ? 0.7 : 1);
      moveTowards(a, dt, sp, () => arrived(a));
    }
    if (a.move === 'fly') a.alt += (a.talt - a.alt) * Math.min(1, dt * 1.4);
    if (a.sprite === 'lizard') {
      const k = ROCKS.find((x) => shown(x) && ((a.x - x.x) / ((x.fx ?? 1) * 0.8)) ** 2 + ((a.y - x.y) / ((x.fy ?? 1) + 2)) ** 2 < 1);
      a.alt += ((k ? 11 * k.s : 0) - a.alt) * Math.min(1, dt * 8);
      a.anchorY = k ? k.y + 0.5 : null;
    }
    if (a.sprite === 'dolphin') leap(a, dt, 90, 0.3, 1.15, 24, 7);
    if (a.sprite === 'penguin' && (a.jump || (a.sink > 2 && a.move === 'amph'))) leap(a, dt, 30, 0.6, 0.55, 8, 3);
    if (a.sprite === 'whale' && (a.spoutT -= dt) <= 0) { a.spoutT = rand(5, 10); if (a.sink < 8) spout(a); }
    if (a.diving && Math.random() < dt * 4) particles.push({ kind: 'bubble', x: a.x + rand(-3, 3), y: a.y - 1, life: 0.9 });
    a.sink += (sinkTarget(a) - a.sink) * Math.min(1, dt * 4);
  }
  /** Up the trunk in little dashes, a rest on a branch, and head first back down. */
  function climbing(a: Actor, dt: number) {
    const c = a.climb!, up = 2.4, down = 1.8;
    c.t += dt;
    const dash = (p: number) => clamp(p - Math.sin(2 * Math.PI * p * 4) / (2 * Math.PI * 4) * 0.9, 0, 1);
    const pace = (p: number) => 1 - 0.9 * Math.cos(2 * Math.PI * p * 4);
    if (c.t < up) { c.mode = 'up'; const p = c.t / up; a.alt = c.top * dash(p); a.phase += dt * 8 * pace(p); }
    else if (c.t < up + c.stay) { c.mode = 'top'; a.alt = c.top; }
    else if (c.t < up + c.stay + down) { c.mode = 'down'; const p = (c.t - up - c.stay) / down; a.alt = c.top * (1 - dash(p)); a.phase += dt * 8 * pace(p); }
    else { a.alt = 0; a.climb = null; a.anchorY = null; rest(a, rand(1, 3)); }
  }
  /** Dolphins and penguins leap out of the water, only out in open water. */
  function leap(a: Actor, dt: number, offShore: number, chance: number, dur: number, height: number, sink: number) {
    if (!a.jump) {
      if (a.state === 'go' && a.sink > sink * 0.6 && a.x > shoreX(a.y) + offShore && Math.random() < dt * chance) { a.jump = { t: 0, dur, h: height }; if (dur > 1) splash(a.x, a.y); }
      return;
    }
    a.jump.t += dt;
    const p = a.jump.t / a.jump.dur;
    if (p >= 1) { a.jump = null; a.alt = 0; if (dur > 1) splash(a.x, a.y); else particles.push({ kind: 'ring', x: a.x, y: a.y, life: 0.7 }); return; }
    a.alt = Math.sin(p * Math.PI) * a.jump.h * depth(a.y);
    a.sink = Math.max(0, sink - p * 40);
  }
  /** The animal in the way, if any, a little ahead on the way. */
  function blocker(a: Actor, wx: number, wy: number) {
    const look = half(a) * 0.5 + 10;
    for (const f of [0.5, 1]) {
      const px = a.x + wx * look * f, py = a.y + wy * look * f;
      for (const b of actors) if (b !== a && b !== a.partner && grounded(b) && overlaps(a, px, py, b, 1.05) && !overlaps(a, a.x, a.y, b)) return b;
    }
    return null;
  }
  /**
   * Walk towards the target. Static things were avoided when the walk was planned; another animal
   * in the way is passed in another depth lane, or waited for. Whoever cannot get on stops and plans
   * again instead of pushing. The heading turns smoothly, and the animal only turns round when it
   * has been going the other way for a moment.
   */
  function moveTowards(a: Actor, dt: number, speed: number, arrive: () => void) {
    const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
    if (d < 1.5) { arrive(); return; }
    let wx = dx / d, wy = dy / d;
    const ground = grounded(a);
    if (ground) {
      const b = blocker(a, wx, wy);
      if (b) {
        if (!a.dodge || a.dodge.b !== b) {
          const laneOk = (sign: number) => [8, 16].every((f) => { const nx = a.x + wx * f * 0.5, ny = a.y + sign * f; return canStand(a, nx, ny) && !blockedStatic(a, nx, ny); });
          let sign = a.y < b.y ? -1 : 1;
          if (!laneOk(sign)) sign = -sign;
          if (!laneOk(sign)) { pause(a); return; }
          a.dodge = { b, sign, t: 0 };
        }
        a.dodge.t += dt;
        if (a.dodge.t > 2) { pause(a); return; }
        wx *= 0.3; wy = wy * 0.3 + a.dodge.sign;
      } else a.dodge = null;
      const n = Math.hypot(wx, wy) || 1; wx /= n; wy /= n;
    }
    const turn = Math.min(1, dt * 7);
    a.hx += (wx - a.hx) * turn; a.hy += (wy - a.hy) * turn;
    const hn = Math.hypot(a.hx, a.hy) || 1, step = Math.min(d, speed * dt);
    let nx = a.x + (a.hx / hn) * step, ny = a.y + (a.hy / hn) * step;
    if (ground) {
      const startBlocked = blockedStatic(a, a.x, a.y), startBad = !canStand(a, a.x, a.y);
      const free = (x: number, y: number) => (startBlocked || !blockedStatic(a, x, y)) && (startBad || canStand(a, x, y));
      const clear = (x: number, y: number) => !bumps(a, x, y);
      if (!(free(nx, ny) && clear(nx, ny))) {
        if (free(nx, a.y) && clear(nx, a.y)) ny = a.y;
        else if (free(a.x, ny) && clear(a.x, ny)) nx = a.x;
        else if (!free(nx, ny)) { rest(a, rand(0.3, 0.8)); return; }
        else { pause(a); return; }
      }
    }
    a.wait = 0;
    a.x = nx; a.y = ny;
    if (Math.abs(a.hx / hn) > 0.3 && Math.sign(a.hx) !== a.dir) { a.flipT += dt; if (a.flipT > 0.2) { a.dir = Math.sign(a.hx); a.flipT = 0; } }
    else a.flipT = 0;
    a.phase += step / (unit(a.y, a.size) * 2.4);
    // Nobody keeps walking against something: without real progress, plan again.
    if (ground && a.wd) {
      a.wd.t += dt;
      if (a.wd.t > 1.5) { if (a.wd.d - d < 3) { rest(a, rand(0.4, 1)); a.wd = null; return; } a.wd = { t: 0, d }; }
    }
  }
  /** Standing animals that overlap drift apart slowly. Sleepers are not moved. */
  function separate(a: Actor, dt: number) {
    if (a.sleep > 0) return;
    for (const b of actors) {
      if (b === a || !grounded(b) || !overlaps(a, a.x, a.y, b)) continue;
      const ex = (a.x - b.x) / (half(a) + half(b)), ey = (a.y - b.y) / (deep(a) + deep(b)), n = Math.hypot(ex, ey) || 1;
      const nx = a.x + (ex / n) * 12 * dt, ny = a.y + (ey / n) * 5 * dt;
      if (!blockedStatic(a, nx, ny) && canStand(a, nx, ny)) { a.x = nx; a.y = ny; }
    }
  }

  // ───────────── drawing an animal ─────────────
  function extent(a: Actor) {
    const k = unit(a.y, a.size), v = vis(a);
    if (a.move === 'hang') return { top: v - 2 * k, bottom: v + 16 * k, k };
    return { top: v - (TALL[a.sprite] - a.sink) * k, bottom: v + (onGround(a) && !a.climb && !a.jump ? 0 : 6 * k), k };
  }
  function drawSprite(a: Actor, k: number, y: number) {
    const ctx = pen.ctx;
    pen.shade = a.variant.shade;
    ctx.save();
    ctx.translate(a.x, y + a.sink * k);
    if (a.jump) ctx.rotate(-Math.cos((a.jump.t / a.jump.dur) * Math.PI) * (a.jump.dur < 1 ? 0.5 : 0.8) * a.dir);
    if (a.sprite === 'emoji') {
      if (a.sleep > 0) ctx.rotate(-0.25);
      const bounce = a.state === 'go' ? Math.abs(Math.sin(a.phase * 1.4)) * 2.5 * k : 0;
      ctx.font = `${(12 * k).toFixed(1)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(a.ex.emoji, 0, -bounce + 1.5 * k);
    } else {
      ctx.scale(a.dir * k, k);
      ctx.lineWidth = 0.6; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
      SPRITES[a.sprite](a);
    }
    ctx.restore();
    pen.shade = 0;
  }
  /**
   * An animal partly in the water: drawn whole on a scratch canvas, then everything below the
   * surface (and over the water, not the bank) is veiled in the water's colour, more the deeper it
   * is. So a whale's body or a diving otter shows faintly under the surface instead of being cut off.
   */
  function withVeil(a: Actor, k: number, paint: () => void) {
    const outer = pen.ctx, m = outer.getTransform();
    const bw = (HALF[a.sprite] + 30) * k + 8, top = vis(a) - (TALL[a.sprite] + 30) * k - 12, bottom = a.y + 36 * k;
    const p0 = new DOMPoint(a.x - bw, top).matrixTransform(m), p1 = new DOMPoint(a.x + bw, bottom).matrixTransform(m);
    const ox = Math.floor(p0.x), oy = Math.floor(p0.y), w = Math.ceil(p1.x) - ox + 1, h = Math.ceil(p1.y) - oy + 1;
    if (w <= 0 || h <= 0 || w > 3000 || h > 3000) { paint(); return; }
    if (scratch.width < w || scratch.height < h) { scratch.width = Math.max(scratch.width, w); scratch.height = Math.max(scratch.height, h); }
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, w, h);
    pen.ctx = sctx;
    sctx.setTransform(m.a, m.b, m.c, m.d, m.e - ox, m.f - oy);
    paint();
    const [r, g, b] = waterColor(a.x, a.y);
    // the water gets murky over a few units, whatever the size of the animal
    const grad = sctx.createLinearGradient(0, a.y, 0, a.y + 6 + 2.5 * k);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.55)`); grad.addColorStop(1, `rgba(${r},${g},${b},0.97)`);
    let xl = shoreX(a.y), xr = W + 400;
    const body = inEll(POND, a.x, a.y, 1.05) ? POND : inEll(POOL, a.x, a.y, 1.05) ? POOL : null;
    if (body) { const dy = (a.y - body.cy) / body.ry, hw = body.rx * Math.sqrt(Math.max(0, 1 - dy * dy)); xl = body.cx - hw; xr = body.cx + hw; }
    const vx0 = Math.max(a.x - bw, xl), vx1 = Math.min(a.x + bw, xr);
    sctx.globalCompositeOperation = 'source-atop'; sctx.fillStyle = grad;
    if (vx1 > vx0) sctx.fillRect(vx0, a.y, vx1 - vx0, bottom - a.y + 4);
    sctx.globalCompositeOperation = 'source-over';
    pen.ctx = outer;
    outer.save(); outer.setTransform(1, 0, 0, 1, 0, 0); outer.drawImage(scratch, 0, 0, w, h, ox, oy, w, h); outer.restore();
  }
  function drawActor(a: Actor) {
    const ctx = pen.ctx, k = unit(a.y, a.size);
    const hop = Math.sin(a.hop * Math.PI) * 6 * k;
    const air = !grounded(a) && a.move !== 'swim';
    const flyBob = a.move === 'fly' && a.sleep <= 0 && a.alt > 12 ? Math.sin(a.t * 3 + a.seed) * 3 : 0;
    if (grounded(a) && a.sink < 1) { ctx.fillStyle = 'rgba(30,45,25,0.16)'; E(a.x, a.y, Math.min(10, HALF[a.sprite] * 0.7) * k, 2.2 * k); ctx.fill(); }
    if (a.move === 'fly' && a.alt < 70 && !inPond(a.x, a.y) && !inSea(a.x, a.y)) { ctx.fillStyle = `rgba(30,45,25,${(0.1 * (1 - a.alt / 70)).toFixed(3)})`; E(a.x, a.y, 5 * k, 1.3 * k); ctx.fill(); }
    if (a.highlight > 0 || a === selected) {
      const e = extent(a);
      ctx.save(); ctx.strokeStyle = view.accent;
      ctx.lineWidth = 2 / view.cam.z; ctx.setLineDash([4 / view.cam.z, 4 / view.cam.z]); ctx.lineDashOffset = -a.t * 12;
      if (air) E(a.x, (e.top + e.bottom) / 2 + flyBob, Math.max(9, HALF[a.sprite] * 1.1) * k, (e.bottom - e.top) * 0.6);
      else E(a.x, a.y, (HALF[a.sprite] * 0.9 + 3) * k, 3.6 * k);
      ctx.stroke(); ctx.restore();
    }
    const y = vis(a) - hop + flyBob;
    if (a.sink > 0.3 || a.jump) withVeil(a, k, () => drawSprite(a, k, y));
    else drawSprite(a, k, y);
    if (a.sink > 0.3 && a.sink < 9) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2;
      const w = Math.min(HALF[a.sprite], 12) * 0.8 + (a.sleep > 0 ? 0 : Math.sin(a.t * 3 + a.seed));
      E(a.x + a.dir * k, a.y, w * k, 1.8 * k); ctx.stroke(); ctx.restore();
    }
  }

  // ───────────── particles ─────────────
  function hearts(a: Actor, n = 3) {
    const e = extent(a), top = a.move === 'hang' ? e.top : e.top + (e.bottom - e.top) * 0.15;
    for (let i = 0; i < n; i++) particles.push({ kind: 'heart', x: a.x + rand(-8, 8) * e.k * 0.6, y: top + rand(-4, 2), life: 1.1 + i * 0.25, seed: Math.random() * 6 });
  }
  function splash(x: number, y: number) {
    particles.push({ kind: 'ring', x, y, life: 1 });
    for (let i = 0; i < 6; i++) particles.push({ kind: 'drop', x, y: y - 1, vx: rand(-14, 14), vy: -rand(18, 34), life: 0.8 });
  }
  function spout(a: Actor) {
    const x = a.x + a.dir * 12 * unit(a.y, a.size), y = a.y - 4;
    for (let i = 0; i < 10; i++) particles.push({ kind: 'drop', x, y, vx: rand(-9, 9), vy: -rand(34, 54), life: 1.1 });
  }
  /** Small, slow and faint: a hint that someone is asleep. */
  function snore(a: Actor) {
    if (!visible(a.x, 20)) return;
    const e = extent(a), y = a.move === 'hang' ? vis(a) + 8 * e.k : e.top + (e.bottom - e.top) * 0.25;
    particles.push({ kind: 'z', x: a.x + a.dir * HALF[a.sprite] * 0.5 * e.k, y, life: 2.2, max: 2.2, size: 3.6 + e.k * 0.9, dir: a.dir || 1 });
  }
  function drawParticles(dt: number) {
    const ctx = pen.ctx, zColor = view.night > 0.5 ? '#d5dbf5' : '#5f6a86';
    worldTransform();
    for (const p of particles) {
      p.life -= dt;
      ctx.globalAlpha = 1;
      switch (p.kind) {
        case 'z': {
          p.y -= dt * 4.5; p.x += dt * 2.5 * p.dir;
          const age = clamp(1 - p.life / p.max, 0, 1);
          ctx.globalAlpha = Math.sin(Math.PI * age) * 0.45; ctx.fillStyle = zColor;
          ctx.font = `500 ${(p.size * (0.8 + age * 0.4)).toFixed(1)}px ${fontFamily}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('z', p.x, p.y);
          break;
        }
        case 'fish': {
          const q = clamp(1 - p.life / 0.9, 0, 1), x = p.x + p.dir * q * 16, y = p.y - Math.sin(q * Math.PI) * 15;
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.dir * (q - 0.5) * 2.2); ctx.scale(p.dir, 1);
          ctx.strokeStyle = INK; ctx.lineWidth = 0.7;
          E(0, 0, 3.6, 1.4); F('#9fb6cc'); P([[-3.2, 0], [-5.6, -1.6], [-5.6, 1.6]]); F('#9fb6cc');
          ctx.restore();
          for (const [cx, at] of [[p.x, 0], [p.x + p.dir * 16, 1]] as const) {
            const r = 1 - Math.abs(q - at) * 2.2;
            if (r > 0) { ctx.globalAlpha = r * 0.7; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; E(cx, p.y, 4 + (1 - r) * 6, 1.2 + (1 - r) * 1.5); ctx.stroke(); }
          }
          break;
        }
        case 'drop': p.vy += 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt; ctx.globalAlpha = clamp(p.life * 1.5, 0, 0.9); ctx.fillStyle = '#ffffff'; E(p.x, p.y, 1.1, 1.1); ctx.fill(); break;
        case 'chip': p.vy += 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt; ctx.globalAlpha = clamp(p.life * 2, 0, 1); ctx.fillStyle = '#d8b88a'; E(p.x, p.y, 1.1, 0.6); ctx.fill(); break;
        case 'ring': { const q = clamp(1 - p.life, 0, 1); ctx.globalAlpha = (1 - q) * 0.7; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; E(p.x, p.y, 4 + q * 10, 1.2 + q * 2.5); ctx.stroke(); break; }
        case 'bubble': p.y -= dt * 6; ctx.globalAlpha = clamp(p.life, 0, 0.8); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.7; E(p.x, p.y, 1.1, 1.1); ctx.stroke(); break;
        case 'leaf': p.y += dt * 12; p.x += Math.sin(p.life * 4 + p.seed) * 0.4; ctx.globalAlpha = clamp(p.life, 0, 1); ctx.strokeStyle = INK; ctx.lineWidth = 0.5; E(p.x, p.y, 2, 1, Math.sin(p.life * 3)); F('#7aab60'); break;
        case 'seed': {
          p.x += dt * (p.vx ?? 10); p.y += Math.sin(p.life * 1.3 + p.seed) * 0.12 - dt * 1.5;
          ctx.globalAlpha = clamp(p.life / 2, 0, 0.9); ctx.strokeStyle = view.night > 0.5 ? '#c9d0e6' : '#ffffff'; ctx.lineWidth = 0.5;
          for (let i = 0; i < 5; i++) { const a0 = -Math.PI / 2 + (i - 2) * 0.35; line(p.x, p.y, p.x + Math.cos(a0) * 2.2, p.y + Math.sin(a0) * 2.2); }
          ctx.strokeStyle = '#a89a78'; line(p.x, p.y, p.x, p.y + 2.2);
          break;
        }
        case 'heart':
          p.y -= dt * 22; p.x += Math.sin(p.life * 6 + p.seed) * 0.3;
          ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = '#e0507a'; heart(p.x, p.y, p.s ?? 3.4);
          break;
      }
    }
    ctx.globalAlpha = 1;
    particles = particles.filter((p) => p.life > 0);
  }

  // ───────────── the overview strip ─────────────
  function drawMinimap() {
    const ctx = pen.ctx, { CW, CH, night, open, cam } = view;
    screenTransform();
    const w = Math.min(240, CW * 0.42), h = 24, x = CW - w - 10, y = CH - h - 10;
    const mm = (minimap = { x, y, w, h, ix: x + 4, iw: w - 8 });
    const dark = night > 0.5;
    ctx.fillStyle = dark ? 'rgba(21,26,38,0.82)' : 'rgba(251,252,254,0.86)';
    ctx.strokeStyle = dark ? '#353e55' : '#c6cddb'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
    const sx = (wx: number) => mm.ix + (clamp(wx, 0, W) / W) * mm.iw, sy = (wy: number) => y + 4 + clamp((wy - HZ) / (H - HZ), 0, 1) * (h - 8);
    ctx.save(); ctx.beginPath(); ctx.rect(mm.ix, y + 3, mm.iw, h - 6); ctx.clip();
    ctx.fillStyle = dark ? '#3d5a45' : '#bcd8a3'; ctx.fillRect(mm.ix, y + 3, mm.iw, h - 6);
    for (const [a0, a1, light, nightColour] of [[0, 500, '#9cbf86', '#2f4a36'], [500, 800, '#a3c78c', '#34503a'], [1640, 2320, '#ddd093', '#5a5a3c'], [2320, 2840, '#86b96f', '#2f4a32']] as const) {
      ctx.fillStyle = dark ? nightColour : light; ctx.fillRect(sx(a0), y + 3, sx(a1) - sx(a0), h - 6);
    }
    ctx.fillStyle = dark ? '#3c5f86' : '#8fc0d8';
    ctx.beginPath(); ctx.moveTo(sx(shoreX(HZ)), y + 3); ctx.lineTo(sx(shoreX(H)), y + h - 3); ctx.lineTo(mm.ix + mm.iw, y + h - 3); ctx.lineTo(mm.ix + mm.iw, y + 3); ctx.closePath(); ctx.fill();
    for (const p of [POND, POOL]) { E(sx(p.cx), sy(p.cy), (p.rx / W) * mm.iw, Math.max(1.4, (p.ry / (H - HZ)) * (h - 8))); ctx.fill(); }
    ctx.fillStyle = dark ? '#c9d6de' : '#ffffff'; E(sx(FLOE.cx), sy(FLOE.cy), (FLOE.rx / W) * mm.iw, 1.4); ctx.fill();
    ctx.fillStyle = dark ? '#28402e' : '#5f8f4a';
    for (const t of TREES) { E(sx(t.x), sy(t.y), 1.1, 1.1); ctx.fill(); }
    ctx.fillStyle = dark ? 'rgba(21,26,38,0.75)' : 'rgba(236,241,236,0.82)';
    ctx.fillRect(mm.ix, y + 3, sx(open.l) - mm.ix, h - 6); ctx.fillRect(sx(open.r), y + 3, mm.ix + mm.iw - sx(open.r), h - 6);
    ctx.fillStyle = view.accent;
    for (const a of actors) { E(sx(a.x), sy(a.y), 1.4, 1.4); ctx.fill(); }
    ctx.restore();
    ctx.strokeStyle = dark ? '#e6e9f2' : '#1a2033'; ctx.lineWidth = 1.4;
    const vw = Math.min(mm.iw, (viewW() / W) * mm.iw);
    ctx.beginPath(); ctx.roundRect(clamp(sx(cam.x), mm.ix - 1, mm.ix + mm.iw - vw + 1), y + 2, vw, h - 4, 3); ctx.stroke();
  }

  // ───────────── a frame ─────────────
  const sortKey = (a: Actor) => a.anchorY ?? a.y + (onGround(a) || a.move === 'fly' ? 0 : 0.5);
  function draw(dt: number) {
    pen.glows = [];
    pen.ctx = mainCtx;
    drawSky(dt);
    // everything on the ground goes onto its own layer, so the night tint can skip the sky
    pen.ctx = fgCtx;
    fgCtx.setTransform(1, 0, 0, 1, 0, 0); fgCtx.clearRect(0, 0, fg.width, fg.height);
    hills(0.25, '#c4d6bf', (lx) => 30 + 12 * Math.sin(lx / 95) + 8 * Math.sin(lx / 41 + 1), null);
    hills(0.5, '#adc99a', (lx) => 15 + 9 * Math.sin(lx / 150 + 2) + 4 * Math.sin(lx / 57), '#8fb57e');
    drawGround();
    const things: { y: number; draw: () => void }[] = [];
    for (const d of WORLD.decor) if (shown(d) && visible(d.x, 70)) things.push({ y: d.y, draw: () => DECOR[d.kind](d, view.clock) });
    for (const a of actors) if (visible(a.x, 50)) things.push({ y: sortKey(a), draw: () => drawActor(a) });
    things.sort((p, q) => p.y - q.y);
    worldTransform();
    for (const it of things) it.draw();
    drawMist();
    if (view.night > 0.01) {
      // tint only what was drawn on this layer: copy its shape, multiply, cut back to the shape
      maskCtx.setTransform(1, 0, 0, 1, 0, 0); maskCtx.clearRect(0, 0, mask.width, mask.height); maskCtx.drawImage(fg, 0, 0);
      fgCtx.setTransform(1, 0, 0, 1, 0, 0);
      fgCtx.globalCompositeOperation = 'multiply'; fgCtx.globalAlpha = view.night; fgCtx.fillStyle = '#4a5590'; fgCtx.fillRect(0, 0, fg.width, fg.height);
      fgCtx.globalAlpha = 1; fgCtx.globalCompositeOperation = 'destination-in'; fgCtx.drawImage(mask, 0, 0);
      fgCtx.globalCompositeOperation = 'source-over';
    }
    pen.ctx = mainCtx;
    mainCtx.setTransform(1, 0, 0, 1, 0, 0); mainCtx.drawImage(fg, 0, 0);
    drawNightLights();
    drawParticles(dt);
    drawMinimap();
  }

  let last = performance.now(), themeCheck = 0, raf = 0, onScreen = true;
  function readTheme() {
    nightTarget = document.documentElement.dataset.theme === 'dark' ? 1 : 0;
    view.accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || view.accent;
  }
  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ((themeCheck -= dt) <= 0) { readTheme(); themeCheck = 0.5; }
    view.night += (nightTarget - view.night) * Math.min(1, dt * 3);
    const { open, cam } = view;
    let moved = false;
    if (Math.abs(open.gl - open.l) > 0.3 || Math.abs(open.gr - open.r) > 0.3) {
      const k = o.reducedMotion ? 1 : Math.min(1, dt * 1.5);
      open.l += (open.gl - open.l) * k; open.r += (open.gr - open.r) * k; moved = true;
    }
    if (camGoal) {
      cam.x += (camGoal.x - cam.x) * Math.min(1, dt * 4); cam.y += (camGoal.y - cam.y) * Math.min(1, dt * 4);
      if (Math.abs(camGoal.x - cam.x) < 0.5 && Math.abs(camGoal.y - cam.y) < 0.5) camGoal = null;
      clampCam(); moved = true;
    } else if (!drag && (vel.x || vel.y)) {
      cam.x += vel.x * dt; cam.y += vel.y * dt; clampCam();
      const decay = Math.exp(-dt * 5); vel.x *= decay; vel.y *= decay;
      if (Math.hypot(vel.x, vel.y) < 3) vel.x = vel.y = 0;
      moved = true;
    }
    if (!view.paused) {
      view.clock += dt;
      for (const a of actors) update(a, dt);
      // dandelion seeds drift off now and then
      if (traces.dandelion && visible(DANDELIONS.x, 300) && (seedT -= dt) <= 0) {
        seedT = rand(0.9, 2.2);
        particles.push({ kind: 'seed', x: DANDELIONS.x + rand(-10, 9) * DANDELIONS.s, y: DANDELIONS.y - rand(14, 19) * DANDELIONS.s, vx: rand(7, 14), life: 7, seed: Math.random() * 6 });
      }
    }
    if (!view.paused || moved || dirty || particles.length || selected || Math.abs(view.night - nightTarget) > 0.01 || actors.some((a) => a.highlight > 0)) { draw(view.paused ? 0 : dt); dirty = false; }
    if (selected) positionPopover();
    schedule();
  }
  function schedule() { if (!raf && onScreen && !destroyed) raf = requestAnimationFrame(frame); }

  // ───────────── selection ─────────────
  const TRACE_BOX: Record<TraceId, (d: Decor) => readonly [number, number, number, number]> = {
    nest: (d) => { const t = d.tree!, s = t.s; return [t.x + 18 * s, t.y - 68 * s, 9 * s, 6 * s]; },
    ring: (d) => [d.x, d.y - 3, 26 * d.s, 10],
    dandelion: (d) => [d.x, d.y - 9 * d.s, 17 * d.s, 12 * d.s],
    rockflower: (d) => [d.x, d.y - 12 * d.s, 18 * d.s, 15 * d.s],
  };
  function hit(sx: number, sy: number): Actor | Decor | null {
    const { x, y } = toWorld(sx, sy);
    let best: Actor | null = null, bestY = -1;
    for (const a of actors) {
      const e = extent(a), hw = Math.max(5, HALF[a.sprite] * 0.9) * e.k;
      if (x > a.x - hw && x < a.x + hw && y > e.top - 2 && y < e.bottom + 3 && sortKey(a) > bestY) { best = a; bestY = sortKey(a); }
    }
    if (best) return best;
    for (const d of WORLD.decor) {
      if (!d.trace || !shown(d)) continue;
      const [cx, cy, hw, hh] = TRACE_BOX[d.trace](d);
      if (Math.abs(x - cx) < hw && Math.abs(y - cy) < hh) return d;
    }
    return null;
  }
  function select(target: Actor | Decor) {
    selected = target; dirty = true;
    if ('sprite' in target) {
      if (target.sleep <= 0 && grounded(target)) {
        target.hop = 1;
        if (target.sprite === 'hedgehog') { target.special = 'curl'; target.state = 'idle'; target.timer = 2.5; }
      }
      hearts(target);
      o.onSelect({
        kind: 'friend', id: target.ex.id, emoji: target.ex.emoji, sprite: target.sprite, variant: target.variant.label,
        count: friends.filter((f) => f.emoji === target.ex.emoji).length, asleep: target.sleep > 0,
      });
    } else if (target.trace) o.onSelect({ kind: 'trace', trace: target.trace });
    o.popover.style.visibility = 'hidden';
  }
  function deselect() { if (!selected) return; selected = null; dirty = true; o.onSelect(null); }
  /** Below the target, so the hearts rising above stay visible; beside it, with a clear gap, if there is no room below. */
  function positionPopover() {
    const t = selected, pop = o.popover;
    if (!t) return;
    let x: number, bottom: number, top: number, hw: number;
    if ('sprite' in t) { const e = extent(t); x = t.x; bottom = e.bottom; top = e.top; hw = HALF[t.sprite] * e.k; }
    else { const [cx, cy, bw, bh] = TRACE_BOX[t.trace!](t); x = cx; bottom = cy + bh; top = cy - bh; hw = bw; }
    const foot = toScreen(x, bottom), head = toScreen(x, top);
    if (foot.x < -20 || foot.x > view.CW + 20 || !pop.offsetWidth) { pop.style.visibility = 'hidden'; return; }
    pop.style.visibility = '';
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let px = foot.x - w / 2, py = foot.y + 16;
    if (py + h > view.CH - 8) {
      const side = hw * scale() + 26;
      px = foot.x + side + w <= view.CW - 8 ? foot.x + side : foot.x - side - w;
      py = (foot.y + head.y) / 2 - h / 2;
    }
    pop.style.left = `${clamp(px, 8, view.CW - w - 8)}px`;
    pop.style.top = `${clamp(py, 8, view.CH - h - 8)}px`;
  }

  // ───────────── input ─────────────
  const inMinimap = (p: { x: number; y: number }) => !!minimap && p.x >= minimap.x && p.x <= minimap.x + minimap.w && p.y >= minimap.y && p.y <= minimap.y + minimap.h;
  function minimapJump(p: { x: number; y: number }) {
    if (!minimap) return;
    camGoal = null; vel.x = vel.y = 0;
    view.cam.x = ((p.x - minimap.ix) / minimap.iw) * W - viewW() / 2; clampCam(); dirty = true;
  }
  const pointer = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const touches = new Map<number, { x: number; y: number }>();
  let drag: { start: { x: number; y: number }; last: { x: number; y: number }; lastT: number; moved: boolean } | null = null;
  let pinch: { d: number; z: number } | null = null, mmDrag: number | null = null;

  function onDown(e: PointerEvent) {
    const p = pointer(e);
    cv.setPointerCapture(e.pointerId);
    if (inMinimap(p)) { mmDrag = e.pointerId; minimapJump(p); e.preventDefault(); return; }
    touches.set(e.pointerId, p);
    camGoal = null; vel.x = vel.y = 0;
    if (touches.size === 1) drag = { start: p, last: p, lastT: performance.now(), moved: false };
    else if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, z: view.cam.z };
      if (drag) drag.moved = true;
    }
  }
  function onMove(e: PointerEvent) {
    const p = pointer(e);
    if (mmDrag === e.pointerId) { minimapJump(p); return; }
    if (!touches.has(e.pointerId)) { cv.style.cursor = inMinimap(p) || hit(p.x, p.y) ? 'pointer' : ''; return; }
    touches.set(e.pointerId, p);
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, pinch.z * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.d));
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 5) { drag.moved = true; cv.dataset.dragging = ''; }
    if (drag.moved) {
      const now = performance.now(), ddt = Math.max(1, now - drag.lastT) / 1000;
      const dx = (p.x - drag.last.x) / scale(), dy = (p.y - drag.last.y) / scale();
      view.cam.x -= dx; view.cam.y -= dy; clampCam();
      vel.x = o.reducedMotion ? 0 : -dx / ddt; vel.y = o.reducedMotion ? 0 : -dy / ddt;
      drag.last = p; drag.lastT = now; dirty = true;
    }
  }
  function onUp(e: PointerEvent) {
    if (mmDrag === e.pointerId) { mmDrag = null; return; }
    if (!touches.has(e.pointerId)) return;
    const p = pointer(e);
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (touches.size === 0) {
      const wasClick = drag && !drag.moved;
      if (drag && performance.now() - drag.lastT > 90) vel.x = vel.y = 0;
      drag = null; delete cv.dataset.dragging;
      if (wasClick && e.type === 'pointerup') { const t = hit(p.x, p.y); if (t) select(t); else deselect(); }
    } else if (drag) { const remaining = [...touches.values()][0]!; drag.last = remaining; drag.start = remaining; }
  }
  function onWheel(e: WheelEvent) {
    const p = pointer(e);
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(p.x, p.y, view.cam.z * Math.exp(-e.deltaY * 0.01)); return; }
    // only sideways scrolling pans; scrolling down still scrolls the page
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    if (Math.abs(dx) > Math.abs(e.shiftKey ? 0 : e.deltaY)) { e.preventDefault(); camGoal = null; view.cam.x += dx / scale(); clampCam(); dirty = true; }
  }
  function onKey(e: KeyboardEvent) {
    const step = 90;
    const moves: Record<string, readonly [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step / 2], ArrowDown: [0, step / 2] };
    const mv = moves[e.key];
    if (mv) { e.preventDefault(); const from = camGoal ?? view.cam; lookAt(from.x + mv[0] + viewW() / 2, from.y + mv[1] + viewH() * 0.6); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(view.CW / 2, view.CH / 2, view.cam.z * 1.25); }
    else if (e.key === '-') { e.preventDefault(); zoomAt(view.CW / 2, view.CH / 2, view.cam.z / 1.25); }
    else if (e.key === 'Escape') deselect();
  }
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => { resize(); schedule(); });
  ro.observe(holder);
  // Nothing to animate while the meadow is scrolled out of sight.
  const io = new IntersectionObserver(([entry]) => { onScreen = !!entry?.isIntersecting; if (onScreen) { last = performance.now(); schedule(); } });
  io.observe(cv);
  let destroyed = false;

  readTheme();
  view.night = nightTarget;
  resize();
  zoomButtons();
  schedule();

  return {
    set(list, max, earned) {
      total = Math.max(1, max);
      const tracesChanged = (Object.keys(earned) as TraceId[]).some((k) => earned[k] !== traces[k]);
      traces = { ...earned };
      if (tracesChanged) refreshObstacles();
      const known = new Set(friends.map((f) => f.id));
      const first = !started;
      const arrived = first ? [] : list.filter((f) => !known.has(f.id)).map((f) => f.id);
      const before = openGoal(friends), goal = openGoal(list);
      friends = [...list];
      view.open.gl = goal.l; view.open.gr = goal.r;
      if (first) { view.open.l = goal.l; view.open.r = goal.r; clampCam(); }
      syncActors(new Set(arrived));
      for (const id of arrived) {
        const a = actors.find((x) => x.ex.id === id);
        if (a) { a.highlight = 3; setTimeout(() => hearts(a, 4), 600); }
      }
      started = true; dirty = true; schedule();
      return { arrived, grew: !first && (goal.l < before.l - 1 || goal.r > before.r + 1) };
    },
    zoom(factor) { zoomAt(view.CW / 2, view.CH / 2, view.cam.z * factor); schedule(); },
    show(id) {
      const a = actors.find((x) => x.ex.id === id);
      if (!a) return;
      a.highlight = 3; lookAt(a.x, vis(a)); select(a); schedule();
    },
    deselect() { deselect(); schedule(); },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('keydown', onKey);
    },
  };
}

