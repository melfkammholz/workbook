import { X } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'wouter';
import { useT } from '@/lib/i18n';
import { dismissLineNote, useLineNote } from '@/lib/lineToast';

/** Confirms what a `!command` on the ticket line did. */
export function LineNotice() {
  const t = useT();
  const note = useLineNote();
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(dismissLineNote, 6000);
    return () => clearTimeout(timer);
  }, [note]);
  if (!note) return null;
  return (
    <div role="status" className="settle fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-sheet px-3.5 py-2 text-sm shadow-[var(--shadow)]">
      {note.kind === 'todo' ? (
        <>
          <span>{t.lineTodoAdded}</span>
          <Link href="/todos" onClick={dismissLineNote} className="font-medium text-accent hover:underline">{t.lineOpenTodos}</Link>
        </>
      ) : (
        <span>{t.lineUnknown(note.cmd)}</span>
      )}
      <button type="button" aria-label={t.close} onClick={dismissLineNote} className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink">
        <X size={14} />
      </button>
    </div>
  );
}
