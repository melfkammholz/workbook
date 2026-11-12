import { useQuery } from '@tanstack/react-query';
import type { Anchor, CardKind, CardRating, CourseCards, DeckDoc, DeckPreview, DeckSaved, DeckSettings, FlashcardsResponse, ReviewNext, StrugglingCard } from '@wb/shared';
import { api } from './api';

/** A student's day starts at 4 in the morning, so a late evening still counts as that day. */
export function dayStart(now = new Date()): number {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
  return d.getTime();
}

export const cardKeys = {
  all: ['flashcards'] as const,
  list: ['flashcards', 'list'] as const,
  deck: (id: string) => ['flashcards', 'deck', id] as const,
};

export const useFlashcards = () => useQuery({ queryKey: cardKeys.list, queryFn: () => api.get<FlashcardsResponse>(`/api/flashcards?today=${dayStart()}`), staleTime: 30_000 });

export const useDeck = (id: string) => useQuery({ queryKey: cardKeys.deck(id), queryFn: () => api.get<DeckDoc>(`/api/flashcards/decks/${encodeURIComponent(id)}`), staleTime: Infinity, retry: false });

const deckUrl = (id: string) => `/api/flashcards/decks/${encodeURIComponent(id)}`;

export const createDeck = (title: string, forCourse = false) => api.post<DeckDoc>('/api/flashcards/decks', { title, forCourse });
export const updateDeck = (id: string, patch: { title?: string; settings?: Partial<DeckSettings> }) => api.patch<DeckDoc>(deckUrl(id), patch);
export const deleteDeck = (id: string) => api.delete(deckUrl(id));
export const saveDeckSource = (id: string, source: string) => api.put<DeckSaved>(`${deckUrl(id)}/source`, { source });
export const addCard = (id: string, card: { kind: CardKind; front: string; back: string; tags?: string[]; exercise: string | null; highlight?: string | null; anchor?: Anchor | null; after?: string | null; from?: string | null }) => api.post<DeckSaved & { cardId: string }>(`${deckUrl(id)}/cards`, card);
export const previewDeck = (source: string) => api.post<DeckPreview>('/api/flashcards/preview', { source });
export const deckPrompt = (id: string, lang: 'de' | 'en') => api.post<{ text: string }>(`${deckUrl(id)}/prompt`, { lang });

export const nextCard = (decks: string[], ahead: boolean) =>
  api.get<ReviewNext>(`/api/flashcards/review?today=${dayStart()}&decks=${decks.map(encodeURIComponent).join(',')}${ahead ? '&ahead=1' : ''}`);
export const rateCard = (key: string, rating: CardRating) => api.post<{ struggling: boolean }>('/api/flashcards/review', { key, rating });
export const buryCard = (key: string) => api.post(`/api/flashcards/bury?today=${dayStart()}`, { key });


const indent = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => (l.trim() ? `  ${l}` : ''))
    .join('\n');

/** The same text the server writes for a card, for a preview of one being written. */
export function cardText(kind: CardKind, front: string, back: string): string {
  if (kind === 'quiz') return `#quiz(id: "preview",\n${indent(front)}\n)`;
  const head = kind === 'cloze' ? '#cloze(id: "preview")' : kind === 'both' ? '#flashcard(id: "preview", both: true)' : '#flashcard(id: "preview")';
  return kind === 'cloze' ? `${head}[\n${indent(front)}\n]` : `${head}[\n${indent(front)}\n][\n${indent(back)}\n]`;
}

export interface CardFields {
  kind: CardKind;
  front: string;
  back: string;
  tags: string[];
  /** Where the card came from, as written in the deck. Sent back when editing: null drops it. */
  from?: string | null;
  highlight?: string | null;
  /** A page or passage it points at. Null drops it. */
  anchor?: Anchor | null;
}

export const editCard = (deck: string, card: string, f: CardFields) => api.put<DeckSaved>(`${deckUrl(deck)}/cards/${encodeURIComponent(card)}`, f);
export const deleteCard = (deck: string, card: string) => api.delete<DeckSaved>(`${deckUrl(deck)}/cards/${encodeURIComponent(card)}`);
export const moveCardBy = (deck: string, card: string, direction: -1 | 1) => api.post<DeckSaved>(`${deckUrl(deck)}/cards/${encodeURIComponent(card)}/move`, { direction });
/** Dragged: the card becomes the `to`-th card of the deck. */
export const moveCardTo = (deck: string, card: string, to: number) => api.post<DeckSaved>(`${deckUrl(deck)}/cards/${encodeURIComponent(card)}/move`, { to });
export const keepCard = (card: string) => api.post(`/api/flashcards/cards/${encodeURIComponent(card)}/keep`);
export const useStruggling = (deck: string | null) =>
  useQuery({ queryKey: ['flashcards', 'struggling', deck], queryFn: () => api.get<StrugglingCard[]>(`/api/flashcards/struggling${deck ? `?deck=${encodeURIComponent(deck)}` : ''}`), staleTime: 0 });
export const useCourseCards = (enabled: boolean) => useQuery({ queryKey: ['flashcards', 'course'], queryFn: () => api.get<CourseCards>('/api/flashcards/course'), enabled, staleTime: 0 });

/** A deck as a file: its Typst text, named after it. Everything a deck is, so it can be kept, shared and imported again. */
export function downloadDeck(title: string, source: string): void {
  const name = `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'deck'}.typ`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The largest file a deck can be made from (the server takes up to 1 MB of text). */
export const MAX_DECK_FILE = 1_000_000;

/** A new deck from a downloaded one: named after the file. Cards whose ids another deck already uses get new ones. */
export async function importDeck(file: File, forCourse: boolean): Promise<DeckDoc> {
  const text = await file.text();
  const title = file.name.replace(/\.(typ|txt)$/i, '').trim().slice(0, 200) || 'Deck';
  const deck = await createDeck(title, forCourse);
  await saveDeckSource(deck.id, text);
  return deck;
}
