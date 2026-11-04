import { useState } from 'react';
import { saveNote } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useDebouncedCallback } from '@/lib/useDebounced';
import { TypstEditor } from './TypstEditor';

/** Notes are saved as you type. */
export function NotesPanel({ id, initial }: { id: string; initial: string }) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const persist = useDebouncedCallback((value: string) => {
    setSaved('saving');
    saveNote(id, 'typst', value).then(
      () => setSaved('saved'),
      () => setSaved('error'),
    );
  }, 600);

  return (
    <TypstEditor
      variant="notes"
      value={text}
      onChange={(v) => {
        setText(v);
        persist.call(v);
      }}
      label={t.notes}
      placeholder={t.notesPlaceholder}
      status={saved === 'saving' ? t.saving : saved === 'saved' ? t.saved : saved === 'error' ? t.couldNotSave : ''}
    />
  );
}
