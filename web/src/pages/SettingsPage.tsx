import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ANNOTATION_COLORS, DUSK_COLORS, isCustomColor, normalizeColor, type AnnotationColor, type Settings, type SnapshotInfo, type UiLanguage } from '@wb/shared';
import { Plus, X } from 'lucide-react';
import { api, keys, useSaveSettings, useSettings } from '@/lib/api';
import { useTagActions, useTags } from '@/lib/tags';
import { useAllPdfPages } from '@/lib/pdfPages';
import { swatchProps } from '@/lib/annotations';
import { useLang, useT } from '@/lib/i18n';
import { applyTheme } from '@/lib/theme';
import { Button, NumberField, Segmented, clsx } from '@/components/ui';
import { SectionedPage, type PageSection } from '@/components/SectionedPage';
import { FONT_SIZES } from '@/components/QuickMenus';

const inputClass = 'h-9 w-full wb-field px-3 text-sm placeholder:text-ink-3';


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
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 wb-check shrink-0" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        {body ? <span className="block text-[13px] text-ink-2">{body}</span> : null}
      </span>
    </label>
  );
}

/** The bridge to an assistant (MCP): a copy-ready command with the token, and what the assistant has noted. */
function AssistantBridge({ settings, set }: { settings: Settings; set: (p: Partial<Settings>) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const digests = useQuery({ queryKey: ['bridge-digests'], queryFn: () => api.get<{ id: string; title: string; content: string }[]>('/api/bridge/digests'), staleTime: 0, enabled: settings.assistantBridge });
  const newToken = async () => qc.setQueryData(keys.settings, await api.post<Settings>('/api/bridge/token', {}));
  useEffect(() => {
    if (settings.assistantBridge && !settings.bridgeToken) void newToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.assistantBridge, settings.bridgeToken]);
  const command = `claude mcp add --transport http workbook ${window.location.origin}/mcp --header "Authorization: Bearer ${settings.bridgeToken}"`;
  return (
    <div className="space-y-3">
      <Toggle checked={settings.assistantBridge} onChange={(v) => set({ assistantBridge: v })} title={t.bridgeTitle} body={t.bridgeBody} />
      {settings.assistantBridge ? (
        <div className="ml-7 space-y-3">
          <Toggle checked={settings.bridgeIncludeSolutions} onChange={(v) => set({ bridgeIncludeSolutions: v })} title={t.bridgeSolutions} body={t.bridgeSolutionsBody} />
          <Toggle checked={settings.bridgeIncludeProgress} onChange={(v) => set({ bridgeIncludeProgress: v })} title={t.bridgeProgress} body={t.bridgeProgressBody} />
          <div>
            <p className="mb-1 text-[13px] text-ink-2">{t.bridgeCommand}</p>
            <pre className="overflow-x-auto wb-field px-3 py-2 text-xs">{settings.bridgeToken ? command : ''}</pre>
            <div className="mt-2 flex items-center gap-3">
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(command).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? t.bridgeCopied : t.bridgeCopy}
              </Button>
              <Button onClick={() => void newToken()}>{t.bridgeNewToken}</Button>
              <span className="text-xs text-ink-3">{t.bridgeNewTokenBody}</span>
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">{t.bridgeDigestsTitle}</p>
            {digests.data?.length ? (
              <ul className="space-y-1">
                {digests.data.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 text-[13px]">
                    <details className="min-w-0">
                      <summary className="cursor-pointer">{d.title}</summary>
                      <pre className="mt-1 whitespace-pre-wrap text-xs text-ink-2">{d.content}</pre>
                    </details>
                    <button className="shrink-0 text-xs text-ink-3 hover:text-ink" onClick={() => void api.delete(`/api/bridge/digests/${encodeURIComponent(d.id)}`).then(() => digests.refetch())}>
                      {t.bridgeDeleteDigest}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">{t.bridgeNoDigests}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
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

/** The student's tags: renamed, colored, merged or deleted here; they are made by typing them where something is tagged. */
function TagsEditor() {
  const t = useT();
  const safe = !!useSettings().data?.safeColors;
  const colorNames = safe ? t.annColorSafe : t.annColor;
  const tags = useTags().data ?? [];
  const act = useTagActions();
  const [asking, setAsking] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const rename = (id: string, name: string) => {
    const n = name.trim();
    const cur = tags.find((x) => x.id === id);
    if (!n || !cur || n === cur.name) return;
    setTaken(null);
    act.rename.mutate({ id, name: n }, { onError: () => setTaken(id) });
  };
  return (
    <div className="ml-7 max-w-xl space-y-2">
      <p className="text-sm font-medium">{t.tagsTitle}</p>
      <p className="text-[13px] text-ink-2">{t.tagsBody}</p>
      {tags.length ? null : <p className="text-[13px] text-ink-3">{t.tagsNone}</p>}
      <ul className="space-y-1.5">
        {tags.map((tag) => (
          <Fragment key={`${tag.id}:${tag.name}`}>
            <li className="flex flex-wrap items-center gap-2">
              <input defaultValue={tag.name} maxLength={60} aria-label={t.tagName} onBlur={(e) => rename(tag.id, e.target.value)} className="h-8.5 min-w-0 flex-1 wb-field px-2" />
              <span role="group" aria-label={t.tagColor} className="flex items-center">
                <button type="button" onClick={() => act.recolor.mutate({ id: tag.id, color: '' })} aria-pressed={!tag.color} aria-label={t.tagNoColor} title={t.tagNoColor} className="grid size-7 place-items-center rounded-md hover:bg-sunk">
                  <span className={clsx('size-4.5 rounded-full border border-dashed border-ink-3', !tag.color && 'ring-2 ring-accent ring-offset-1 ring-offset-sheet')} />
                </button>
                {ANNOTATION_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => act.recolor.mutate({ id: tag.id, color: c })} aria-pressed={tag.color === c} aria-label={colorNames[c]} title={colorNames[c]} className="grid size-7 place-items-center rounded-md hover:bg-sunk">
                    <span data-color={c} className={clsx('wb-ann-swatch size-4.5 rounded-full border border-ink/15', tag.color === c && 'ring-2 ring-accent ring-offset-1 ring-offset-sheet')} />
                  </button>
                ))}
                <CustomColor value={tag.color} label={t.annColorOwn} onPick={(hex) => act.recolor.mutate({ id: tag.id, color: normalizeColor(hex) })} />
              </span>
              {tags.length > 1 ? (
                <select
                  value=""
                  aria-label={t.tagMerged(tag.name)}
                  title={t.tagMerged(tag.name)}
                  onChange={(e) => e.target.value && act.merge.mutate({ id: tag.id, into: e.target.value })}
                  className="h-7 max-w-[9rem] rounded-md border border-line bg-sheet px-1 text-[12.5px] text-ink-2"
                >
                  <option value="">{t.tagMergeInto}</option>
                  {tags.filter((x) => x.id !== tag.id).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <button type="button" onClick={() => setAsking(tag.id)} aria-label={t.tagDelete(tag.name)} title={t.tagDelete(tag.name)} className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-sunk hover:text-danger">
                <X size={15} />
              </button>
            </li>
            {taken === tag.id ? (
              <li role="status" className="text-[13px] text-review">
                {t.tagNameTaken}
              </li>
            ) : null}
            {asking === tag.id ? (
              <li role="alertdialog" aria-label={t.tagDelete(tag.name)} className="flex flex-wrap items-center gap-2 rounded-md bg-sunk px-2 py-1.5 text-[13px]">
                <span className="mr-auto">{t.tagDeleteAsk(tag.name)}</span>
                <button type="button" autoFocus onClick={() => { setAsking(null); act.remove.mutate(tag.id); }} className="rounded-md px-2 py-0.5 font-medium text-danger hover:bg-paper">
                  {t.tagDeleteYes}
                </button>
                <button type="button" onClick={() => setAsking(null)} className="rounded-md px-2 py-0.5 text-ink-2 hover:bg-paper">
                  {t.cancel}
                </button>
              </li>
            ) : null}
          </Fragment>
        ))}
      </ul>
    </div>
  );
}

const megabytes = (bytes: number, lang: string) => `${(bytes / 1_000_000).toLocaleString(lang, { maximumFractionDigits: bytes < 10_000_000 ? 1 : 0 })} MB`;

/** The automatic snapshots, newest first; restoring one asks in place and then starts the app again from it. */
function Backups() {
  const t = useT();
  const lang = useLang();
  const list = useQuery({ queryKey: ['snapshots'], queryFn: () => api.get<{ snapshots: SnapshotInfo[] }>('/api/snapshots'), staleTime: 0 });
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const when = (s: SnapshotInfo) => new Date(s.takenAt).toLocaleString(lang, { dateStyle: 'full', ...(s.reason === 'before-restore' ? { timeStyle: 'short' } : {}) });
  const snapshots = list.data?.snapshots;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">{t.backupsBody}</p>
      {snapshots && !snapshots.length ? <p className="text-sm text-ink-3">{t.backupsNone}</p> : null}
      {snapshots?.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {snapshots.map((s) => (
            <li key={s.id} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{when(s)}</p>
                  <p className="text-xs text-ink-3">
                    {megabytes(s.bytes, lang)}
                    {s.reason === 'before-restore' ? ` · ${t.backupBeforeRestore}` : ''}
                  </p>
                </div>
                {asking !== s.id ? (
                  <Button size="sm" disabled={busy} onClick={() => (setAsking(s.id), setFailed(false))}>
                    {t.backupRestore}
                  </Button>
                ) : null}
              </div>
              {asking === s.id ? (
                <div className="mt-2 rounded-md border border-line-strong bg-sunk px-3 py-2.5 text-sm">
                  <p>{t.backupRestoreConfirm(when(s))}</p>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(null)}>
                      {t.cancel}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setFailed(false);
                        try {
                          await api.post(`/api/snapshots/${encodeURIComponent(s.id)}/restore`, { confirm: 'restore' });
                          // Everything the app holds is out of date; a fresh start is simplest.
                          location.hash = '#/';
                          location.reload();
                        } catch {
                          setFailed(true);
                          setBusy(false);
                        }
                      }}
                    >
                      {busy ? t.backupRestoring : t.backupRestore}
                    </Button>
                  </div>
                  {failed ? <p className="mt-2 text-danger">{t.couldNotSave}</p> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
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
            <NumberField value={settings.helpAfterMinutes} max={1440} onCommit={(n) => set({ helpAfterMinutes: n })} className="mx-1 w-20 align-middle" />{' '}
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
          <Toggle checked={settings.showMaterials} onChange={(v) => set({ showMaterials: v })} title={t.showMaterials} body={t.showMaterialsBody} />
          {settings.showMaterials ? <Toggle checked={settings.lookupReferences} onChange={(v) => set({ lookupReferences: v })} title={t.lookupReferences} body={t.lookupReferencesBody} /> : null}
          <Toggle checked={settings.showAi} onChange={(v) => set({ showAi: v })} title={t.showAi} body={t.showAiBody} />
          {settings.showAi ? <AssistantBridge settings={settings} set={set} /> : null}
          <div className="pt-2">
            <TagsEditor />
          </div>
        </div>
      ),
    },
    { id: 'backups', title: t.backupsTitle, body: <Backups /> },
    { id: 'start-over', title: t.resetAllTitle, body: <StartOver /> },
  ];

  return (
    <SectionedPage base="/settings" title={t.settings} section={section} sections={sections}>
      {info.data?.typst === 'unavailable' ? <p className="mt-4 text-xs text-ink-3">{t.typstMissing}</p> : null}
    </SectionedPage>
  );
}
