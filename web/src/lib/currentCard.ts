import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { scanCards, type CardCall } from '@wb/shared';

/**
 * Which card of a deck's text the cursor is in, as its position among the cards
 * (null between cards). The preview marks the card at that position, so it is clear
 * which card is being written. The same scanner as the server's finds the cards.
 */
interface Value {
  cards: CardCall[];
  index: number | null;
}

function pick(state: EditorState, cards: CardCall[]): Value {
  const head = state.selection.main.head;
  const i = cards.findIndex((c) => head >= c.start && head <= c.end);
  return { cards, index: i < 0 ? null : i };
}

const field = StateField.define<Value>({
  create: (state) => pick(state, scanCards(state.doc.toString())),
  update(value, tr) {
    if (tr.docChanged) return pick(tr.state, scanCards(tr.state.doc.toString()));
    return tr.selection ? pick(tr.state, value.cards) : value;
  },
});

/** Calls `onChange` whenever the cursor moves into another card, or out of all of them. */
export function cursorCard(onChange: (index: number | null) => void): Extension {
  return [
    field,
    EditorView.updateListener.of((u) => {
      const before = u.startState.field(field, false)?.index ?? null;
      const now = u.state.field(field).index;
      if (before !== now) onChange(now);
    }),
  ];
}
