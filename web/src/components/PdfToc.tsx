import type { TocEntry } from '@wb/shared';
import { MAX_TOC_LEVEL } from '@wb/shared';
import { Eye, EyeOff, IndentDecrease, IndentIncrease, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { FoldSection } from './FoldSection';
import { IconButton, clsx } from './ui';

export interface TocActions {
  /** Makes an entry of the student's own on the page in view; returns its key, so its title can be typed at once. */
  add: () => string;
  rename: (e: TocEntry, title: string) => void;
  hide: (e: TocEntry, hidden: boolean) => void;
  level: (e: TocEntry, level: number) => void;
  /** Takes an own entry away, or an embedded one back to what the file says. */
  remove: (e: TocEntry) => void;
}

/**
 * The contents of the PDF: the file's outline with the student's changes. A click goes to the entry's page; the entry
 * the page in view belongs to is marked. "Edit" shows the controls for renaming, hiding and indenting.
 */
export function PdfToc({ entries, current, currentKey, labelOf, onGo, actions, hasOutline }: { entries: TocEntry[]; current: number; currentKey: string | null; labelOf: (n: number) => string; onGo: (page: number) => void; actions: TocActions; hasOutline: boolean }) {
  const t = useT();
  const [edit, setEdit] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const shown = edit ? entries : entries.filter((e) => !e.hidden);
  // The current chapter stays in view in the column's own scroll.
  useEffect(() => {
    if (!currentKey) return;
    const el = list.current?.querySelector<HTMLElement>('[data-current="true"]');
    const box = el?.closest('aside');
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTo({ top: box.scrollTop + r.top - b.top - 80 });
  }, [currentKey]);
  const add = () => {
    setEdit(true);
    setFocusKey(actions.add());
  };
  return (
    <FoldSection
      id="pdf-toc"
      title={t.pdfToc}
      defaultOpen
      className="mt-4"
      actions={
        <>
          <IconButton label={t.pdfTocAdd(labelOf(current))} onClick={add} className="size-7">
            <Plus size={15} />
          </IconButton>
          <IconButton label={t.pdfTocEdit} aria-pressed={edit} onClick={() => setEdit((v) => !v)} className={clsx('size-7', edit && 'bg-sunk text-ink')}>
            <Pencil size={14} />
          </IconButton>
        </>
      }
    >
      {shown.length === 0 ? (
        <div className="text-[13px] text-ink-3">
          <p>{hasOutline ? t.pdfTocAllHidden : t.pdfTocNone}</p>
          <button type="button" onClick={add} className="mt-1.5 rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-sunk">
            {t.pdfTocAdd(labelOf(current))}
          </button>
        </div>
      ) : null}
      <ul ref={list} className="space-y-0.5">
        {shown.map((e) => (
          <li key={e.key} data-current={e.key === currentKey} className={clsx('group/t', e.hidden && 'opacity-50')} style={{ paddingLeft: `${e.level * 0.9}rem` }}>
            {edit ? (
              <TocRow e={e} labelOf={labelOf} actions={actions} focus={focusKey === e.key} onFocused={() => setFocusKey(null)} />
            ) : (
              <button type="button" onClick={() => onGo(e.pageIndex + 1)} aria-current={e.key === currentKey ? 'location' : undefined} className={clsx('flex w-full min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-sunk', e.key === currentKey && 'bg-accent-soft font-medium')}>
                <span className="min-w-0 flex-1 break-words">{e.title}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{labelOf(e.pageIndex + 1)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </FoldSection>
  );
}

function TocRow({ e, labelOf, actions, focus, onFocused }: { e: TocEntry; labelOf: (n: number) => string; actions: TocActions; focus: boolean; onFocused: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(e.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setTitle(e.title), [e.title]);
  useEffect(() => {
    if (!focus) return;
    input.current?.focus();
    input.current?.select();
    onFocused();
  }, [focus, onFocused]);
  const commit = () => {
    const v = title.trim();
    if (v === e.title) return;
    if (!v) return setTitle(e.title);
    actions.rename(e, v);
  };
  const edited = !e.own && !!e.editId;
  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={input}
        aria-label={t.pdfTocTitle}
        value={title}
        onChange={(ev) => setTitle(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') ev.currentTarget.blur();
          if (ev.key === 'Escape') {
            setTitle(e.title);
            ev.currentTarget.blur();
          }
        }}
        className="wb-field h-7 min-w-0 flex-1 px-1.5 text-[13px]"
      />
      <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-ink-3">{labelOf(e.pageIndex + 1)}</span>
      <IconButton label={t.pdfTocOutdent} disabled={e.level <= 0} onClick={() => actions.level(e, e.level - 1)} className="size-6">
        <IndentDecrease size={13} />
      </IconButton>
      <IconButton label={t.pdfTocIndent} disabled={e.level >= MAX_TOC_LEVEL} onClick={() => actions.level(e, e.level + 1)} className="size-6">
        <IndentIncrease size={13} />
      </IconButton>
      <IconButton label={e.hidden ? t.pdfTocShow : t.pdfTocHide} onClick={() => actions.hide(e, !e.hidden)} className="size-6">
        {e.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
      </IconButton>
      {e.own ? (
        <IconButton label={t.pdfTocDelete} onClick={() => actions.remove(e)} className="size-6">
          <X size={13} />
        </IconButton>
      ) : edited && e.editId ? (
        <IconButton label={t.pdfTocReset} onClick={() => actions.remove(e)} className="size-6">
          <RotateCcw size={13} />
        </IconButton>
      ) : (
        <span className="size-6 shrink-0" />
      )}
    </div>
  );
}
