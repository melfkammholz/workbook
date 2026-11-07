export type Sprite =
  | 'fox' | 'bear' | 'bee' | 'owl' | 'hedgehog' | 'otter' | 'penguin' | 'turtle' | 'giraffe' | 'elephant'
  | 'butterfly' | 'octopus' | 'parrot' | 'whale' | 'lizard' | 'panda' | 'kangaroo' | 'sloth' | 'squirrel' | 'peacock'
  | 'wolf' | 'zebra' | 'koala' | 'lion' | 'tiger' | 'flamingo' | 'ladybug' | 'dolphin' | 'seal' | 'beaver'
  /** An emoji without a drawing, e.g. one an author picked. */
  | 'emoji';

/** How an animal gets around. */
export type Move = 'walk' | 'amph' | 'swim' | 'fly' | 'perch' | 'sit' | 'hang' | 'wade';
export type Water = 'pond' | 'sea' | 'far';
export type TraceId = 'nest' | 'ring' | 'dandelion' | 'rockflower';

export type VariantLabel =
  | 'first' | 'darker' | 'young' | 'paler' | 'big' | 'small'
  | 'socks' | 'chest' | 'dark' | 'white' | 'calf'
  | 'violet' | 'blue' | 'orange' | 'yellow' | 'whiteWings' | 'pink';

export interface Variant {
  shade: number;
  size: number;
  label: VariantLabel;
  mark?: 'socks' | 'chest' | 'white';
  wing?: readonly [string, string];
}

/** One animal friend: the recommended exercise it came with. */
export interface Friend {
  id: string;
  title: string;
  chapter: string;
  emoji: string;
}

export interface Ellipse { cx: number; cy: number; rx: number; ry: number }
export interface Spot { x: number; y: number; alt?: number; perch?: boolean }

export type DecorKind =
  | 'round' | 'pine' | 'poplar' | 'acacia' | 'palm' | 'bigleaf' | 'termite' | 'bush' | 'rock' | 'log' | 'post'
  | 'mushroom' | 'fern' | 'bamboo' | 'stump' | 'lodge' | 'nest' | 'ring' | 'dandelion' | 'rockflower';

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  s: number;
  /** Room kept free around it when the world is laid out. */
  r: number;
  seed: number;
  /** Footprint on the ground, if animals have to walk around it. */
  fx?: number;
  fy?: number;
  trace?: TraceId;
  palette?: number;
  owl?: boolean;
  koala?: boolean;
  sloth?: boolean;
  vines?: boolean;
  trunk?: string;
  berries?: string | null;
  dry?: boolean;
  tree?: Decor;
}

export type Special =
  | 'curl' | 'float' | 'sit' | 'howl' | 'sniff' | 'fish' | 'lie' | 'browse' | 'eat' | 'gnaw' | 'bask'
  | 'graze' | 'fan' | 'feed' | 'wave' | 'nut' | 'fluke';
export type Plan = 'visit' | 'sniff' | 'fish' | 'soak' | 'browse' | 'eat' | 'gnaw' | 'bask' | 'climb';

export interface Actor {
  ex: Friend;
  nth: number;
  variant: Variant;
  sprite: Sprite;
  move: Move;
  water?: Water;
  size: number;
  speed: number;
  x: number; y: number; tx: number; ty: number;
  /** Height above the ground (fliers, climbers, perches). */
  alt: number; talt: number; alt0: number; d0: number;
  dir: number;
  /** Smoothed heading. */
  hx: number; hy: number; flipT: number;
  state: 'idle' | 'go';
  timer: number;
  phase: number;
  t: number;
  seed: number;
  /** How far it is under water, in sprite units. */
  sink: number;
  hop: number;
  highlight: number;
  special: Special | null;
  look: number;
  onPost: boolean;
  sleep: number;
  zt: number;
  toBed: boolean;
  plan: Plan | null;
  partner: Actor | null;
  goal: Decor | null;
  dodge: { b: Actor; sign: number; t: number } | null;
  wait: number;
  resume: number;
  wet: boolean;
  wetPond: Ellipse;
  diving: boolean;
  fishT: number;
  swipe: number;
  climb: { tree: Decor; t: number; top: number; stay: number; mode: 'up' | 'top' | 'down' } | null;
  jump: { t: number; dur: number; h: number } | null;
  after: Spot | null;
  spoutT: number;
  yawn: number;
  effT: number;
  anchorY: number | null;
  perchSpot: boolean;
  wd: { t: number; d: number } | null;
}
