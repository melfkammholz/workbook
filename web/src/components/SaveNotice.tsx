import { CircleAlert, X } from 'lucide-react';
import { useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { dismissSaveFailed, useSaveFailed } from '@/lib/saveNotice';

/** A change that was shown at once but could not be saved, and was taken back. */
export function SaveNotice() {
  const t = useT();
  const at = useSaveFailed();
  useEffect(() => {
    if (at === null) return;
    const timer = setTimeout(dismissSaveFailed, 8000);
    return () => clearTimeout(timer);
  }, [at]);
  if (at === null) return null;
  return (
    <div role="alert" className="settle fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-start gap-2.5 rounded-lg border border-danger/40 bg-sheet px-3.5 py-2.5 text-sm shadow-[var(--shadow)]">
      <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <span>
        <span className="font-medium">{t.couldNotSave}.</span> <span className="text-ink-2">{t.changeUndone}</span>
      </span>
      <button type="button" aria-label={t.close} onClick={dismissSaveFailed} className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink">
        <X size={14} />
      </button>
    </div>
  );
}
