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
 * `q` anywhere opens the same card as under a PDF, floating at the bottom, to write a question into; it is tied to the
 * exercise, lesson or chapter that is open, else to nothing. In a PDF the pinned card takes the key instead. Enter
 * saves and keeps it open, Escape closes it.
 */
export function QuestionPopup() {
  const t = useT();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const place = useOpenPlace(location);
  usePageKeys({
    q: () => {
      if (location.startsWith('/resources/')) document.querySelector<HTMLTextAreaElement>('[data-pdf-question]')?.focus();
      else setOpen(true);
    },
  });
  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <QuestionCard
        context={place.title ? t.questionAbout(place.title) : t.questionAboutNothing}
        onClose={() => setOpen(false)}
        className="pointer-events-auto w-full max-w-xl"
      >
        <CaptureField autoFocus onCancel={() => setOpen(false)} onSave={(text, o) => void askQuestion(place.item ? { item: place.item } : {}, text, o.continuePass)} />
      </QuestionCard>
    </div>
  );
}
