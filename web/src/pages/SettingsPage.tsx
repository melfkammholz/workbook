import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ANNOTATION_COLORS, DUSK_COLORS, isCustomColor, normalizeColor, type AnnotationColor, type HighlightLabel, type Settings, type UiLanguage } from '@wb/shared';
import { Plus, X } from 'lucide-react';
import { api, keys, useSaveSettings, useSettings } from '@/lib/api';
import { swatchProps } from '@/lib/annotations';
import { useT } from '@/lib/i18n';
import { applyTheme } from '@/lib/theme';
import { Button, Segmented, clsx } from '@/components/ui';
import { SectionedPage, type PageSection } from '@/components/SectionedPage';
import { FONT_SIZES } from '@/components/QuickMenus';

const inputClass = 'h-9 w-full rounded-md border border-line bg-paper px-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none';


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

/** Colors offered for a new label once the four of the palette are taken. */
const MORE_COLORS = ['#f2b36d', '#b9a3f2', '#7fd6d0', '#e58a8a', '#a8c97f', '#8fb4e8', '#d9a0d9', '#c9c27a'];

/** A color to pick freely. Changes when the picker is closed, so a drag through colors is not saved on the way. */
function CustomColor({ value, label, onPick }: { value: string; label: string; onPick: (hex: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = ref.current;
    const on = () => el && pick.current(el.value);
    el?.addEventListener('change', on);
    return () => el?.removeEventListener('change', on);
  }, []);
  const custom = isCustomColor(value);
  return (
    <label title={label} className={clsx('relative grid size-7 cursor-pointer place-items-center rounded-md hover:bg-sunk', '[&:has(:focus-visible)]:ring-2 [&:has(:focus-visible)]:ring-accent')}>
      <span
        aria-hidden
        {...(custom ? swatchProps(value) : {})}
        className={clsx('wb-ann-swatch grid size-4.5 place-items-center rounded-full border border-ink/15', custom ? 'ring-2 ring-accent ring-offset-1 ring-offset-sheet' : 'border-dashed bg-transparent text-ink-3')}
        style={custom ? swatchProps(value).style : { background: 'transparent' }}
      >
        {custom ? null : <Plus size={11} />}
      </span>
      <input ref={ref} type="color" defaultValue={custom ? value : '#f2b36d'} aria-label={label} className="absolute inset-0 size-full cursor-pointer opacity-0" />
    </label>
  );
}

/** The student's own names for highlights. Each has its own color: one of the palette, or one added. */
function LabelsEditor({ labels, onChange }: { labels: HighlightLabel[]; onChange: (l: HighlightLabel[]) => void }) {
  const t = useT();
  const safe = !!useSettings().data?.safeColors;
  const colorNames = safe ? t.annColorSafe : t.annColor;
  const [taken, setTaken] = useState(false);
  const change = (id: string, patch: Partial<HighlightLabel>) => onChange(labels.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const usedByOther = (id: string, color: string) => labels.some((l) => l.id !== id && l.color === color);
  const setColor = (id: string, color: string) => {
    const c = normalizeColor(color);
    if (usedByOther(id, c)) return setTaken(true);
    setTaken(false);
    change(id, { color: c as AnnotationColor });
  };
  const free = [...ANNOTATION_COLORS, ...MORE_COLORS].find((c) => !labels.some((l) => l.color === c));
  return (
    <div className="ml-7 max-w-lg space-y-2">
      <p className="text-sm font-medium">{t.annLabelsTitle}</p>
      <p className="text-[13px] text-ink-2">{t.annLabelsBody}</p>
      <ul className="space-y-1.5">
        {labels.map((l) => (
          <li key={l.id} className="flex items-center gap-2">
            <input
              defaultValue={l.name}
              maxLength={60}
              aria-label={t.annLabelName}
              placeholder={t.annLabelPlaceholder}
              onBlur={(e) => e.target.value !== l.name && change(l.id, { name: e.target.value.trim() })}
              className="h-8.5 min-w-0 flex-1 rounded-md border border-line-strong bg-sheet px-2 focus:border-accent focus:outline-none"
            />
            <span role="group" aria-label={t.annLabelColor} className="flex items-center">
              {ANNOTATION_COLORS.map((c) => {
                const used = usedByOther(l.id, c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={used}
                    onClick={() => setColor(l.id, c)}
                    aria-pressed={l.color === c}
                    aria-label={colorNames[c]}
                    title={used ? t.annColorTaken(colorNames[c]) : colorNames[c]}
                    className="grid size-7 place-items-center rounded-md hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <span data-color={c} className={clsx('wb-ann-swatch size-4.5 rounded-full border border-ink/15', l.color === c && 'ring-2 ring-accent ring-offset-1 ring-offset-sheet')} />
                  </button>
                );
              })}
              <CustomColor value={l.color} label={t.annColorOwn} onPick={(hex) => setColor(l.id, hex)} />
            </span>
            <button type="button" onClick={() => onChange(labels.filter((x) => x.id !== l.id))} aria-label={t.annLabelRemove(l.name)} title={t.annLabelRemove(l.name)} className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-sunk hover:text-danger">
              <X size={15} />
            </button>
          </li>
        ))}
      </ul>
      {taken ? (
        <p role="status" className="text-[13px] text-review">
          {t.annColorUsed}
        </p>
      ) : null}
      {free && labels.length < 30 ? (
        <Button onClick={() => onChange([...labels, { id: crypto.randomUUID().slice(0, 8), name: '', color: free as AnnotationColor }])}>
          <Plus size={14} /> {t.annLabelAdd}
        </Button>
      ) : null}
    </div>
  );
}

/** Deletes everything the student did, everywhere. Asks once more, in place, with what it means. */
function StartOver() {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-2">
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
    </div>
  );
}

