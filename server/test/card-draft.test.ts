import { describe, expect, it } from 'vitest';
import { scanCards } from '@wb/shared';
import { cardText, replaceCard, unitsOf } from '../src/flashcards/source.js';

describe('draft cards', () => {
  const src = `${cardText('basic', 'Q', 'A', null, 'a', [], null, null, true)}\n`;
  const card = () => scanCards(src)[0]!;

  it('are written as draft: true, read back, and never asked', () => {
    expect(src).toContain('draft: true');
    expect(card().draft).toBe(true);
    expect(unitsOf(src, card())).toEqual([]);
  });

  it('stay drafts when edited, until kept', () => {
    expect(scanCards(replaceCard(src, 'a', 'basic', 'Q2', 'A2', [])!)[0]!.draft).toBe(true);
    const kept = replaceCard(src, 'a', 'basic', 'Q', 'A', [], { draft: false })!;
    expect(scanCards(kept)[0]!.draft).toBe(false);
    expect(unitsOf(kept, scanCards(kept)[0]!)).toHaveLength(1);
  });
});
