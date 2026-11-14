import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { swatchProps } from '@/lib/annotations';
import { useT } from '@/lib/i18n';
import { ensureTag, useCourseTagNames, useTagMap, useTags } from '@/lib/tags';

/** A tag's color as a small dot; nothing for a tag without one. */
export function TagDot({ color, className }: { color: string; className?: string }) {
  if (!color) return null;
  return <span aria-hidden {...swatchProps(color as never)} className={clsx('wb-ann-swatch inline-block size-2 shrink-0 rounded-full', className)} />;
}

export interface TagOption {
  key: string;
  name: string;
  color: string;
  /** Set for a course topic that is not yet one of the student's tags; picking it makes the tag. */
  course: boolean;
  create: boolean;
}

/**
 * What a tag field offers for the text typed: the student's tags (the ones already on the thing too when `withChosen`,
 * so they can be taken off), course topics that are not tags yet, and "new tag" for a name nobody has.
 */
export function useTagOptions(value: string[], text: string, withChosen: boolean): TagOption[] {
  const tags = useTags().data ?? [];
  const courseNames = useCourseTagNames();
  const needle = text.trim().toLowerCase();
  return useMemo<TagOption[]>(() => {
    const out: TagOption[] = [];
    const names = new Set<string>();
    for (const tag of tags) {
      names.add(tag.name.toLowerCase());
      if ((withChosen || !value.includes(tag.id)) && (!needle || tag.name.toLowerCase().includes(needle))) out.push({ key: tag.id, name: tag.name, color: tag.color, course: false, create: false });
    }
    for (const n of courseNames) if (!names.has(n.toLowerCase()) && (!needle || n.toLowerCase().includes(needle))) out.push({ key: `course:${n}`, name: n, color: '', course: true, create: false });
    if (needle && !names.has(needle) && !courseNames.some((n) => n.toLowerCase() === needle)) out.push({ key: `new:${needle}`, name: text.trim(), color: '', course: false, create: true });
    return out.slice(0, 40);
  }, [tags, value, courseNames, needle, text, withChosen]);
}

/**
 * The tags on one thing as chips, with a field that finds tags while typing; Enter on a name nobody has makes the tag.
 * Course topics are offered too (marked), read-only: picking one makes a tag of the same name.
 * `value` holds tag ids.
 */
export function TagPicker({ value, onChange, size = 'md', autoFocus = false, placeholder }: { value: string[]; onChange: (v: string[]) => void; size?: 'sm' | 'md'; autoFocus?: boolean; placeholder?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const map = useTagMap();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useTagOptions(value, text, false);

  const pick = async (o: TagOption | undefined) => {
    if (!o) return;
    setText('');
    setAt(0);
    const id = o.course || o.create ? (await ensureTag(qc, o.name)).id : o.key;
    onChange(value.includes(id) ? value : [...value, id]);
    input.current?.focus();
  };
  const remove = (id: string) => onChange(value.filter((x) => x !== id));
  const sm = size === 'sm';

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((id) => {
          const tag = map.get(id);
          if (!tag) return null;
          return (
            <span key={id} className={clsx('inline-flex items-center gap-1 rounded-full border border-line bg-sunk pl-2.5 pr-1', sm ? 'text-[12px]' : 'py-0.5 text-[13px]')}>
              <TagDot color={tag.color} />
              {tag.name}
              <button type="button" onClick={() => remove(id)} aria-label={t.tagRemove(tag.name)} title={t.tagRemove(tag.name)} className="grid size-4 place-items-center rounded-full text-ink-3 hover:text-danger">
                <X size={11} />
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          maxLength={60}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={placeholder ?? t.tagPlaceholder}
          onChange={(e) => {
            setText(e.target.value);
            setAt(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setAt((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAt((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              void pick(options[at]);
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === 'Backspace' && !text && value.length) remove(value[value.length - 1]!);
          }}
          className={clsx('wb-field min-w-[8rem] flex-1 px-2', sm ? 'h-6 text-[12px]' : 'h-7 text-[13px]')}
        />
      </div>
      {open && options.length ? (
        <ul id={listId} role="listbox" className="absolute left-0 z-30 mt-1 max-h-56 min-w-[12rem] max-w-full overflow-auto rounded-md border border-line bg-sheet py-1 text-[13px] shadow-lg">
          {options.map((o, i) => (
            <li key={o.key} role="option" aria-selected={i === at}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => void pick(o)} onMouseEnter={() => setAt(i)} className={clsx('flex w-full items-center gap-2 px-2.5 py-1 text-left', i === at && 'bg-sunk')}>
                {o.create ? <Plus size={12} className="text-ink-3" /> : o.color ? <TagDot color={o.color} /> : <span className="size-2 rounded-full border border-line-strong" />}
                <span className="min-w-0 flex-1 truncate">{o.create ? t.tagCreate(o.name) : o.name}</span>
                {o.course ? <span className="text-[11.5px] text-ink-3">{t.tagFromCourse}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
