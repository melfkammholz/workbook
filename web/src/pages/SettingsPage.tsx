import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Settings, UiLanguage } from '@wb/shared';
import { api, keys, useSaveSettings, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { applyTheme } from '@/lib/theme';
import { Button, Segmented } from '@/components/ui';
import { BackLink } from '@/lib/history';

const inputClass = 'h-9 w-full rounded-md border border-line bg-paper px-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none';

const FONT_SIZES = [
  [12.5, 'small'],
  [13.5, 'normal'],
  [15, 'large'],
  [17, 'larger'],
] as const;

/** A text field that saves when it loses focus, so typing does not write on every key. */
function SavedInput({ value, onSave, ...p }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...p}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== value) onSave(draft.trim());
        setDraft(null);
      }}
      className={inputClass}
    />
  );
}

function Toggle({ checked, onChange, title, body }: { checked: boolean; onChange: (v: boolean) => void; title: string; body?: string }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        {body ? <span className="block text-[13px] text-ink-2">{body}</span> : null}
      </span>
    </label>
  );
}

/** Deletes everything the student did, everywhere. Asks once more, in place, with what it means. */
function StartOver() {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <section className="mt-6 space-y-2 border-t border-line pt-5">
      <h3 className="text-sm font-semibold">{t.resetAllTitle}</h3>
      <p className="text-[13px] text-ink-2">{t.resetAllBody}</p>
      {asking ? (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm">
          <p className="text-danger">{t.resetAllConfirm}</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t.cancel}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              className="border-danger text-danger"
              onClick={async () => {
                setBusy(true);
                setFailed(false);
                try {
                  await api.post('/api/reset-all', { confirm: 'reset' });
                  // Everything the app holds is out of date; a fresh start is simplest.
                  location.hash = '#/';
                  location.reload();
                } catch {
                  setFailed(true);
                  setBusy(false);
                }
              }}
            >
              {t.resetAllButton}
            </Button>
          </div>
          {failed ? <p className="mt-2 text-danger">{t.couldNotSave}</p> : null}
        </div>
      ) : (
        <Button size="sm" onClick={() => setAsking(true)}>
          {t.resetAllButton}
        </Button>
      )}
    </section>
  );
}

/** The settings, on a page of their own: there are enough of them to be read, not just flicked through. */
export function SettingsPage() {
  const t = useT();
  const settings = useSettings().data;
  const save = useSaveSettings();
  const info = useQuery({ queryKey: keys.info, queryFn: () => api.get<{ typst: string }>('/api/info'), staleTime: Infinity });

  if (!settings) return null;
  const set = (p: Partial<Settings>) => save.mutate(p);

  return (
    <div className="h-full overflow-y-auto">
      <div className="settle mx-auto max-w-2xl px-6 pb-24 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="mb-6 text-[1.75rem] font-semibold tracking-[-0.02em]">{t.settings}</h1>
      <section className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t.yourName}</span>
          <SavedInput value={settings.displayName} onSave={(v) => set({ displayName: v })} placeholder={t.namePlaceholder} />
        </label>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t.theme}</legend>
          <Segmented
            value={settings.theme}
            options={(['system', 'light', 'dark'] as const).map((th) => [th, t.themes[th]])}
            onChange={(th) => {
              applyTheme(th);
              set({ theme: th });
            }}
          />
        </fieldset>

        <Toggle checked={settings.safeColors} onChange={(v) => set({ safeColors: v })} title={t.safeColors} body={t.safeColorsBody} />
        <Toggle checked={settings.showLessonOutline} onChange={(v) => set({ showLessonOutline: v })} title={t.showLessonOutline} body={t.showLessonOutlineBody} />

        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t.language}</legend>
          <Segmented<UiLanguage> value={settings.uiLanguage} options={(['auto', 'de', 'en'] as const).map((l) => [l, t.languages[l]])} onChange={(l) => set({ uiLanguage: l })} />
          <p className="mt-1 text-[13px] text-ink-3">{t.languageNote}</p>
        </fieldset>
      </section>

      <section className="mt-6 space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">{t.timerTitle}</h3>
        <Toggle checked={settings.showTimer} onChange={(v) => set({ showTimer: v })} title={t.showTimer} body={t.showTimerBody} />
        <label className="block text-sm">
          <span className="font-medium">{t.helpAfter}</span>{' '}
          <input
            type="number"
            min={0}
            max={1440}
            value={settings.helpAfterMinutes}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 0 && n <= 1440) set({ helpAfterMinutes: n });
            }}
            className="mx-1 h-8 w-20 rounded-md border border-line bg-paper px-2 text-sm focus:border-accent focus:outline-none"
          />{' '}
          {t.minutes}
          <span className="block text-[13px] text-ink-3">{t.helpAfterBody}</span>
        </label>
      </section>

      <section className="mt-6 space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">{t.editorTitle}</h3>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t.editorFontSize}</legend>
          <Segmented<string> value={String(settings.editorFontSize)} options={FONT_SIZES.map(([size, name]) => [String(size), t.editorSizes[name]])} onChange={(v) => set({ editorFontSize: Number(v) })} />
        </fieldset>
        <Toggle checked={settings.editorKeys === 'vim'} onChange={(v) => set({ editorKeys: v ? 'vim' : 'default' })} title={t.editorVim} body={t.editorVimBody} />
      </section>

      <section className="mt-6 space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">{t.optionalFeatures}</h3>
        <Toggle checked={settings.showAchievements} onChange={(v) => set({ showAchievements: v })} title={t.showAchievements} body={t.showAchievementsBody} />
        {settings.showAchievements ? (
          <div className="ml-7 space-y-2.5">
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t.rewardsWhat}</legend>
              <Segmented<'all' | 'zoo'> value={settings.rewards} options={[['all', t.rewardsAll], ['zoo', t.rewardsZoo]]} onChange={(v) => set({ rewards: v })} />
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t.rewardIconTitle}</legend>
              <Segmented<'trophy' | 'paw'> value={settings.rewardIcon} options={[['trophy', t.rewardIconTrophy], ['paw', t.rewardIconPaw]]} onChange={(v) => set({ rewardIcon: v })} />
            </fieldset>
          </div>
        ) : null}
        <Toggle checked={settings.showFlashcards} onChange={(v) => set({ showFlashcards: v })} title={t.showFlashcards} body={t.showFlashcardsBody} />
        <Toggle checked={settings.showAi} onChange={(v) => set({ showAi: v })} title={t.showAi} body={t.showAiBody} />
      </section>

      <StartOver />

      {info.data?.typst === 'unavailable' ? <p className="mt-6 border-t border-line pt-4 text-xs text-ink-3">{t.typstMissing}</p> : null}
      </div>
    </div>
  );
}
