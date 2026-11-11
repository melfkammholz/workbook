import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Library } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import type { Focus, Outline } from '@wb/shared';
import { isExercise, useCourseAction, useCourses, useOutline, useSettings, useState_ } from '@/lib/api';
import { focusOf, focusesOf, inFocus, shownFocus, useSetFocus } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { Dialog, clsx } from './ui';

/** The focuses this course offers, each saying what it shows. */
function FocusChoices({ outline, current, onChoose }: { outline: Outline; current: Focus | null; onChoose: (f: Focus) => void }) {
  const t = useT();
  const offered = focusesOf(outline);
  // Always the whole course: numbers that change with the page would read like different focuses.
  const exercises = outline.chapters.flatMap((c) => c.items).filter(isExercise);
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
                <span className="block text-[13px] text-ink-2">{t.focusShows(f, exercises.filter((e) => inFocus(e, f)).length, false, offered.length === 1 || (f === 'everything' && !offered.includes('thorough')))}</span>
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

/** Next to the course's name: which course, and how much of it in sight. */
export function CourseMenu({ onCourses }: { onCourses: () => void }) {
  const t = useT();
  const outline = useOutline().data;
  const courses = useCourses().data;
  const state = useState_().data?.state;
  const setFocus = useSetFocus();
  const act = useCourseAction();
  const [open, setOpen] = useState(false);
  if (!outline) return null;
  const choosable = focusesOf(outline).length > 1;
  const heading = 'mb-1.5 px-1 text-xs font-semibold text-ink-2';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={t.courseMenu} title={t.courseMenu} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2 text-ink-2 transition-colors hover:border-line-strong hover:bg-sunk hover:text-ink">
          <Library size={14} className="text-ink-3" />
          {choosable ? <span className="hidden text-[13px] sm:inline">{t.focusName[shownFocus(outline, focusOf(state))]}</span> : null}
          <ChevronsUpDown size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="wb-menu w-80 max-w-[calc(100vw-2rem)] p-3">
          <p className={heading}>{t.course}</p>
          <ul className="space-y-0.5" role="radiogroup" aria-label={t.course}>
            {(courses?.courses ?? []).map((c) => {
              const on = c.id === courses?.activeId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setOpen(false);
                      if (!on) act.mutate({ type: 'activate', id: c.id });
                    }}
                    className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', on ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-sunk hover:text-ink')}
                  >
                    <span className={clsx('grid size-4 shrink-0 place-items-center rounded-full', on ? 'bg-accent text-accent-ink' : 'border border-line-strong')}>{on ? <Check size={10} strokeWidth={3} /> : null}</span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCourses();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-sunk hover:text-ink"
          >
            <Library size={14} className="text-ink-3" /> {t.manageCourses}
          </button>
          {choosable ? (
            <>
              <div className="my-3 h-px bg-line" />
              <p className={heading}>{t.focus}</p>
              <FocusChoices outline={outline} current={focusOf(state)} onChoose={(f) => setFocus.mutate(f)} />
            </>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