/** The settings, laid out like the help: sections with a table of contents, each one can be linked to. */
export function SettingsPage({ section }: { section?: string }) {
  const t = useT();
  const settings = useSettings().data;
  const save = useSaveSettings();
  const info = useQuery({ queryKey: keys.info, queryFn: () => api.get<{ typst: string }>('/api/info'), staleTime: Infinity });

  if (!settings) return null;
  const set = (p: Partial<Settings>) => save.mutate(p);
  const zooOnly = settings.showAchievements && settings.rewards === 'zoo';

  const sections: PageSection[] = [
    {
      id: 'general',
      title: t.settingsGeneral,
      body: (
        <div className="space-y-4 text-ink">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t.yourName}</span>
            <SavedInput value={settings.displayName} onSave={(v) => set({ displayName: v })} placeholder={t.namePlaceholder} />
          </label>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t.language}</legend>
            <Segmented<UiLanguage> value={settings.uiLanguage} options={(['auto', 'de', 'en'] as const).map((l) => [l, t.languages[l]])} onChange={(l) => set({ uiLanguage: l })} />
            <p className="mt-1 text-[13px] text-ink-3">{t.languageNote}</p>
          </fieldset>
        </div>
      ),
    },
    {
      id: 'look',
      title: t.settingsLook,
      body: (
        <div className="space-y-4 text-ink">
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t.theme}</legend>
            <Segmented
              value={settings.theme}
              options={(['system', 'light', 'dusk', 'dark'] as const).map((th) => [th, t.themes[th]])}
              onChange={(th) => {
                applyTheme(th, settings.duskColor, settings.warmPaper);
                set({ theme: th });
              }}
            />
          </fieldset>
          {settings.theme === 'dusk' ? (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t.duskColor}</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {DUSK_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={settings.duskColor === c}
                    onClick={() => {
                      applyTheme('dusk', c, settings.warmPaper);
                      set({ duskColor: c });
                    }}
                    data-dusk={c}
                    className={clsx(
                      'wb-dusk-swatch inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm',
                      settings.duskColor === c ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-sheet text-ink-2 hover:text-ink',
                    )}
                  >
                    <span aria-hidden className="size-3.5 rounded-full" style={{ background: 'var(--dusk-swatch)' }} />
                    {t.duskColors[c]}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
          <Toggle checked={settings.warmPaper} onChange={(v) => set({ warmPaper: v })} title={t.warmPaper} body={t.warmPaperBody} />
          <Toggle checked={settings.safeColors} onChange={(v) => set({ safeColors: v })} title={t.safeColors} body={t.safeColorsBody} />
          <Toggle checked={settings.showLessonOutline} onChange={(v) => set({ showLessonOutline: v })} title={t.showLessonOutline} body={t.showLessonOutlineBody} />
        </div>
      ),
    },
    {
      id: 'timer',
      title: t.timerTitle,
      body: (
        <div className="space-y-3 text-ink">
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
        </div>
      ),
    },
    {
      id: 'editor',
      title: t.editorTitle,
      body: (
        <div className="space-y-3 text-ink">
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t.editorFontSize}</legend>
            <Segmented<string> value={String(settings.editorFontSize)} options={FONT_SIZES.map(([size, name]) => [String(size), t.editorSizes[name]])} onChange={(v) => set({ editorFontSize: Number(v) })} />
          </fieldset>
          <Toggle checked={settings.editorKeys === 'vim'} onChange={(v) => set({ editorKeys: v ? 'vim' : 'default' })} title={t.editorVim} body={t.editorVimBody} />
        </div>
      ),
    },
    {
      id: 'optional',
      title: t.optionalFeatures,
      body: (
        <div className="space-y-3 text-ink">
          <Toggle checked={settings.showAchievements} onChange={(v) => set({ showAchievements: v })} title={t.showAchievements} body={t.showAchievementsBody} />
          {settings.showAchievements ? (
            <div className="ml-7 space-y-2.5">
              <fieldset>
                <legend className="mb-1 text-sm font-medium">{t.rewardsWhat}</legend>
                <Segmented<'all' | 'zoo'> value={settings.rewards} options={[['all', t.rewardsAll], ['zoo', t.rewardsZoo]]} onChange={(v) => set({ rewards: v })} />
              </fieldset>
              {/* With only the animals there is no trophy to show: the paw it is. */}
              {zooOnly ? null : (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">{t.rewardIconTitle}</legend>
                  <Segmented<'trophy' | 'paw'> value={settings.rewardIcon} options={[['trophy', t.rewardIconTrophy], ['paw', t.rewardIconPaw]]} onChange={(v) => set({ rewardIcon: v })} />
                </fieldset>
              )}
            </div>
          ) : null}
          <Toggle checked={settings.showFlashcards} onChange={(v) => set({ showFlashcards: v })} title={t.showFlashcards} body={t.showFlashcardsBody} />
          <Toggle checked={settings.showAnnotations} onChange={(v) => set({ showAnnotations: v })} title={t.showAnnotations} body={t.showAnnotationsBody} />
          {settings.showAnnotations ? <LabelsEditor labels={settings.highlightLabels} onChange={(l) => set({ highlightLabels: l })} /> : null}
          <Toggle checked={settings.showAi} onChange={(v) => set({ showAi: v })} title={t.showAi} body={t.showAiBody} />
        </div>
      ),
    },
    { id: 'start-over', title: t.resetAllTitle, body: <StartOver /> },
  ];

  return (
    <SectionedPage base="/settings" title={t.settings} section={section} sections={sections}>
      {info.data?.typst === 'unavailable' ? <p className="mt-4 text-xs text-ink-3">{t.typstMissing}</p> : null}
    </SectionedPage>
  );
}
