import { useEffect, useRef, useState } from 'react';
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

  // A quote copied from a highlight goes into this text, so that what is typed here does not overwrite it.
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    const onAppend = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; text: string; taken: boolean }>).detail;
      if (d.id !== id) return;
      d.taken = true;
      const before = textRef.current.trimEnd();
      const next = before ? `${before}\n\n${d.text}` : d.text;
      setText(next);
      persist.call(next);
      persist.flush();
    };
    addEventListener('wb-note-append', onAppend);
    return () => removeEventListener('wb-note-append', onAppend);
  }, [id, persist]);

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
