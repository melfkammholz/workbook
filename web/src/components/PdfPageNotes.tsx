import type { PdfPageItem, PdfPageMark } from '@wb/shared';
import { Check, Layers, Plus, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSaveSettings, useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { pageHasContent, type PagePatch } from '@/lib/pdfPages';
import { useDebouncedCallback } from '@/lib/useDebounced';
import { IconAction } from './AnnotationLayer';
import { CopyTextButton } from './PdfHighlights';
import { TypstEditor } from './TypstEditor';
import { clsx } from './ui';

/**
 * What the student keeps on the page or slide in view: come back to it, their own marks, a note in Typst, a reference
 * to copy and a card. The item is made with the first change, so a page nobody touched costs nothing. Keyed by page by its owner.
 */
export function PdfPageNotes({ heading, item, save, copyRef, onCard }: { heading: string; item: PdfPageItem | undefined; save: (patch: PagePatch) => void; copyRef: () => Promise<string>; onCard?: (() => void) | undefined }) {
  const t = useT();
  const review = item?.review ?? null;
  return (
    <section aria-label={heading} className="mt-4 border-t border-line pt-3">
      <div className="flex items-center gap-1">
        <h3 className="mr-auto text-[13px] font-semibold text-ink-2">{heading}</h3>
        {review === 'open' ? (
          <IconAction pressed onClick={() => save({ review: 'resolved' })} label={`${t.annMarked}: ${t.annClearUp}`}>
            <RotateCcw size={15} />
          </IconAction>
        ) : review === 'resolved' ? (
          <IconAction onClick={() => save({ review: 'open' })} label={`${t.annIsClearedUp}: ${t.annReopen}`}>
            <Check size={15} className="text-done" />
          </IconAction>
        ) : (
          <IconAction onClick={() => save({ review: 'open' })} label={t.annComeBack}>
            <RotateCcw size={15} />
          </IconAction>
        )}
        <CopyTextButton text={copyRef} />
        {onCard ? (
          <IconAction onClick={onCard} label={t.annMakeCard}>
            <Layers size={15} />
          </IconAction>
        ) : null}
      </div>
      {review === 'open' ? <p className="mt-0.5 text-[12px] font-medium text-review">{t.annMarked}</p> : null}
      <PageMarks active={item?.marks ?? []} onChange={(marks) => save({ marks })} />
      <PageNote initial={item?.note ?? ''} onSave={(note) => save({ note })} />
    </section>
  );
}

/** The student's own marks: pressed ones are on this page. A new one is typed right here and goes into the settings. */
function PageMarks({ active, onChange }: { active: string[]; onChange: (marks: string[]) => void }) {
  const t = useT();
  const marks: PdfPageMark[] = useSettings().data?.pdfPageMarks ?? [];
  const saveSettings = useSaveSettings();
  const [adding, setAdding] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const known = new Set(marks.map((m) => m.id));
  const on = active.filter((id) => known.has(id));
  const toggle = (id: string) => onChange(on.includes(id) ? on.filter((x) => x !== id) : [...on, id]);
  const add = (raw: string) => {
    const name = raw.trim();
    setAdding(false);
    if (!name) return;
    const same = marks.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (same) return void (on.includes(same.id) || onChange([...on, same.id]));
    if (marks.length >= 30) return;
    const id = crypto.randomUUID().slice(0, 8);
    saveSettings.mutate({ pdfPageMarks: [...marks, { id, name }] });
    onChange([...on, id]);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t.pdfMarks}>
      {marks.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={on.includes(m.id)}
          onClick={() => toggle(m.id)}
          className={clsx('rounded-full border px-2.5 py-0.5 text-[12.5px]', on.includes(m.id) ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2 hover:bg-sunk')}
        >
          {m.name}
        </button>
      ))}
      {adding ? (
        <input
          ref={input}
          autoFocus
          maxLength={60}
          aria-label={t.pdfMarkName}
          placeholder={t.pdfMarkName}
          onBlur={(e) => add(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add(e.currentTarget.value);
            if (e.key === 'Escape') {
              e.stopPropagation();
              setAdding(false);
            }
          }}
          className="h-7 w-32 wb-field px-2 text-[13px]"
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[12.5px] text-ink-3 hover:bg-sunk hover:text-ink-2">
          <Plus size={12} /> {marks.length ? t.pdfMarkAdd : t.pdfMarkAddFirst}
        </button>
      )}
    </div>
  );
}

/** The note, saved as it is typed. Made anew for every page, so what is typed always goes to the page it was typed on. */
function PageNote({ initial, onSave }: { initial: string; onSave: (note: string) => void }) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  const persist = useDebouncedCallback((v: string) => {
    onSave(v);
    setSaved(true);
  }, 600);
  return (
    <div className="mt-2 h-80 overflow-hidden rounded-md border border-line">
      <TypstEditor
        compact
        variant="notes"
        value={text}
        onChange={(v) => {
          setText(v);
          setSaved(false);
          persist.call(v);
        }}
        label={t.pdfPageNote}
        placeholder={t.pdfPageNotePlaceholder}
        status={saved ? t.saved : ''}
      />
    </div>
  );
}

/** The pages that have something on them, in page order: a way back to them. */
export function PagesWithNotes({ items, marks, current, labelOf, onGo }: { items: PdfPageItem[]; marks: PdfPageMark[]; current: number; labelOf: (n: number) => string; onGo: (page: number) => void }) {
  const t = useT();
  const shown = items.filter(pageHasContent);
  if (!shown.length) return null;
  const name = new Map(marks.map((m) => [m.id, m.name]));
  return (
    <section className="mt-5 border-t border-line pt-3" aria-label={t.pdfPagesWithNotes}>
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink-2">{t.pdfPagesWithNotes}</h3>
      <ul className="space-y-0.5">
        {shown.map((p) => {
          const n = p.pageIndex + 1;
          const first = p.note.trim().split('\n')[0] ?? '';
          const tags = p.marks.map((id) => name.get(id)).filter(Boolean);
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onGo(n)} aria-current={n === current} className="flex w-full min-w-0 flex-col rounded-md px-1.5 py-1 text-left hover:bg-sunk aria-[current=true]:bg-sunk">
                <span className={clsx('text-[12px] font-medium', n === current ? 'text-accent' : 'text-ink-3')}>
                  {t.pdfPageN(n)}
                  {labelOf(n) !== String(n) ? ` (${labelOf(n)})` : ''}
                  {p.review === 'open' ? <span className="ml-2 text-review">{t.annMarked}</span> : null}
                </span>
                {tags.length ? <span className="text-[12.5px] text-ink-2">{tags.join(' · ')}</span> : null}
                {first ? <span className="line-clamp-2 break-words text-[13px] text-ink-2">{first}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
