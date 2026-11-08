import { useSyncExternalStore } from 'react';

/** The sections of the open lesson and the one being read, for the outline. */
export interface LessonToc {
  id: string;
  sections: { title: string; el: HTMLElement }[];
  active: number;
}

let current: LessonToc | null = null;
const listeners = new Set<() => void>();

export function setLessonToc(next: LessonToc | null): void {
  current = next;
  listeners.forEach((l) => l());
}

export function useLessonToc(): LessonToc | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** A heading as a title: its code in backticks, as titles are written, so the outline shows it as code. */
function titleOf(el: HTMLElement): string {
  let out = '';
  el.childNodes.forEach((n) => {
    out += n instanceof HTMLElement && n.tagName === 'CODE' ? `\`${n.textContent ?? ''}\`` : (n.textContent ?? '');
  });
  return out.trim();
}

/** Follows the headings of a lesson while it is read. */
export function watchLesson(id: string, root: HTMLElement): () => void {
  const headings = [...root.querySelectorAll<HTMLElement>('.wb-lesson > h2')];
  const sections = headings.map((el) => ({ title: titleOf(el), el }));
  const scroller = root.closest<HTMLElement>('.overflow-y-auto') ?? document.documentElement;
  const update = () => {
    const top = scroller.getBoundingClientRect().top + 120;
    let active = 0;
    headings.forEach((h, i) => {
      if (h.getBoundingClientRect().top <= top) active = i;
    });
    // At the very end, the last section is the one being read, however short it is.
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) active = headings.length - 1;
    if (current?.id !== id || current.active !== active) setLessonToc({ id, sections, active });
  };
  setLessonToc({ id, sections, active: 0 });
  update();
  scroller.addEventListener('scroll', update, { passive: true });
  return () => {
    scroller.removeEventListener('scroll', update);
    if (current?.id === id) setLessonToc(null);
  };
}
