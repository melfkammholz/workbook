import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Tag as TagIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useT } from '@/lib/i18n';
import { ensureTag, useTagMap } from '@/lib/tags';
import { TagDot, useTagOptions, type TagOption } from './TagPicker';
import { clsx } from './ui';

/**
 * The tags of a row inside its line of details: their names with their colors, muted. Pressing them (or the quiet
 * "Tag" that shows while the row is pointed at, for a row without tags) opens a list of all tags to tick; typing finds
 * a tag or makes one. The row must be a `group/row`.
 */
export function RowTags({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const map = useTagMap();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [at, setAt] = useState(0);
  const listId = useId();
  const options = useTagOptions(value, text, true);
  const chosen = value.map((id) => map.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  // The ticked ones first, so what the row has is at the top.
  const shown = [...options.filter((o) => value.includes(o.key)), ...options.filter((o) => !value.includes(o.key))];

  const toggle = async (o: TagOption | undefined) => {
    if (!o) return;
    const id = o.course || o.create ? (await ensureTag(qc, o.name)).id : o.key;
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    if (o.create) {
      setText('');
      setAt(0);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setText('');
          setAt(0);
        }
      }}
    >
      <Popover.Trigger asChild>
        {chosen.length ? (
          <button type="button" aria-label={t.tagsEdit} data-tip={t.tagsEdit} className="inline-flex max-w-full flex-wrap items-center gap-x-2.5 rounded px-1 text-ink-3 hover:bg-sunk hover:text-ink-2 data-[state=open]:bg-sunk">
            {chosen.map((tag) => (
              <span key={tag.id} className="inline-flex items-center gap-1">
                <TagDot color={tag.color} />
                {tag.name}
              </span>
            ))}
          </button>
        ) : (
          <button
            type="button"
            aria-label={t.tagsAdd}
            className={clsx('inline-flex items-center gap-1 rounded px-1 text-ink-3 hover:bg-sunk hover:text-ink-2 focus-visible:opacity-100', open ? 'bg-sunk opacity-100' : 'opacity-0 group-hover/row:opacity-100')}
          >
            <TagIcon size={12} />
            {t.tagsAdd}
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} aria-label={t.tagFilter} className="wb-menu w-64 p-1.5">
          <input
            autoFocus
            value={text}
            maxLength={60}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder={t.tagsFind}
            onChange={(e) => {
              setText(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setAt((a) => Math.min(a + 1, shown.length - 1));
              else if (e.key === 'ArrowUp') setAt((a) => Math.max(a - 1, 0));
              else if (e.key === 'Enter') void toggle(shown[Math.min(at, shown.length - 1)]);
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
            className="wb-field mb-1 h-8 w-full px-2 text-[13px]"
          />
          {shown.length ? (
            <ul id={listId} role="listbox" aria-multiselectable className="max-h-56 overflow-auto">
              {shown.map((o, i) => {
                const on = value.includes(o.key);
                return (
                  <li key={o.key} role="option" aria-selected={on}>
                    <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => void toggle(o)} onMouseEnter={() => setAt(i)} className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]', i === at && 'bg-sunk')}>
                      <span aria-hidden className={clsx('grid size-4 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-accent-ink' : o.create ? 'border-transparent text-ink-3' : 'border-line-strong')}>
                        {on ? <Check size={11} strokeWidth={3} /> : o.create ? <Plus size={13} /> : null}
                      </span>
                      {o.color ? <TagDot color={o.color} /> : null}
                      <span className="min-w-0 flex-1 truncate">{o.create ? t.tagCreate(o.name) : o.name}</span>
                      {o.course ? <span className="text-[11.5px] text-ink-3">{t.tagFromCourse}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 py-1.5 text-[12.5px] text-ink-3">{t.tagsPopoverNone}</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
