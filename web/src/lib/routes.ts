import { loadEditor } from '@/components/CodeEditor';
import { lazyComponent } from './lazy';

/**
 * Pages are loaded after the first bundle, so the app paints before they arrive: the page it opens on at once, every
 * other one when the browser is idle, and any page as soon as a link to it is pointed at or focused. A page that is
 * loaded renders at once (`lazyComponent`), so changing pages never waits for code.
 */
export const ItemPage = lazyComponent(() => Promise.all([import('@/pages/ItemPage'), loadEditor(), import('@/components/widgets')]).then(([m]) => m.ItemPage));
export const ReviewPage = lazyComponent(() => import('@/pages/ReviewPage').then((m) => m.ReviewPage));
export const SettingsPage = lazyComponent(() => import('@/pages/SettingsPage').then((m) => m.SettingsPage));
export const LandingPage = lazyComponent(() => import('@/pages/LandingPage').then((m) => m.LandingPage));
export const AchievementsPage = lazyComponent(() => import('@/pages/AchievementsPage').then((m) => m.AchievementsPage));
export const NotesPage = lazyComponent(() => Promise.all([import('@/pages/NotesPage'), loadEditor()]).then(([m]) => m.NotesPage));
export const HighlightsPage = lazyComponent(() => import('@/pages/HighlightsPage').then((m) => m.HighlightsPage));
export const QuestionsPage = lazyComponent(() => import('@/pages/QuestionsPage').then((m) => m.QuestionsPage));
export const MaterialsPage = lazyComponent(() => import('@/pages/MaterialsPage').then((m) => m.MaterialsPage));
export const PdfPage = lazyComponent(() => import('@/pages/PdfPage').then((m) => m.PdfPage));
export const LibraryPage = lazyComponent(() => import('@/pages/MaterialsPage').then((m) => m.LibraryPage));
export const FlashcardsPage = lazyComponent(() => import('@/pages/FlashcardsPage').then((m) => m.FlashcardsPage));
export const DeckPage = lazyComponent(() => Promise.all([import('@/pages/DeckPage'), loadEditor()]).then(([m]) => m.DeckPage));
export const FlashcardReview = lazyComponent(() => import('@/pages/FlashcardReview').then((m) => m.FlashcardReview));
export const StrugglingPage = lazyComponent(() => import('@/pages/StrugglingPage').then((m) => m.StrugglingPage));
export const HelpPage = lazyComponent(() => import('@/pages/HelpPage').then((m) => m.HelpPage));
export const ChapterPage = lazyComponent(() => import('@/pages/ChapterPage').then((m) => m.ChapterPage));
export const KindPage = lazyComponent(() => import('@/pages/KindPage').then((m) => m.KindPage));
export const AdventurePage = lazyComponent(() => import('@/pages/AdventurePage').then((m) => m.AdventurePage));

/** The first part of an address that decides its page, longest first. In order of how often they are opened. */
const PREFIXES: [string, { preload: () => Promise<void> }][] = [
  ['/item/', ItemPage],
  ['/chapter/', ChapterPage],
  ['/review', ReviewPage],
  ['/notes', NotesPage],
  ['/questions', QuestionsPage],
  ['/flashcards/deck/', DeckPage],
  ['/flashcards/review/', FlashcardReview],
  ['/flashcards/look', StrugglingPage],
  ['/flashcards', FlashcardsPage],
  ['/highlights', HighlightsPage],
  ['/materials', MaterialsPage],
  ['/library', LibraryPage],
  ['/resources/', PdfPage],
  ['/achievements', AchievementsPage],
  ['/adventure/', AdventurePage],
  ['/kind/', KindPage],
  ['/settings', SettingsPage],
  ['/help', HelpPage],
  ['/welcome', LandingPage],
];

/** Starts loading the page at `path` (an app path like `/item/x`), if it is not loaded yet. */
export function preloadRoute(path: string): void {
  const hit = PREFIXES.find(([prefix]) => path.startsWith(prefix));
  if (hit) void hit[1].preload().catch(() => undefined);
}

/** Loads a link's page when it is pointed at or focused, and all pages, one by one, while the browser is idle. */
export function preloadLinks(): () => void {
  const on = (e: Event) => {
    const href = (e.target as Element | null)?.closest?.('a[href^="#/"]')?.getAttribute('href');
    if (href) preloadRoute(href.slice(1));
  };
  addEventListener('pointerover', on, { passive: true });
  addEventListener('focusin', on);
  let idle = 0;
  let stopped = false;
  const next = (i: number) => {
    if (stopped || i >= PREFIXES.length) return;
    idle = requestIdleCallback(() => void PREFIXES[i]![1].preload().then(() => next(i + 1), () => next(i + 1)), { timeout: 4000 });
  };
  next(0);
  return () => {
    stopped = true;
    removeEventListener('pointerover', on);
    removeEventListener('focusin', on);
    cancelIdleCallback(idle);
  };
}
