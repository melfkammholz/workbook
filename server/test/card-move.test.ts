import { describe, expect, it } from 'vitest';
import { scanCards } from '@wb/shared';
import { moveCardTo } from '../src/flashcards/source.js';

const deck = '= Heading\n\n#flashcard(id: "a")[A][1]\n\n#flashcard(id: "b")[B][2]\n\nSome text.\n\n#flashcard(id: "c")[C][3]\n';
const order = (src: string) => scanCards(src).map((c) => c.id).join('');

describe('moving a card to a position', () => {
  it('moves it down and up, past several cards', () => {
    expect(order(moveCardTo(deck, 'a', 2)!)).toBe('bca');
    expect(order(moveCardTo(deck, 'c', 0)!)).toBe('cab');
  });

  it('leaves text between the cards where it was', () => {
    const out = moveCardTo(deck, 'a', 2)!;
    expect(out.startsWith('= Heading\n\n')).toBe(true);
    expect(out).toContain('Some text.');
    expect(out.indexOf('Some text.')).toBeGreaterThan(out.indexOf('id: "b"'));
  });
});
