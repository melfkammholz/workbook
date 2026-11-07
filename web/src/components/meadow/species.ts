import type { Move, Sprite, Variant, VariantLabel, Water } from './types';

/** The default animals (server/src/content/ids.ts) and their drawings. Anything else is shown as its emoji. */
export const DRAWN: Record<string, Sprite> = {
  '🦊': 'fox', '🐻': 'bear', '🐝': 'bee', '🦉': 'owl', '🦔': 'hedgehog', '🦦': 'otter', '🐧': 'penguin', '🐢': 'turtle',
  '🦒': 'giraffe', '🐘': 'elephant', '🦋': 'butterfly', '🐙': 'octopus', '🦜': 'parrot', '🐳': 'whale', '🦎': 'lizard',
  '🐼': 'panda', '🦘': 'kangaroo', '🦥': 'sloth', '🐿️': 'squirrel', '🦚': 'peacock', '🐺': 'wolf', '🦓': 'zebra',
  '🐨': 'koala', '🦁': 'lion', '🐯': 'tiger', '🦩': 'flamingo', '🐞': 'ladybug', '🐬': 'dolphin', '🦭': 'seal', '🦫': 'beaver',
};
export const spriteOf = (emoji: string): Sprite => DRAWN[emoji] ?? 'emoji';

interface Spec { move: Move; water?: Water; size: number; speed: number }
/** How each animal gets around, its size and its speed in world units per second. */
export const SPEC: Record<Sprite, Spec> = {
  fox: { move: 'walk', size: 1, speed: 34 }, bear: { move: 'walk', size: 1.15, speed: 20 }, hedgehog: { move: 'walk', size: 0.78, speed: 15 },
  owl: { move: 'perch', size: 0.85, speed: 70 }, penguin: { move: 'amph', water: 'sea', size: 0.85, speed: 17 }, turtle: { move: 'amph', water: 'pond', size: 0.8, speed: 7 },
  bee: { move: 'fly', size: 0.55, speed: 42 }, butterfly: { move: 'fly', size: 0.65, speed: 26 }, otter: { move: 'amph', water: 'pond', size: 0.95, speed: 18 },
  elephant: { move: 'walk', size: 1.45, speed: 13 }, giraffe: { move: 'walk', size: 1, speed: 16 }, octopus: { move: 'swim', water: 'sea', size: 0.85, speed: 6 },
  parrot: { move: 'fly', size: 0.62, speed: 55 }, whale: { move: 'swim', water: 'far', size: 1.6, speed: 8 }, lizard: { move: 'walk', size: 0.55, speed: 30 },
  panda: { move: 'walk', size: 1.1, speed: 12 }, kangaroo: { move: 'walk', size: 1, speed: 30 }, sloth: { move: 'hang', size: 0.8, speed: 1.2 },
  squirrel: { move: 'walk', size: 0.55, speed: 45 }, peacock: { move: 'walk', size: 0.95, speed: 14 }, wolf: { move: 'walk', size: 1.05, speed: 30 },
  zebra: { move: 'walk', size: 1.15, speed: 22 }, koala: { move: 'sit', size: 0.75, speed: 0 }, lion: { move: 'walk', size: 1.25, speed: 18 },
  tiger: { move: 'walk', size: 1.2, speed: 22 }, flamingo: { move: 'wade', size: 0.95, speed: 10 }, ladybug: { move: 'fly', size: 0.35, speed: 16 },
  dolphin: { move: 'swim', water: 'sea', size: 1.25, speed: 30 }, seal: { move: 'amph', water: 'sea', size: 1, speed: 10 }, beaver: { move: 'amph', water: 'pond', size: 0.85, speed: 14 },
  emoji: { move: 'walk', size: 1, speed: 20 },
};

/** Where each animal lives: it keeps mostly to this stretch of the world. */
export const HOME: Record<Sprite, readonly [number, number]> = {
  fox: [0, 1330], wolf: [0, 820], bear: [0, 1640], hedgehog: [0, 1330], squirrel: [0, 1330], owl: [800, 1640], panda: [500, 800],
  bee: [800, 1330], butterfly: [800, 1640], ladybug: [800, 1330], emoji: [800, 1330],
  elephant: [1640, 2320], zebra: [1640, 2320], lion: [1640, 2320], giraffe: [1640, 2320], kangaroo: [1640, 2320], lizard: [1640, 2320], koala: [2260, 2400],
  peacock: [2320, 2840], tiger: [2320, 2840], parrot: [2320, 2840], sloth: [2320, 2840],
  turtle: [1300, 1640], beaver: [1300, 1640], otter: [1300, 1640],
  flamingo: [2800, 3150], penguin: [2860, 3500], seal: [2860, 3500], dolphin: [2900, 3500], octopus: [2900, 3200], whale: [3000, 3500],
};

