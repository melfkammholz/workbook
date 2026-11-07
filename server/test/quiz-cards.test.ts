import { describe, expect, it } from 'vitest';
import { scanCards } from '@wb/shared';
import { withQuizSources } from '../src/content/typst.js';
import { cardText, fieldsOf, unitsOf } from '../src/flashcards/source.js';

const quiz = '[Was ergibt `1 + 1`?],\nchoice[`3`][Fast.],\nchoice(correct: true)[`2`][Genau.],';

describe('quiz cards', () => {
  it('are written like the quiz in a lesson, and read back the same', () => {
    const text = cardText('quiz', quiz, '', 'kurs/lektion', 'k3f9', ['fold']);
    expect(text.startsWith('#quiz(id: "k3f9", from: "kurs/lektion", tags: ("fold",), \n')).toBe(true);
    const [card] = scanCards(text);
    expect(card?.kind).toBe('quiz');
    expect(card?.id).toBe('k3f9');
    expect(fieldsOf(text, card!).front).toBe(quiz);
    expect(unitsOf(text, card!)).toEqual([{ key: 'k3f9', cardId: 'k3f9', side: 'front', gap: null }]);
  });

  it('give a lesson quiz its own text, without moving any line', () => {
    const lesson = `Text\n#quiz(\n  ${quiz.split('\n').join('\n  ')}\n)\nMehr`;
    const out = withQuizSources(lesson);
    expect(out.split('\n')).toHaveLength(lesson.split('\n').length);
    const src = /_src: ("(?:[^"\\]|\\.)*")/.exec(out)?.[1];
    expect(JSON.parse(src!)).toBe(quiz);
  });
});
