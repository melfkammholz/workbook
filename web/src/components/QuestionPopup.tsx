import { useState } from 'react';
import { useLocation } from 'wouter';
import { askQuestion, useOutline } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePageKeys } from '@/lib/keys';
import { CaptureField } from './Questions';
import { Dialog } from './ui';

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
 * `q` anywhere opens a small box to write a question into; it is tied to the exercise, lesson or chapter that is open,
 * else to nothing. In a PDF the pinned line at the bottom takes the key instead. Enter saves and keeps the box open,
 * Escape closes it.
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
  return (
    <Dialog open={open} onOpenChange={setOpen} title={t.questionsTitle} description={place.title ? t.questionAbout(place.title) : t.questionAboutNothing} width="max-w-md">
      <CaptureField autoFocus onSave={(text, carryOn) => void askQuestion(place.item ? { item: place.item } : {}, text, carryOn)} />
    </Dialog>
  );
}
