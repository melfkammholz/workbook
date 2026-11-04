import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Settings, UiLanguage } from '@wb/shared';
import { api, keys, useSaveSettings, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { applyTheme } from '@/lib/theme';
import { Dialog, Segmented } from './ui';

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
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        {body ? <span className="block text-[13px] text-ink-2">{body}</span> : null}
      </span>
    </label>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const settings = useSettings().data;
  const save = useSaveSettings();
  const info = useQuery({ queryKey: keys.info, queryFn: () => api.get<{ typst: string }>('/api/info'), staleTime: Infinity });

  if (!settings) return null;
  const set = (p: Partial<Settings>) => save.mutate(p);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.settings} width="max-w-xl">
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
        <h3 className="text-sm font-semibold">{t.achievements}</h3>
        <Toggle checked={settings.showAchievements} onChange={(v) => set({ showAchievements: v })} title={t.showAchievements} body={t.showAchievementsBody} />
      </section>

      {info.data?.typst === 'unavailable' ? <p className="mt-6 border-t border-line pt-4 text-xs text-ink-3">{t.typstMissing}</p> : null}
    </Dialog>
  );
}