/** Half the body length, in sprite units: footprints, hit tests, the card. */
export const HALF: Record<Sprite, number> = {
  fox: 15, bear: 16, hedgehog: 9, penguin: 6, turtle: 10, elephant: 17, otter: 12, emoji: 7, owl: 6, bee: 5, butterfly: 5, giraffe: 13, octopus: 6,
  parrot: 6, whale: 21, lizard: 7, panda: 16, kangaroo: 8, sloth: 7, squirrel: 6, peacock: 9, wolf: 15, zebra: 14, koala: 5, lion: 15, tiger: 15,
  flamingo: 6, ladybug: 3, dolphin: 12, seal: 11, beaver: 10,
};
/** Half the body's depth: how much ground it takes up towards the viewer. */
export const DEEP: Partial<Record<Sprite, number>> = { elephant: 8, whale: 8, bear: 6.5, panda: 6.5, lion: 6, tiger: 6, zebra: 6, giraffe: 5.5, hedgehog: 3.5, lizard: 3, squirrel: 3, ladybug: 2 };
export const TALL: Record<Sprite, number> = {
  fox: 22, bear: 22, hedgehog: 10, owl: 16, penguin: 18, turtle: 9, bee: 6, butterfly: 7, otter: 8, elephant: 26, emoji: 13, giraffe: 50, octopus: 16,
  parrot: 9, whale: 8, lizard: 5, panda: 22, kangaroo: 26, sloth: 16, squirrel: 13, peacock: 20, wolf: 23, zebra: 28, koala: 19, lion: 22, tiger: 21,
  flamingo: 30, ladybug: 4, dolphin: 9, seal: 10, beaver: 11,
};
export const NOCTURNAL = new Set<Sprite>(['owl', 'hedgehog']);
export const SLEEPLESS = new Set<Sprite>(['whale', 'dolphin', 'octopus']);

// Repeats of one animal differ a little. The first is as drawn; the others get one quiet difference.
const VARIANTS: readonly Omit<Variant, 'wing'>[] = [
  { shade: 0, size: 1, label: 'first' },
  { shade: -0.15, size: 1, label: 'darker' },
  { shade: 0.1, size: 0.82, label: 'young' },
  { shade: 0.17, size: 1, label: 'paler' },
  { shade: -0.06, size: 1.1, label: 'big' },
  { shade: 0.05, size: 0.9, label: 'small' },
];
const SPECIES_VARIANTS: Partial<Record<Sprite, Record<number, Partial<Variant>>>> = {
  fox: { 1: { shade: 0, mark: 'socks', label: 'socks' } },
  bear: { 1: { shade: 0, mark: 'chest', label: 'chest' } },
  squirrel: { 1: { shade: -0.3, label: 'dark' } },
  peacock: { 2: { shade: 0, size: 1, mark: 'white', label: 'white' } },
  whale: { 2: { shade: 0.08, size: 0.6, label: 'calf' } },
};
const BUTTERFLY: readonly (readonly [string, string, VariantLabel])[] = [
  ['#9a7bf0', '#c4b2f7', 'violet'], ['#5b8fe0', '#a9c6f2', 'blue'], ['#f08a3c', '#f7c08f', 'orange'],
  ['#f2cf3a', '#f7e48f', 'yellow'], ['#f4f1ea', '#d9d4c8', 'whiteWings'], ['#e77fa8', '#f3b8cf', 'pink'],
];
export const FIRST_WING = [BUTTERFLY[0]![0], BUTTERFLY[0]![1]] as const;

export function variantOf(sprite: Sprite, n: number): Variant {
  const v: Variant = { ...VARIANTS[n % VARIANTS.length]!, ...(SPECIES_VARIANTS[sprite]?.[n] ?? {}) };
  if (sprite === 'butterfly') {
    const b = BUTTERFLY[n % BUTTERFLY.length]!;
    return { shade: 0, size: 1, label: b[2], wing: [b[0], b[1]] };
  }
  return v;
}
