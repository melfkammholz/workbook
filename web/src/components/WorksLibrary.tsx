import * as Popover from '@radix-ui/react-popover';
import { toBibtex, type LibraryWork, type WorkState } from '@wb/shared';
import { Check, ChevronDown, ChevronRight, Copy, ListFilter, Link2, Pencil, Unlink, FileText, GitMerge, FileInput } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { isTyping } from '@/lib/keys';
import { linkWork, setWorkState, setWorkTags, useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { useResources } from '@/lib/resources';
import { Button, Empty, Spinner, clsx } from './ui';
import { useTagMap } from '@/lib/tags';
import { useBibImport } from './BibImport';
import { MenuItem, MenuRule, MoreMenu } from './Menu';
import { RowTags } from './RowTags';
import { TagDot } from './TagPicker';
import { SimilarWorks, WorkEntry, WorkLinkPicker, WorkSortStrip, WorkStateMenu, WorkEditButton, sure } from './WorkBits';
import { WorkEditDialog } from './WorkEditDialog';

type StateFilter = 'library' | 'later' | 'read' | 'know' | 'skip';
type FileFilter = 'any' | 'have' | 'missing';

/** Works that were only found in a PDF's list and that the student has not sorted: the Unsorted tray. */
const isUnsorted = (w: LibraryWork) => w.state === null && w.citedOn.length === 0 && w.citedBy.length > 0;
/** What the library shows by default: sorted into later, read or know, cited in a workbook, or added by hand. */
const inLibrary = (w: LibraryWork) => (w.state === null ? !isUnsorted(w) : w.state !== 'skip');

/**
 * The works of all the student's PDFs as one library: sorted into later, read, know and skipped; new finds wait in
 * Unsorted. Each row is one line of details with its state in the first column; the rest is behind its "⋯".
 */
export function WorksLibrary() {
  const t = useT();
  const works = useWorks().data;
  const bib = useBibImport();
  const [newWork, setNewWork] = useState(false);
  const [filter, setFilter] = useState<StateFilter>('library');
  const [fileFilter, setFileFilter] = useState<FileFilter>('any');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const tagMap = useTagMap();

  const all = works ?? [];
  const usedTags = [...tagMap.values()].filter((g) => all.some((w) => w.tags.includes(g.id)));
  const wanted = (w: LibraryWork) => tagFilter.every((g) => w.tags.includes(g)) && (fileFilter === 'any' || (fileFilter === 'have' ? !!w.resource : !w.resource));
  const byFilters = all.filter(wanted);
  const pick = (w: LibraryWork) => (filter === 'library' ? inLibrary(w) : w.state === filter);
  const shown = byFilters.filter(pick);
  const unsorted = filter === 'library' ? byFilters.filter(isUnsorted) : [];
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));
  // Only works that still exist count (a removed or merged one may have been selected).
  const chosen = all.filter((w) => selected.has(w.id));
  const copy = () => {
    void navigator.clipboard.writeText(toBibtex(chosen)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => undefined);
  };
  const stopExport = () => {
    setExporting(false);
    setSelected(new Set());
  };
  const states: [StateFilter, string][] = [['library', t.workFilterLibrary], ['later', t.workFilterLater], ['read', t.workFilterRead], ['know', t.workFilterKnow], ['skip', t.workFilterSkip]];
  const active = (fileFilter === 'any' ? 0 : 1) + tagFilter.length;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => setNewWork(true)}>
          {t.workNew}
        </Button>
        <MoreMenu label={t.moreActions} pinned width="w-72">
          <MenuItem icon={<FileInput size={15} />} onSelect={bib.pickFile}>
            {t.bibImportFile}
          </MenuItem>
          <p className="px-2.5 pb-1 text-[12px] leading-snug text-ink-3">{t.bibImportHint}</p>
          <MenuRule />
          <MenuItem icon={<Copy size={15} />} onSelect={() => setExporting(true)}>
            {t.workExport}
          </MenuItem>
        </MoreMenu>
        <span className="flex-1" />
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className={clsx('inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[13px] hover:bg-sunk data-[state=open]:bg-sunk', active ? 'border-accent bg-accent-soft font-medium' : 'border-line-strong')}>
              <ListFilter size={14} />
              {active ? t.workFilterCount(active) : t.workFilter}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={4} aria-label={t.workFilter} className="wb-menu w-72 p-3">
              <p className="mb-1.5 text-[12px] font-semibold text-ink-3">{t.workFilterFile}</p>
              <div role="radiogroup" aria-label={t.workFilterFile}>
                {(['any', 'have', 'missing'] as const).map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={fileFilter === f} onClick={() => setFileFilter(f)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-sunk">
                    <span aria-hidden className={clsx('grid size-4 shrink-0 place-items-center rounded-full border', fileFilter === f ? 'border-accent' : 'border-line-strong')}>
                      {fileFilter === f ? <span className="size-2 rounded-full bg-accent" /> : null}
                    </span>
                    {f === 'any' ? t.workFilterAny : f === 'have' ? t.workFilterHave : t.workFilterMissing}
                  </button>
                ))}
              </div>
              {usedTags.length ? (
                <>
                  <p className="mb-1 mt-3 text-[12px] font-semibold text-ink-3">{t.tagFilter}</p>
                  <ul>
                    {usedTags.map((g) => {
                      const on = tagFilter.includes(g.id);
                      return (
                        <li key={g.id}>
                          <button type="button" role="checkbox" aria-checked={on} onClick={() => setTagFilter(on ? tagFilter.filter((x) => x !== g.id) : [...tagFilter, g.id])} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-sunk">
                            <span aria-hidden className={clsx('grid size-4 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>
                              {on ? <Check size={11} strokeWidth={3} /> : null}
                            </span>
                            <TagDot color={g.color} />
                            {g.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
              {active ? (
                <button type="button" onClick={() => { setFileFilter('any'); setTagFilter([]); }} className="mt-2 text-[12.5px] text-ink-2 hover:underline">
                  {t.workFilterClear}
                </button>
              ) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group">
        {states.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={clsx('rounded-full border px-2.5 py-0.5 text-[13px]', filter === f ? 'border-accent bg-accent-soft font-medium' : 'border-line text-ink-2 hover:bg-sunk')}>
            {label}
          </button>
        ))}
      </div>
      {bib.node}
      {newWork ? <WorkEditDialog onClose={() => setNewWork(false)} /> : null}
      {!works ? (
        <div className="mt-10 grid place-items-center">
          <Spinner />
        </div>
      ) : works.length === 0 ? (
        <div className="mt-10">
          <Empty title={t.workNone} />
        </div>
      ) : shown.length === 0 && unsorted.length === 0 ? (
        <p className="mt-8 text-ink-2">{t.workNoneFilter}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {shown.map((w) => (
            <WorkRow key={w.id} work={w} exporting={exporting} selected={selected.has(w.id)} onToggle={() => toggle(w.id)} />
          ))}
        </ul>
      )}
      {unsorted.length ? <UnsortedTray works={unsorted} /> : null}
      {exporting ? (
        <div role="group" aria-label={t.workSelectionLabel} className="sticky bottom-4 z-10 mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line-strong bg-sheet py-2 pl-4 pr-2 shadow-[var(--shadow)]">
          <span className="tabular-nums text-[13px] text-ink-2">{chosen.length ? t.workSelected(chosen.length) : t.workExportHint}</span>
          <Button size="sm" variant="primary" disabled={!chosen.length} onClick={copy}>
            <Copy size={13} />
            {copied ? t.workCopied : t.workCopyBibtex}
          </Button>
          <button type="button" onClick={() => setSelected(new Set([...selected, ...shown.map((w) => w.id)]))} className="text-[13px] text-ink-2 hover:underline">
            {t.workSelectShown}
          </button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={stopExport}>
            {t.cancel}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * New finds from the PDFs, collapsed. Open, the keys sort the work under the cursor (L later, R read, K know, S skip),
 * the arrows move, and the next work slides into its place.
 */
function UnsortedTray({ works }: { works: LibraryWork[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const cursor = Math.min(at, works.length - 1);
  const cur = works[cursor];
  useEffect(() => {
    if (!open) return;
    const keys: Record<string, WorkState> = { l: 'later', r: 'read', k: 'know', s: 'skip' };
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('[role=dialog]')) return;
      if (e.key === 'ArrowDown') setAt(Math.min(cursor + 1, works.length - 1));
      else if (e.key === 'ArrowUp') setAt(Math.max(cursor - 1, 0));
      else if (keys[e.key.toLowerCase()] && cur) setWorkState(qc, cur.id, keys[e.key.toLowerCase()]!);
      else return;
      e.preventDefault();
      // The page's own single keys (l forward, k scroll) must not also fire.
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [open, cursor, cur, works.length, qc]);
  useEffect(() => {
    if (open) list.current?.querySelector('[data-cursor=true]')?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor, cur?.id]);
  return (
    <section className="mt-6 border-t border-line-strong" aria-label={t.workUnsorted}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left text-[14px] font-semibold hover:bg-sunk">
        <span className="grid w-7 place-items-center text-ink-2">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
        <span>
          {t.workUnsorted} <span className="font-normal tabular-nums text-ink-2">{works.length}</span>
        </span>
      </button>
      {open ? (
        <>
          <p className="pb-2 pl-[2.9rem] pr-1.5 text-[13px] text-ink-2">{t.workUnsortedHint}</p>
          <ul ref={list} className="divide-y divide-line">
            {works.map((w, i) => {
              const here = i === cursor;
              const ok = sure(w);
              const cited = t.workCitedSummary(w.citedBy.length, 0);
              return (
                <li key={w.id} data-cursor={here} onClick={() => setAt(i)} className={clsx('group/row grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-start gap-x-2.5 px-1.5 py-2.5', here && 'rounded-lg border-transparent bg-accent-soft')}>
                  <div className="grid h-7 place-items-center">
                    {here ? <span aria-hidden className="size-7 rounded-lg border-[1.5px] border-dashed border-accent bg-sheet" /> : <WorkStateMenu work={w} />}
                  </div>
                  <div className="min-w-0">
                    {ok ? (
                      <WorkEntry work={w} fallback={w.raw} extra={[cited]} />
                    ) : (
                      <>
                        <span className="line-clamp-2 block break-words pt-0.5 text-[14px] italic leading-snug text-ink-2">{w.raw}</span>
                        <span className="block text-[13px] text-ink-2">{cited}</span>
                      </>
                    )}
                    {here ? <WorkSortStrip work={w} /> : null}
                  </div>
                  <WorkEditButton work={w} className={clsx('size-7', !here && 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100')} />
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function WorkRow({ work: w, exporting, selected, onToggle }: { work: LibraryWork; exporting: boolean; selected: boolean; onToggle: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const resources = useResources(null).data?.resources;
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<'cited' | 'similar' | 'link' | null>(null);
  const linked = w.resource ? resources?.find((r) => r.id === w.resource) : undefined;
  const pdfs = w.citedBy.length;
  const books = w.citedOn.length;
  const open = (p: 'cited' | 'similar' | 'link') => setPanel(panel === p ? null : p);
  const extra = [
    pdfs || books ? (
      <button key="cited" type="button" aria-expanded={panel === 'cited'} onClick={() => open('cited')} className={clsx('rounded px-1 hover:bg-sunk hover:text-ink', panel === 'cited' && 'bg-sunk text-ink')}>
        {t.workCitedSummary(pdfs, books)}
      </button>
    ) : null,
    w.resource ? (
      <Link key="file" href={`/resources/${encodeURIComponent(w.resource)}`} aria-label={t.workOpenTip(linked?.title ?? '')} data-tip={t.workOpenTip(linked?.title ?? t.workOpen)} className="inline-flex items-center rounded px-0.5 text-ink-3 hover:bg-sunk hover:text-accent">
        <FileText size={13} />
      </Link>
    ) : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <li onClick={exporting ? onToggle : undefined} className={clsx('group/row grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-start gap-x-2.5 px-1.5 py-2.5', exporting && 'cursor-pointer hover:bg-sunk')}>
      <div className="grid h-7 place-items-center">
        {exporting ? <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label={t.workSelectOne(w.title || w.raw)} className="wb-check" /> : <WorkStateMenu work={w} />}
      </div>
      <div className="min-w-0">
        <WorkEntry work={w} fallback={w.raw} extra={extra} tail={<RowTags value={w.tags} onChange={(v) => setWorkTags(qc, w.id, v)} />} />
        {panel === 'cited' ? (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-ink-3">
            {w.citedBy.map((c) => (
              <Link key={c.resource} href={`/resources/${encodeURIComponent(c.resource)}`} className="max-w-[16rem] truncate rounded border border-line px-1.5 text-ink-2 hover:bg-sunk">
                {c.title}
              </Link>
            ))}
            {w.citedOn.map((c) => (
              <Link key={`${c.course}/${c.page}`} href={c.href} className="max-w-[16rem] truncate rounded border border-line px-1.5 text-ink-2 hover:bg-sunk">
                {c.title}
              </Link>
            ))}
          </p>
        ) : null}
        {panel === 'similar' ? <SimilarWorks work={w} similar={w.similar} /> : null}
        {panel === 'link' ? <WorkLinkPicker work={w} onDone={() => setPanel(null)} /> : null}
      </div>
      {exporting ? (
        <span />
      ) : (
        <MoreMenu label={t.moreActions} pinned={w.similar.length > 0} dot={w.similar.length > 0}>
          <MenuItem icon={<Pencil size={15} />} onSelect={() => setEditing(true)}>
            {t.resourceEdit}
          </MenuItem>
          {w.resource ? (
            <>
              <MenuItem icon={<FileText size={15} />} to={`/resources/${encodeURIComponent(w.resource)}`}>
                {t.workMenuOpen}
              </MenuItem>
              <MenuItem icon={<Unlink size={15} />} onSelect={() => void linkWork(qc, w.id, null)}>
                {t.workMenuUnlink}
              </MenuItem>
            </>
          ) : (
            <MenuItem icon={<Link2 size={15} />} onSelect={() => setPanel('link')}>
              {t.workMenuLink}
            </MenuItem>
          )}
          {w.similar.length ? (
            <MenuItem icon={<GitMerge size={15} />} onSelect={() => setPanel('similar')} trailing={w.similar.length}>
              {t.workMenuSimilar}
            </MenuItem>
          ) : null}
        </MoreMenu>
      )}
      {editing ? <WorkEditDialog work={w} onClose={() => setEditing(false)} /> : null}
    </li>
  );
}
