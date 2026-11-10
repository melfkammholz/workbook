import { useState } from 'react';
import type { Settings, UiLanguage } from '@wb/shared';
import { useCourseAction, useCourses, useSaveSettings, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { applyTheme } from '@/lib/theme';
import { CourseUrlField, courseErrorText } from './CourseDialog';
import { Button, Dialog, Segmented } from './ui';

/** First start: the few choices worth making up front. Everything can be skipped and changed later. */
export function SetupDialog() {
  const t = useT();
  const settings = useSettings().data;
  const save = useSaveSettings();
  const needsCourse = useCourses().data?.activeId === null;
  const action = useCourseAction();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  if (!settings || settings.setupDone) return null;

  const set = (p: Partial<Settings>) => save.mutate(p);
  const finish = (withName: boolean) => set({ setupDone: true, ...(withName && name.trim() ? { displayName: name.trim() } : {}) });
  /** The dialog stays open if the course could not be added, so the address can be corrected. */
  const start = () => {
    if (action.isPending) return;
    if (needsCourse && url.trim()) action.mutate({ type: 'add', url }, { onSuccess: () => finish(true) });
    else finish(true);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && finish(false)} title={t.setupTitle} description={t.setupBody}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        {needsCourse ? (
          <div className="mb-4">
            <CourseUrlField autoFocus value={url} onChange={setUrl} busy={action.isPending} error={action.error ? courseErrorText(t, action.error) : null} />
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t.yourName}</span>
          <input
            autoFocus={!needsCourse}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            className="h-9 w-full rounded-md border border-line bg-paper px-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </label>

        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium">{t.language}</legend>
          <Segmented<UiLanguage> value={settings.uiLanguage} options={(['auto', 'de', 'en'] as const).map((l) => [l, t.languages[l]])} onChange={(l) => set({ uiLanguage: l })} />
          <p className="mt-1 text-[13px] text-ink-3">{t.languageNote}</p>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium">{t.theme}</legend>
          <Segmented
            value={settings.theme}
            options={(['system', 'light', 'dusk', 'dark'] as const).map((th) => [th, t.themes[th]])}
            onChange={(th) => {
              applyTheme(th, settings?.duskColor);
              set({ theme: th });
            }}
          />
        </fieldset>

        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" checked={settings.showAchievements} onChange={(e) => set({ showAchievements: e.target.checked })} className="mt-1 size-4 accent-[var(--accent)]" />
          <span>
            <span className="block text-sm font-medium">{t.showAchievements}</span>
            <span className="block text-[13px] text-ink-2">{t.showAchievementsBody}</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3">
          <input type="checkbox" checked={settings.showFlashcards} onChange={(e) => set({ showFlashcards: e.target.checked })} className="mt-1 size-4 accent-[var(--accent)]" />
          <span>
            <span className="block text-sm font-medium">{t.showFlashcards}</span>
            <span className="block text-[13px] text-ink-2">{t.showFlashcardsBody}</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3">
          <input type="checkbox" checked={settings.showAnnotations} onChange={(e) => set({ showAnnotations: e.target.checked })} className="mt-1 size-4 accent-[var(--accent)]" />
          <span>
            <span className="block text-sm font-medium">{t.showAnnotations}</span>
            <span className="block text-[13px] text-ink-2">{t.showAnnotationsBody}</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3">
          <input type="checkbox" checked={settings.showAi} onChange={(e) => set({ showAi: e.target.checked })} className="mt-1 size-4 accent-[var(--accent)]" />
          <span>
            <span className="block text-sm font-medium">{t.showAi}</span>
            <span className="block text-[13px] text-ink-2">{t.showAiBody}</span>
          </span>
        </label>

        {save.isError ? (
          <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {t.couldNotSave}: {save.error.message}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => finish(false)}>
            {t.setupLater}
          </Button>
          <Button variant="primary" type="submit" disabled={action.isPending}>
            {t.setupStart}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
