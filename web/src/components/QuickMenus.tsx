import * as Popover from '@radix-ui/react-popover';
import { Settings as SettingsIcon, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import type { Settings } from '@wb/shared';
import { useSaveSettings, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { applyTheme } from '@/lib/theme';
import { Segmented, Tip, clsx } from './ui';

export const FONT_SIZES = [
  [12.5, 'small'],
  [13.5, 'normal'],
  [15, 'large'],
  [17, 'larger'],
] as const;

const MENU = 'wb-menu w-80 p-2';

/** A setting in a menu: the whole row is the switch, with what it does under its name. */
function MenuSwitch({ checked, onChange, title, body }: { checked: boolean; onChange: (v: boolean) => void; title: string; body?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-sunk">
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        {body ? <span className="block text-[12px] leading-snug text-ink-3">{body}</span> : null}
      </span>
      <span aria-hidden className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}>
        <span className={clsx('absolute left-0.5 top-0.5 size-4 rounded-full bg-sheet shadow-sm transition-transform', checked && 'translate-x-4')} />
      </span>
    </button>
  );
}

function useSet() {
  const save = useSaveSettings();
  return (p: Partial<Settings>) => save.mutate(p);
}

/** The settings changed often, one click from anywhere; the rest stay on the settings page. */
export function QuickSettings() {
  const t = useT();
  const settings = useSettings().data;
  const set = useSet();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label={t.settings}>
        <Popover.Trigger asChild>
          <button type="button" aria-label={t.settings} className={clsx('inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-sunk hover:text-ink', open ? 'bg-sunk text-ink' : 'text-ink-2')}>
            <SettingsIcon size={18} />
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className={MENU} aria-label={t.quickSettings}>
          {settings ? (
            <>
              <p className="mx-2 mb-1.5 mt-1 text-[12px] font-semibold text-ink-3">{t.theme}</p>
              <div className="mx-2 mb-1">
                <Segmented
                  value={settings.theme}
                  options={(['light', 'dark', 'dusk', 'system'] as const).map((th) => [th, t.themes[th]])}
                  onChange={(th) => {
                    applyTheme(th, settings.duskColor, settings.warmPaper);
                    set({ theme: th });
                  }}
                />
              </div>
              <MenuSwitch
                checked={settings.warmPaper}
                onChange={(v) => {
                  applyTheme(settings.theme, settings.duskColor, v);
                  set({ warmPaper: v });
                }}
                title={t.warmPaper}
                body={t.warmPaperBody}
              />
              <hr className="my-1.5 border-line" />
              <MenuSwitch checked={settings.showTimer} onChange={(v) => set({ showTimer: v })} title={t.showTimer} body={t.showTimerBody} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-2">
                <span className="flex-1 text-[13.5px] font-medium">{t.editorTextSize}</span>
                <Segmented<string> value={String(settings.editorFontSize)} options={FONT_SIZES.map(([size, name]) => [String(size), t.editorSizes[name]])} onChange={(v) => set({ editorFontSize: Number(v) })} />
              </div>
              <hr className="my-1.5 border-line" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate('/settings');
                }}
                className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-[13.5px] font-medium text-ink-2 hover:bg-sunk hover:text-ink"
              >
                <SlidersHorizontal size={15} /> {t.allSettings}
              </button>
            </>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Settings that only matter while reading a lesson, on the lesson itself. */
export function LessonOptions() {
  const t = useT();
  const settings = useSettings().data;
  const set = useSet();
  if (!settings) return null;
  return (
    <Popover.Root>
      <Tip label={t.lessonOptions}>
        <Popover.Trigger asChild>
          <button type="button" aria-label={t.lessonOptions} className="hidden size-7 items-center justify-center rounded-md text-ink-3 hover:bg-sunk hover:text-ink sm:inline-flex data-[state=open]:bg-sunk data-[state=open]:text-ink">
            <SlidersHorizontal size={15} />
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={MENU} aria-label={t.lessonOptions}>
          <p className="mx-2 mb-0.5 mt-1 text-[12px] font-semibold text-ink-3">{t.thisLesson}</p>
          <MenuSwitch checked={settings.showAnnotations} onChange={(v) => set({ showAnnotations: v })} title={t.showAnnotations} body={t.lessonHighlightsBody} />
          <MenuSwitch checked={settings.showLessonOutline} onChange={(v) => set({ showLessonOutline: v })} title={t.lessonSectionsInOutline} body={t.showLessonOutlineBody} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
