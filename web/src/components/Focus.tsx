import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Library } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import type { ChapterMeta, Focus, Outline } from '@wb/shared';
import { isExercise, useOutline, useSettings, useState_ } from '@/lib/api';
import { focusOf, focusesOf, inFocus, shownFocus, useSetFocus } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { Dialog, clsx } from './ui';

/** The chapter that is open, if any: the choice is easier to make with numbers from what the student is looking at. */
function useOpenChapter(outline: Outline): ChapterMeta | undefined {
  const [, item] = useRoute('/item/:id');
  const [, chapter] = useRoute('/chapter/:id');
  if (chapter) return outline.chapters.find((c) => c.id === chapter.id);
  if (item) return outline.chapters.find((c) => c.items.some((i) => i.id === item.id));
  return undefined;
}

/** The focuses this course offers, each saying what it shows. */
function FocusChoices({ outline, current, onChoose }: { outline: Outline; current: Focus | null; onChoose: (f: Focus) => void }) {
  const t = useT();
  const chapter = useOpenChapter(outline);
  const offered = focusesOf(outline);
  const exercises = (chapter ? chapter.items : outline.chapters.flatMap((c) => c.items)).filter(isExercise);
  return (
    <ul className="space-y-1.5" role="radiogroup" aria-label={t.focus}>
      {offered.map((f) => {
        const on = current !== null && shownFocus(outline, current) === f;
        return (
          <li key={f}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChoose(f)}
              className={clsx('flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors', on ? 'border-accent bg-accent-soft' : 'border-line bg-paper hover:border-line-strong')}
            >
              <span className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>{on ? <Check size={11} strokeWidth={3} /> : null}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.focusName[f]}</span>
                <span className="block text-[13px] text-ink-2">{t.focusShows(f, exercises.filter((e) => inFocus(e, f)).length, !!chapter, offered.length === 1 || (f === 'everything' && !offered.includes('thorough')))}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Asked once per course, when it is first opened. Closing it keeps the default. */
export function FocusQuestion() {
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  const settings = useSettings().data;
  const setFocus = useSetFocus();
  const [location] = useLocation();
  // After the first-run dialog and the landing page, which come first.
  if (!outline || !state || state.focus !== null || !settings?.setupDone || location === '/welcome') return null;
  if (focusesOf(outline).length < 2) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && setFocus.mutate(shownFocus(outline, focusOf(state)))} title={t.focusAsk} description={t.focusIntro}>
      <FocusChoices outline={outline} current={null} onChoose={(f) => setFocus.mutate(f)} />
    </Dialog>
  );
}

/** Next to the course's name: the focus, and the way to the other courses. */
export function CourseMenu({ onCourses }: { onCourses: () => void }) {
  const t = useT();
  const outline = useOutline().data;
  const state = useState_().data?.state;
  const setFocus = useSetFocus();
  const [open, setOpen] = useState(false);
  if (!outline) return null;
  const choosable = focusesOf(outline).length > 1;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={t.courseMenu} title={t.courseMenu} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-ink-2 transition-colors hover:bg-sunk hover:text-ink">
          {choosable ? <span className="hidden text-[13px] sm:inline">{t.focusName[shownFocus(outline, focusOf(state))]}</span> : null}
          <ChevronsUpDown size={15} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line-strong bg-sheet p-3 shadow-[var(--shadow)]">
          {choosable ? (
            <>
              <p className="mb-2 px-1 text-xs font-semibold text-ink-2">{t.focus}</p>
              <FocusChoices outline={outline} current={focusOf(state)} onChoose={(f) => setFocus.mutate(f)} />
              <div className="my-3 h-px bg-line" />
            </>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCourses();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sunk"
          >
            <Library size={15} className="text-ink-3" /> {t.courses}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
