import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { askQuestion, useOutline } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePageKeys } from '@/lib/keys';
import { CaptureField, QuestionCard } from './Questions';

/** What is open, as a place for a question; a PDF has its own line, so it has no place here. */
function useOpenPlace(location: string): { item: string | null; title: string | null } {
  const outline = useOutline().data;
  const item = /^\/item\/([^/]+)/.exec(location)?.[1];
  const chapter = /^\/chapter\/([^/]+)/.exec(location)?.[1];
  if (item) {
    const id = decodeURIComponent(item);
    const found = outline?.chapters.flatMap((c) => c.items).find((i) => i.id === id);
    return { item: id, title: found?.title ?? id };
  }
  if (chapter) {
    const id = decodeURIComponent(chapter);
    return { item: `chapter/${id}`, title: outline?.chapters.find((c) => c.id === id)?.title ?? id };
  }
  return { item: null, title: null };
}

/**
 * `q` anywhere opens the same card as under a PDF, floating at the bottom of the content, to write a question into; it
 * is tied to the exercise, lesson or chapter that is open (named in the placeholder), else to nothing. In a PDF the
 * pinned card takes the key instead. Enter saves and keeps it open; Escape or leaving it empty fades it out.
 */
export function QuestionPopup() {
  const t = useT();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const area = useContentArea(open);
  const place = useOpenPlace(location);
  const close = () => setLeaving(true);
  usePageKeys({
    q: () => {
      if (location.startsWith('/resources/')) document.querySelector<HTMLTextAreaElement>('[data-pdf-question]')?.focus();
      else {
        setLeaving(false);
        setOpen(true);
      }
    },
  });
  useEffect(() => {
    setOpen(false);
    setLeaving(false);
  }, [location]);
  if (!open) return null;
  return (
    <div
      className={`pointer-events-none fixed bottom-5 z-50 flex justify-center px-4 ${leaving ? 'wb-pop-out' : 'wb-pop-in'}`}
      style={{ left: area.left, width: area.width }}
      onAnimationEnd={() => leaving && setOpen(false)}
    >
      <QuestionCard className="pointer-events-auto w-full max-w-xl">
        <CaptureField
          autoFocus
          placeholder={place.title ? t.questionAbout(place.title) : t.questionAboutNothing}
          onCancel={close}
          onBlurEmpty={close}
          onSave={(text, o) => void askQuestion(place.item ? { item: place.item } : {}, text)}
        />
      </QuestionCard>
    </div>
  );
}

/** The span of the page's main area, so the card is centered on the content rather than on the whole window. */
function useContentArea(active: boolean) {
  const [area, setArea] = useState({ left: 0, width: innerWidth });
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const r = document.querySelector('main')?.getBoundingClientRect();
      setArea(r && r.width > 0 ? { left: r.left, width: r.width } : { left: 0, width: innerWidth });
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [active]);
  return area;
}
