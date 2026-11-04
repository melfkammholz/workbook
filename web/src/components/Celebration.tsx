import { Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AchievementEvent, EarnedEvent } from '@wb/shared';
import { acknowledgeAchievements, useAchievements } from '@/lib/api';
import { useT, type Strings } from '@/lib/i18n';
import { PLANTS } from './Plant';

const CONFETTI_EVENT = 'wb-confetti';
const SHOW_MS = 7000;
const CHECK_MS = 250;
const COLORS = ['var(--accent)', 'var(--done)', 'var(--review)', 'var(--danger)'];

/** A small burst of colour. Silent, brief, and left out for anyone who asked for reduced motion (see styles.css). */
export function confetti(): void {
  dispatchEvent(new Event(CONFETTI_EVENT));
}

export function describeEvent(t: Strings, e: AchievementEvent): { title: string; body: string } {
  switch (e.kind) {
    case 'achievement':
      return t.achievementList[e.id] ?? { title: e.id, body: '' };
    case 'comeback':
      return { title: t.comebackTitle, body: t.comebackBody(e.title, t.confidence[e.from as 1] ?? String(e.from), t.confidence[e.to as 1] ?? String(e.to)) };
    case 'plant':
      return { title: `${PLANTS[e.stage]} ${e.chapter}`, body: t.plantGrew[e.stage] };
    case 'adventure':
      return { title: t.adventureDoneTitle, body: e.title };
    case 'animal':
      return { title: e.friend ? t.animalFriend(e.emoji) : t.animalJoined(e.emoji), body: e.title };
  }
}

interface Row {
  key: string;
  title: string;
  body: string;
}

interface Card {
  key: string;
  rows: Row[];
  /** A single piece of news gets a title and a line of detail. */
  single: boolean;
}

const NEWS_ORDER: AchievementEvent['kind'][] = ['achievement', 'comeback', 'adventure', 'animal', 'plant'];

/**
 * Everything earned at the same moment goes on one card, as equal rows: no piece of news
 * should read as the headline of another. Next to other news each row is kept short.
 * A plant that has only just started says too little to announce; it still shows in the outline.
 */
function cardFor(t: Strings, events: EarnedEvent[]): Card | null {
  const news = events.filter((e) => !(e.event.kind === 'plant' && e.event.stage === 1)).sort((a, b) => NEWS_ORDER.indexOf(a.event.kind) - NEWS_ORDER.indexOf(b.event.kind));
  if (news.length === 0) return null;
  const single = news.length === 1;
  const rows = news.map((e): Row => {
    const { title, body } = describeEvent(t, e.event);
    // Achievements and comebacks are rarer, so they keep their line of detail.
    if (single || e.event.kind === 'achievement' || e.event.kind === 'comeback') return { key: e.key, title, body };
    if (e.event.kind === 'plant' || e.event.kind === 'adventure') return { key: e.key, title: `${title}: ${body.replace(/\.$/, '')}`, body: '' };
    return { key: e.key, title, body: '' };
  });
  return { key: news[0]!.key, rows, single };
}

/** Says what was just earned, in a corner, without getting in the way. */
export function Celebration() {
  const t = useT();
  const { data } = useAchievements();
  const [shown, setShown] = useState<Card[]>([]);
  const [burst, setBurst] = useState(0);
  const known = useRef(new Set<string>());
  const waiting = useRef<EarnedEvent[]>([]);

  useEffect(() => {
    if (data?.earned.length === 0) known.current.clear();
    for (const e of data?.unseen ?? []) {
      if (known.current.has(e.key)) continue;
      known.current.add(e.key);
      waiting.current.push(e);
    }
  }, [data]);

  // Most things are earned by marking an exercise as done, which opens a dialog. A message behind
  // it would fade unseen, so it waits, and it only counts as seen once it has really been shown.
  useEffect(() => {
    const timer = setInterval(() => {
      if (waiting.current.length === 0 || document.querySelector('[role=dialog]')) return;
      const fresh = waiting.current.splice(0);
      void acknowledgeAchievements();
      const card = cardFor(t, fresh);
      if (!card) return;
      setShown((s) => [...s, card]);
      // Reaching a milestone gets the burst; every small step would get tiresome.
      if (fresh.some((e) => (e.event.kind === 'plant' ? e.event.stage === 3 : e.event.kind !== 'animal'))) confetti();
      setTimeout(() => setShown((s) => s.filter((x) => x !== card)), SHOW_MS);
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [t]);

  useEffect(() => {
    const on = () => setBurst((b) => b + 1);
    addEventListener(CONFETTI_EVENT, on);
    return () => removeEventListener(CONFETTI_EVENT, on);
  }, []);

  return (
    <>
      {burst > 0 ? (
        <div key={burst} aria-hidden className="wb-confetti">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} style={{ '--x': `${Math.cos((i / 18) * 2 * Math.PI) * (90 + (i % 3) * 45)}px`, '--y': `${Math.sin((i / 18) * 2 * Math.PI) * (70 + (i % 4) * 35)}px`, background: COLORS[i % COLORS.length] } as React.CSSProperties} />
          ))}
        </div>
      ) : null}
      {shown.length ? (
        <ul className="pointer-events-none fixed bottom-4 right-4 z-40 flex max-h-[calc(100vh-5rem)] w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto" role="status">
          {shown.map((card) => (
            <li key={card.key} className="settle pointer-events-auto flex items-start gap-3 rounded-lg border border-accent/40 bg-sheet p-3 shadow-[var(--shadow)]">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
                {card.rows.map((row) => (
                  <li key={row.key}>
                    <span className="block font-semibold">{row.title}</span>
                    {row.body ? <span className="block text-ink-2">{row.body}</span> : null}
                  </li>
                ))}
              </ul>
              <button type="button" aria-label={t.close} onClick={() => setShown((s) => s.filter((x) => x !== card))} className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
