import type { Decor, DecorKind, Ellipse, Spot } from './types';

/**
 * The world, in its own units: 300 high, 3500 wide, the horizon at 90. A strip of places from
 * left to right, each where its animals belong: woods, bamboo grove, flower meadow, pond,
 * savanna, jungle with a pool, beach and sea with an ice floe.
 */
export const H = 300, W = 3500, HZ = 90, CENTRE = 1250, START_VIEW = 1180, SHORE0 = 2900;

export function mulberry(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Things further back are smaller. */
export const depth = (y: number) => 0.68 + 0.32 * clamp((y - HZ) / (H - HZ), 0, 1);
/** World units per sprite unit for an animal of this size at this depth. */
export const unit = (y: number, size: number) => 2.1 * depth(y) * size;

export const POND: Ellipse = { cx: 1460, cy: 230, rx: 118, ry: 36 };
export const POOL: Ellipse = { cx: 2590, cy: 252, rx: 72, ry: 22 };
/** In front, near the beach: the far band along the horizon belongs to the whales. */
export const FLOE: Ellipse = { cx: 3200, cy: 228, rx: 78, ry: 12 };
export const PATH: readonly (readonly [number, number])[] = [
  [-30, 262], [180, 238], [400, 208], [640, 214], [900, 198], [1120, 186], [1300, 176], [1460, 168], [1640, 182],
  [1900, 206], [2150, 196], [2400, 184], [2600, 200], [2800, 226], [2960, 244],
];
export function pathY(x: number): number {
  for (let i = 1; i < PATH.length; i++) {
    const [x0, y0] = PATH[i - 1]!, [x1, y1] = PATH[i]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return PATH[PATH.length - 1]![1];
}
export const shoreX = (y: number) => SHORE0 + (y - HZ) * 0.5 + Math.sin(y * 0.07) * 5;
export const inSea = (x: number, y: number) => y >= HZ - 0.5 && x > shoreX(y);
export function inEll(p: Ellipse, x: number, y: number, m = 1): boolean {
  const dx = (x - p.cx) / (p.rx * m), dy = (y - p.cy) / (p.ry * m);
  return dx * dx + dy * dy < 1;
}
export const inPond = (x: number, y: number, m = 1) => inEll(POND, x, y, m) || inEll(POOL, x, y, m);
export const inFloe = (x: number, y: number, m = 1) => inEll(FLOE, x, y, m);
/** Distance on the ground, which is seen at an angle. */
export const gdist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, (ay - by) * 2.6);

/** Ground colours of the biomes, fading into each other. */
export const BIOMES = [
  { x0: 500, x1: 800, c: [163, 199, 140], a: 0.55, edge: 60 },
  { x0: 1640, x1: 2320, c: [216, 204, 140], a: 0.92, edge: 90 },
  { x0: 2320, x1: 2840, c: [140, 192, 122], a: 0.65, edge: 80 },
] as const;
export type Biome = 'woods' | 'bamboo' | 'meadow' | 'pond' | 'savanna' | 'jungle' | 'beach';
export const biomeAt = (x: number): Biome =>
  x < 500 ? 'woods' : x < 800 ? 'bamboo' : x < 1330 ? 'meadow' : x < 1640 ? 'pond' : x < 2320 ? 'savanna' : x < 2840 ? 'jungle' : 'beach';

/** Footprint on the ground (half width, half depth) per kind of object, before scaling. */
const FOOT: Partial<Record<DecorKind, readonly [number, number]>> = {
  round: [12, 4.5], pine: [20, 5], poplar: [9, 4], acacia: [6, 3], palm: [6, 3], bigleaf: [14, 5], termite: [10, 4], bush: [20, 6], rock: [14, 4],
  log: [26, 5], post: [4, 3], mushroom: [4, 2], bamboo: [11, 4], stump: [7, 3], lodge: [20, 6], ring: [24, 8], dandelion: [14, 5], rockflower: [16, 4.5],
};
export const TREE_KINDS = new Set<DecorKind>(['round', 'pine', 'poplar', 'acacia', 'palm']);

export interface Flower { kind: 'daisy' | 'tulip' | 'lavender' | 'buttercup'; x: number; y: number; c: string }
export interface Perch { x: number; gy: number; alt: number }

function build() {
  const rng = mulberry(11);
  const r = (a: number, b: number) => a + rng() * (b - a);
  const decor: Decor[] = [];
  const add = (o: Omit<Decor, 'seed'> & { seed?: number }): Decor => {
    const d: Decor = { ...o, seed: o.seed ?? rng() * 10 };
    const f = FOOT[d.kind];
    if (f) { d.fx = f[0] * d.s; d.fy = f[1] * d.s; }
    decor.push(d);
    return d;
  };
  const free = (x: number, y: number, gap: number, pathGap: number) =>
    !inPond(x, y, 1.45) && x < shoreX(y) - 60 && Math.abs(y - pathY(x)) > pathGap && decor.every((o) => gdist(x, y, o.x, o.y) > gap + o.r);
  type Extra = Partial<Pick<Decor, 'palette' | 'berries' | 'dry' | 'vines'>>;
  const place = (kind: DecorKind, n: number, x0: number, x1: number, y0: number, y1: number, opts: { r?: number; gap?: number; pathGap?: number; extra?: (g: () => number) => Extra } = {}) => {
    for (let i = 0, made = 0; made < n && i < 500; i++) {
      const x = r(x0, x1), y = r(y0, y1);
      if (!free(x, y, opts.gap ?? 34, opts.pathGap ?? 16)) continue;
      add({ kind, x, y, s: depth(y) * r(0.85, 1.15), r: opts.r ?? 0, ...opts.extra?.(rng) });
      made++;
    }
  };
  // Fixed places first, so nothing is put on top of them.
  const owlTree = add({ kind: 'round', x: 1060, y: 150, s: 1, r: 12, owl: true, palette: 0 });
  const nestTree = add({ kind: 'round', x: 870, y: 128, s: depth(128), r: 12, palette: 1 });
  const koalaTrees = [
    add({ kind: 'round', x: 2330, y: 132, s: depth(132), r: 12, palette: 5, koala: true, trunk: '#cdc3b2' }),
    add({ kind: 'round', x: 2268, y: 236, s: depth(236), r: 12, palette: 5, koala: true, trunk: '#cdc3b2' }),
  ];
  const slothTree = add({ kind: 'round', x: 2480, y: 150, s: depth(150), r: 12, palette: 4, sloth: true, vines: true });
  add({ kind: 'nest', trace: 'nest', x: nestTree.x, y: nestTree.y + 0.01, s: nestTree.s, r: 0, tree: nestTree });
  add({ kind: 'ring', trace: 'ring', x: 960, y: 268, s: depth(268), r: 26 });
  add({ kind: 'dandelion', trace: 'dandelion', x: 1185, y: 272, s: depth(272), r: 18 });
  add({ kind: 'rockflower', trace: 'rockflower', x: 1215, y: 138, s: depth(138), r: 18 });
  add({ kind: 'lodge', x: POND.cx - 58, y: POND.cy - 12, s: 1, r: 0 });
  add({ kind: 'stump', x: POND.cx - POND.rx - 42, y: POND.cy - 20, s: depth(POND.cy - 20), r: 9 });
  for (const [dx, dy, s] of [[-1.02, 0.55, 0.8], [0.98, 0.5, 1], [0.86, -0.75, 0.6]] as const) add({ kind: 'rock', x: POND.cx + POND.rx * dx, y: POND.cy + POND.ry * dy + 6, s, r: 12 * s });
  const post = add({ kind: 'post', x: POND.cx - POND.rx - 18, y: POND.cy + 16, s: 1, r: 5 });
  // woods
  place('pine', 10, 20, 480, HZ + 14, 270, { r: 9, gap: 34 });
  place('poplar', 3, 40, 480, HZ + 20, 260, { r: 8, gap: 30 });
  place('log', 1, 120, 380, 200, 260, { r: 18, gap: 40 });
  place('bush', 2, 40, 470, 160, 285, { r: 14, extra: (g) => ({ berries: g() < 0.5 ? '#c24a6a' : '#5a63c9' }) });
  place('mushroom', 8, 20, 480, HZ + 30, 290, { gap: 12, pathGap: 10 });
  place('fern', 7, 10, 490, HZ + 30, 290, { gap: 14, pathGap: 10 });
  // bamboo grove
  place('bamboo', 7, 510, 790, HZ + 16, 286, { r: 10, gap: 26, pathGap: 14 });
  place('fern', 3, 500, 800, HZ + 30, 290, { gap: 14, pathGap: 10 });
  // flower meadow
  place('round', 2, 840, 1300, HZ + 30, 280, { r: 12, gap: 70, extra: (g) => ({ palette: g() < 0.5 ? 1 : 2 }) });
  place('bush', 3, 820, 1320, 140, 290, { r: 14, gap: 50, extra: (g) => ({ berries: g() < 0.4 ? '#c24a6a' : null }) });
  place('rock', 1, 840, 1300, 160, 290, { r: 12, gap: 60 });
  place('poplar', 1, 820, 1320, HZ + 20, 200, { r: 8, gap: 50 });
  // savanna
  place('acacia', 5, 1690, 2280, HZ + 14, 275, { r: 12, gap: 80 });
  place('termite', 2, 1690, 2280, 150, 285, { r: 10, gap: 60 });
  place('rock', 6, 1720, 2260, 120, 290, { r: 12, gap: 36 });
  place('bush', 2, 1660, 2300, 140, 285, { r: 14, gap: 60, extra: () => ({ dry: true }) });
  // jungle
  place('round', 2, 2380, 2800, HZ + 16, 280, { r: 12, gap: 60, extra: () => ({ palette: 4, vines: true }) });
  place('palm', 4, 2340, 2820, HZ + 14, 280, { r: 9, gap: 40 });
  place('bigleaf', 7, 2330, 2830, 120, 292, { r: 12, gap: 30, pathGap: 12 });
  // beach
  for (const y of [140, 262]) add({ kind: 'rock', x: shoreX(y) - 34, y, s: depth(y) * 0.9, r: 12 });
  add({ kind: 'palm', x: shoreX(118) - 44, y: 118, s: depth(118), r: 9 });

  const flat: Flower[] = [];
  const kinds: Flower['kind'][] = ['daisy', 'daisy', 'tulip', 'lavender', 'buttercup'];
  const tulips = ['#e2574c', '#f08a3c', '#e77fa8'];
  for (let i = 0, n = 0; n < 96 && i < 1600; i++) {
    const zone = n < 58 ? [820, 1330] : n < 74 ? [10, 800] : n < 84 ? [1330, 1640] : [2330, 2830];
    const x = r(zone[0]!, zone[1]!), y = r(HZ + 20, 292);
    if (inPond(x, y, 1.35) || x > shoreX(y) - 70 || Math.abs(y - pathY(x)) < 11 || decor.some((o) => o.r && gdist(x, y, o.x, o.y) < o.r + 6)) continue;
    const jungle = x > 2320;
    flat.push({ kind: jungle ? 'tulip' : kinds[Math.floor(rng() * kinds.length)]!, x, y, c: jungle ? (rng() < 0.5 ? '#e2574c' : '#f08a3c') : tulips[Math.floor(rng() * 3)]! });
    n++;
  }
  const tufts: { x: number; y: number }[] = [];
  for (let i = 0; i < 620; i++) { const x = r(0, SHORE0), y = r(HZ + 6, H); if (!inPond(x, y, 1.15) && x < shoreX(y) - 70 && Math.abs(y - pathY(x)) > 9) tufts.push({ x, y }); }
  const patchColor: Record<Biome, string> = { woods: '#a3c28c', bamboo: '#9cc286', meadow: '#c9dfa6', pond: '#b3d197', savanna: '#e4d89b', jungle: '#86b96f', beach: '#b3d197' };
  const patches: { x: number; y: number; rx: number; ry: number; c: string }[] = [];
  for (let i = 0; i < 40; i++) { const x = r(0, SHORE0 - 80), y = r(HZ + 20, H); patches.push({ x, y, rx: r(60, 150), ry: r(14, 30), c: patchColor[biomeAt(x)] }); }
  const flies: { x: number; y: number; p: number; s: number }[] = [];
  for (let i = 0; i < 44; i++) flies.push({ x: i < 18 ? r(0, 800) : i < 32 ? r(800, 1640) : r(2320, 2840), y: r(HZ + 10, H - 10), p: rng() * 6, s: 0.5 + rng() });
  const stars: { x: number; h: number; r: number; p: number }[] = [];
  for (let i = 0; i < 90; i++) stars.push({ x: r(0, 1700), h: r(40, HZ + 60), r: 0.5 + rng() * 1.1, p: rng() * 6 });
  const clouds: { x: number; h: number; s: number }[] = [];
  for (let i = 0; i < 6; i++) clouds.push({ x: r(0, 1400), h: r(HZ - 70, HZ - 25), s: r(0.6, 1.1) });
  const fish: { water: Ellipse | null; x: number; y: number; p: number; s: number; r: number }[] = [];
  for (let i = 0; i < 4; i++) fish.push({ water: POND, x: 0, y: 0, p: rng() * 6, s: 0.25 + rng() * 0.3, r: 0.3 + rng() * 0.4 });
  for (let i = 0; i < 2; i++) fish.push({ water: POOL, x: 0, y: 0, p: rng() * 6, s: 0.3 + rng() * 0.3, r: 0.4 + rng() * 0.3 });
  for (let i = 0; i < 7; i++) fish.push({ water: null, x: r(SHORE0 + 140, W - 40), y: r(HZ + 50, H - 20), p: rng() * 6, s: 0.2 + rng() * 0.3, r: 0 });
  const waves: { x: number; y: number; p: number }[] = [];
  for (let i = 0; i < 34; i++) { const y = r(HZ + 4, H - 4), x = r(shoreX(y) + 20, W); if (!inFloe(x, y, 1.2)) waves.push({ x, y, p: rng() * 6 }); }
  return {
    decor, flat, tufts, patches, flies, stars, clouds, fish, waves,
    perch: { x: owlTree.x + 25.5, gy: owlTree.y + 1, alt: 52 } satisfies Perch,
    postTop: { x: post.x, gy: post.y + 1, alt: 31 } satisfies Perch,
    koalas: koalaTrees.map((t): Perch => ({ x: t.x - 9 * t.s, gy: t.y + 0.6, alt: 60 * t.s })),
    sloth: { x: slothTree.x + 24 * slothTree.s, gy: slothTree.y + 0.6, alt: 50 * slothTree.s, span: 9 * slothTree.s },
  };
}

export const WORLD = build();
export const TREES = WORLD.decor.filter((o) => TREE_KINDS.has(o.kind));
export const ROUNDS = WORLD.decor.filter((o) => o.kind === 'round');
export const ACACIAS = WORLD.decor.filter((o) => o.kind === 'acacia');
export const ROCKS = WORLD.decor.filter((o) => o.kind === 'rock' || o.kind === 'rockflower');
export const BAMBOO = WORLD.decor.filter((o) => o.kind === 'bamboo');
export const STUMP = WORLD.decor.find((o) => o.kind === 'stump')!;
export const LODGE = WORLD.decor.find((o) => o.kind === 'lodge')!;
export const DANDELIONS = WORLD.decor.find((o) => o.kind === 'dandelion')!;
/** Places a bird can sit in a crown. */
export const CANOPIES: { t: Decor; spot: () => Spot }[] = [
  ...ROUNDS.filter((t) => !t.owl).map((t) => ({ t, spot: () => ({ x: t.x + rand(-20, 20) * t.s, y: t.y + 0.6, alt: rand(68, 96) * t.s }) })),
  ...WORLD.decor.filter((o) => o.kind === 'palm').map((t) => ({ t, spot: () => ({ x: t.x + (12 + rand(-8, 8)) * t.s, y: t.y + 0.6, alt: 74 * t.s }) })),
];
