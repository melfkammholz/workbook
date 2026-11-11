import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { CourseErrorCode, CourseInfo } from '@wb/shared';
import { checkCourseUpdates, keys, useCourseAction, useCourses } from '@/lib/api';
import { useT, type Strings } from '@/lib/i18n';
import { ConfirmDialog } from './Dialogs';
import { Button, Dialog, IconButton, Spinner } from './ui';

export function courseErrorText(t: Strings, e: Error): string {
  return t.courseErrors[e.message as CourseErrorCode] ?? e.message;
}

/** The address of a repository, as part of a form. Also used by the first-run dialog. */
export function CourseUrlField({ value, onChange, busy, error, autoFocus }: { value: string; onChange: (v: string) => void; busy: boolean; error: string | null; autoFocus?: boolean }) {
  const t = useT();
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t.courseUrl}</span>
        <input
          type="url"
          autoFocus={autoFocus}
          value={value}
          disabled={busy}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://github.com/…/….git"
          className="h-9 w-full wb-field px-3 text-sm placeholder:text-ink-3 disabled:opacity-60"
        />
      </label>
      <p className="mt-1 text-[13px] text-ink-3">{t.courseUrlHint}</p>
      {busy ? (
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-ink-2" role="status">
          <Spinner /> {t.courseDownloading}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AddCourseForm({ onAdded, autoFocus }: { onAdded?: () => void; autoFocus?: boolean }) {
  const t = useT();
  const action = useCourseAction();
  const [url, setUrl] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim() || action.isPending) return;
        action.mutate({ type: 'add', url }, { onSuccess: () => (setUrl(''), onAdded?.()) });
      }}
    >
      <CourseUrlField value={url} onChange={setUrl} busy={action.isPending} error={action.error ? courseErrorText(t, action.error) : null} {...(autoFocus ? { autoFocus } : {})} />
      <Button type="submit" variant="primary" className="mt-3" disabled={!url.trim() || action.isPending}>
        {t.courseAdd}
      </Button>
    </form>
  );
}

/** Which courses there are, which one is open, and which ones have something new. */
export function CourseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const data = useCourses().data;
  const action = useCourseAction();
  const [removing, setRemoving] = useState<CourseInfo | null>(null);
  const [resetting, setResetting] = useState<CourseInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  const check = async () => {
    setChecking(true);
    setChecked(false);
    try {
      qc.setQueryData(keys.courses, await checkCourseUpdates());
      setChecked(true);
    } finally {
      setChecking(false);
    }
  };
  const hasRepos = data?.courses.some((c) => c.source === 'git');
  const busyId = action.isPending && action.variables.type !== 'add' ? action.variables.id : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.courses} width="max-w-xl">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {data?.courses.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-48">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {c.title}
                {c.id === data.activeId ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{t.courseOpenNow}</span> : null}
              </p>
              <p className="truncate text-xs text-ink-3">{c.url ?? t.courseMounted}</p>
              {c.update === 'available' ? <p className="mt-0.5 text-xs font-medium text-review">{t.updateAvailable}</p> : null}
            </div>
            <div className="flex items-center gap-1.5">
              {c.update === 'available' ? (
                <Button size="sm" variant="primary" disabled={busyId !== null} onClick={() => action.mutate({ type: 'update', id: c.id })}>
                  {busyId === c.id ? t.courseUpdating : t.courseUpdate}
                </Button>
              ) : null}
              {c.id !== data.activeId ? (
                <Button size="sm" disabled={busyId !== null} onClick={() => action.mutate({ type: 'activate', id: c.id }, { onSuccess: onClose })}>
                  {t.courseOpen}
                </Button>
              ) : null}
              <IconButton label={t.courseResetNamed(c.title)} disabled={busyId !== null} onClick={() => setResetting(c)}>
                <RotateCcw size={15} />
              </IconButton>
              {c.source === 'git' ? (
                <IconButton label={t.courseRemoveNamed(c.title)} disabled={busyId !== null} onClick={() => setRemoving(c)}>
                  <Trash2 size={15} />
                </IconButton>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {action.error ? (
        <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {courseErrorText(t, action.error)}
        </p>
      ) : null}
      {hasRepos ? (
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" disabled={checking} onClick={() => void check()}>
            {checking ? t.courseChecking : t.courseCheck}
          </Button>
          {checked ? (
            <span className="text-[13px] text-ink-2" role="status">
              {data?.courses.some((c) => c.update === 'available') ? t.courseCheckFound : data?.courses.some((c) => c.source === 'git' && c.update === 'unknown') ? t.courseCheckFailed : t.courseCheckNone}
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="mb-2 text-sm font-semibold">{t.courseAddTitle}</h3>
        <AddCourseForm onAdded={onClose} />
      </section>

      <ConfirmDialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title={resetting ? t.courseResetNamed(resetting.title) : ''}
        confirmLabel={t.courseReset}
        onConfirm={() => {
          if (resetting) action.mutate({ type: 'reset', id: resetting.id }, { onSuccess: (d) => d.activeId === resetting.id && onClose() });
        }}
      >
        {t.courseResetBody}
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? t.courseRemoveNamed(removing.title) : ''}
        confirmLabel={t.courseRemove}
        onConfirm={() => {
          if (removing) action.mutate({ type: 'remove', id: removing.id });
        }}
      >
        {t.courseRemoveBody}
      </ConfirmDialog>
    </Dialog>
  );
}
