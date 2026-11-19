import { toBibtex, type LibraryWork, type Resource, type WorkState } from '@wb/shared';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronUp, Copy, Download, FileInput, FileText, Link2, Pencil, Plus, Trash2, Unlink, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { isTyping } from '@/lib/keys';
import { linkWork, setWorkState, setWorkTags, useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { buildRows, type LibraryRow } from '@/lib/libraryRows';
import { isPdf } from '@/lib/pdf';
import { usePdfAnnotations } from '@/lib/pdfAnnotations';
import { fileUrl, recordOpen, refreshResources } from '@/lib/resources';
import { Button, Empty, Spinner, clsx } from './ui';
import { ensureTag, setTagsOn, useTagMap } from '@/lib/tags';
import { useBibImport } from './BibImport';
import { MenuItem, MenuRule, MoreMenu } from './Menu';
import { useNewVersion } from './NewVersionButton';
import { RowTags } from './RowTags';
import { TagDot } from './TagPicker';
import { SimilarWorks, WorkEntry, WorkLinkPicker, WorkSortStrip, WorkStateButtons, WorkStateMenu, WorkEditButton, sure } from './WorkBits';
import { AddDialog, detect } from './AddDialog';
import { WorkEditDialog } from './WorkEditDialog';

type View = 'all' | 'relevant' | 'later' | 'read' | 'know' | 'skip' | 'unsorted';
type ColId = 'title' | 'authors' | 'year' | 'tags';

const COLS: { id: ColId; width: number; min: number }[] = [
  { id: 'title', width: 300, min: 160 },
  { id: 'authors', width: 170, min: 90 },
  { id: 'year', width: 56, min: 44 },
  { id: 'tags', width: 150, min: 90 },
];
const STATE_W = 44;
const FILE_W = 44;
const PANE_KEY = 'wb.library.pane';
const PANE_OPEN_KEY = 'wb.library.paneOpen';
const WIDTHS_KEY = 'wb.library.columns';

const readWidths = (): Record<ColId, number> => {
  const base = Object.fromEntries(COLS.map((c) => [c.id, c.width])) as Record<ColId, number>;
  try {
    const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}') as Partial<Record<ColId, number>>;
    for (const c of COLS) if (typeof saved[c.id] === 'number') base[c.id] = Math.max(c.min, saved[c.id]!);
  } catch {
    /* storage blocked or garbled: defaults */
  }
  return base;
};

/** What a view shows. Hidden (skip) rows only show in their own view; unsorted finds wait in theirs. */
const inView = (r: LibraryRow, v: View) => {
  if (v === 'all') return r.state !== 'skip' && !r.unsorted;
  if (v === 'relevant') return r.relevant && r.state !== 'skip';
  if (v === 'unsorted') return r.unsorted;
  return r.state === v;
};

/**
 * The library: works with their material, and materials that are no work's, as one table. A rail on the left filters
 * by view, tag and file; in the "All" view what is relevant now sits on top.
 */
export function WorksLibrary({ resources, onEditResource, onDeleteResource, onFiles }: { resources: Resource[]; onEditResource: (r: Resource) => void; onDeleteResource: (r: Resource) => void; onFiles: (files: File[]) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const works = useWorks().data;
  const bib = useBibImport();
  const tagMap = useTagMap();
  const [adding, setAdding] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const [fileHave, setFileHave] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [descending, setDescending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [widths, setWidths] = useState(readWidths);
  const [active, setActive] = useState<string | null>(null);
  const [paneOpen, setPaneOpen] = useState(() => {
    try {
      return localStorage.getItem(PANE_OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const openRef = useRef<HTMLElement | null>(null);

  // Pasting a DOI or arXiv id outside a text field opens the add dialog on it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[role=dialog]')) return;
      const pasted = e.clipboardData?.getData('text/plain') ?? '';
      const d = detect(pasted);
      if (d?.kind !== 'doi' && d?.kind !== 'arxiv') return;
      e.preventDefault();
      setAdding(pasted.trim());
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const rows = useMemo(() => (works ? buildRows(works, resources) : []), [works, resources]);
  const usedTags = [...tagMap.values()].filter((g) => rows.some((r) => r.tags.includes(g.id)));
  const byFilters = (r: LibraryRow) => tagFilter.every((g) => r.tags.includes(g)) && (fileHave === fileMissing || (fileHave ? r.hasFile : !r.hasFile));
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);
  const sorted = (list: LibraryRow[]) => [...list].sort((a, b) => (descending ? -1 : 1) * collator.compare(a.title, b.title));
  const inThisView = rows.filter((r) => byFilters(r) && inView(r, view));
  const relevant = view === 'all' ? sorted(inThisView.filter((r) => r.relevant)) : [];
  const rest = sorted(view === 'all' ? inThisView.filter((r) => !r.relevant) : inThisView);
  const shownCount = inThisView.length;
  const order = useMemo(() => [...relevant, ...rest], [relevant, rest]);
  const activeRow = view === 'unsorted' ? undefined : order.find((r) => r.key === active);
  const togglePane = () =>
    setPaneOpen((o) => {
      try {
        localStorage.setItem(PANE_OPEN_KEY, o ? '0' : '1');
      } catch {
        /* not remembered */
      }
      return !o;
    });

  // Arrows change the selection, Enter opens the file; the detail pane follows.
  useEffect(() => {
    if (view === 'unsorted' || exporting) return;
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTyping(e.target) || document.querySelector('[role=dialog]')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!order.length) return;
        const at = order.findIndex((r) => r.key === active);
        const next = e.key === 'ArrowDown' ? Math.min(at + 1, order.length - 1) : at < 0 ? 0 : Math.max(at - 1, 0);
        setActive(order[next]!.key);
        document.querySelector(`[data-row-key="${order[next]!.key}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && openRef.current && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
        openRef.current.click();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [order, active, view, exporting]);

  const views: [View, string][] = [['all', t.libViewAll], ['relevant', t.libViewRelevant], ['later', t.libViewLater], ['read', t.libViewRead], ['know', t.libViewKnow], ['unsorted', t.libViewUnsorted], ['skip', t.libViewSkip]];
  // "Relevant now" shows no count: how often something was opened is not for showing.
  const count = (v: View) => rows.filter((r) => inView(r, v)).length;

  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));
  const allWorks = works ?? [];
  const chosen = allWorks.filter((w) => selected.has(w.id));
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

  const setWidth = (id: ColId, w: number | null) =>
    setWidths((cur) => {
      const def = COLS.find((c) => c.id === id)!;
      const next = { ...cur, [id]: w === null ? def.width : Math.max(def.min, Math.round(w)) };
      try {
        localStorage.setItem(WIDTHS_KEY, JSON.stringify(next));
      } catch {
        /* not remembered */
      }
      return next;
    });
  const template = `${STATE_W}px ${COLS.map((c) => `${widths[c.id]}px`).join(' ')} ${FILE_W}px`;
  const tableWidth = STATE_W + COLS.reduce((n, c) => n + widths[c.id], 0) + FILE_W;

  const renderRow = (r: LibraryRow) => (
    <Row key={r.key} row={r} template={template} exporting={exporting} active={r.key === active} onSelect={() => setActive(r.key)} selected={r.work ? selected.has(r.work.id) : false} onToggle={() => r.work && toggle(r.work.id)} />
  );

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => setAdding('')}>
          <Plus size={14} /> {t.workAdd}
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
      </div>
      {bib.node}
      {adding !== null ? <AddDialog initialText={adding} onFiles={onFiles} onClose={() => setAdding(null)} /> : null}
      {!works ? (
        <div className="mt-10 grid place-items-center">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-10">
          <Empty title={t.workNone} />
        </div>
      ) : (
        <div className="mt-4 flex items-start gap-6">
          <Rail
            views={views}
            view={view}
            onView={setView}
            count={count}
            tags={usedTags.map((g) => ({ ...g, n: rows.filter((r) => r.tags.includes(g.id)).length }))}
            tagFilter={tagFilter}
            onTag={(id) => setTagFilter((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
            file={{ have: fileHave, missing: fileMissing, nHave: rows.filter((r) => r.hasFile).length, nMissing: rows.filter((r) => !r.hasFile).length }}
            onHave={setFileHave}
            onMissing={setFileMissing}
            onNewTag={async (name) => {
              const g = await ensureTag(qc, name);
              setTagFilter((cur) => (cur.includes(g.id) ? cur : [...cur, g.id]));
            }}
          />
          <div className="min-w-0 flex-1">
            {view === 'unsorted' ? (
              shownCount ? (
                <UnsortedTray works={inThisView.map((r) => r.work!)} alwaysOpen />
              ) : (
                <p className="text-ink-2">{t.workNoneFilter}</p>
              )
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <div style={{ width: tableWidth, minWidth: '100%' }}>
                  <div role="row" className="grid items-center border-b border-line-strong bg-sunk/50 text-[12.5px] font-semibold text-ink-2" style={{ gridTemplateColumns: template }}>
                    <span />
                    {COLS.map((c) => (
                      <div key={c.id} role="columnheader" className="relative flex h-8 items-center px-2">
                        {c.id === 'title' ? (
                          <button type="button" onClick={() => setDescending(!descending)} className="inline-flex items-center gap-1 hover:text-ink" aria-label={`${t.libColTitle}: ${descending ? '↓' : '↑'}`}>
                            {t.libColTitle}
                            {descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                          </button>
                        ) : (
                          t[c.id === 'authors' ? 'libColAuthors' : c.id === 'year' ? 'libColYear' : 'libColTags']
                        )}
                        <ResizeHandle width={widths[c.id]} min={c.min} label={t.libResizeHint} onResize={(w) => setWidth(c.id, w)} onReset={() => setWidth(c.id, null)} />
                      </div>
                    ))}
                    <span className="px-2 text-center">{t.libColFile}</span>
                  </div>
                  {shownCount === 0 ? (
                    <p className="p-4 text-ink-2">{t.workNoneFilter}</p>
                  ) : (
                    <>
                      {relevant.length ? (
                        <>
                          <div className="border-b border-line bg-sunk/30 px-3 py-1.5 text-[12.5px] font-semibold">
                            {t.libRelevantHead} <span className="ml-1 font-normal text-ink-3">{t.libRelevantSub}</span>
                          </div>
                          {relevant.map(renderRow)}
                          {rest.length ? <div className="border-b border-line bg-sunk/30 px-3 py-1.5 text-[12.5px] font-semibold text-ink-2">{t.libOthers}</div> : null}
                        </>
                      ) : null}
                      {rest.map(renderRow)}
                    </>
                  )}
                </div>
              </div>
            )}
            {activeRow && !exporting ? <DetailPane key={activeRow.key} row={activeRow} open={paneOpen} onToggle={togglePane} openRef={openRef} onEditResource={onEditResource} onDeleteResource={onDeleteResource} /> : null}
          </div>
        </div>
      )}
      {exporting ? (
        <div role="group" aria-label={t.workSelectionLabel} className="sticky bottom-4 z-10 mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line-strong bg-sheet py-2 pl-4 pr-2 shadow-[var(--shadow)]">
          <span className="tabular-nums text-[13px] text-ink-2">{chosen.length ? t.workSelected(chosen.length) : t.workExportHint}</span>
          <Button size="sm" variant="primary" disabled={!chosen.length} onClick={copy}>
            <Copy size={13} />
            {copied ? t.workCopied : t.workCopyBibtex}
          </Button>
          <button type="button" onClick={() => setSelected(new Set([...selected, ...inThisView.flatMap((r) => (r.work ? [r.work.id] : []))]))} className="text-[13px] text-ink-2 hover:underline">
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

/** The drag edge of a column header: dragging sets the width, a double click resets it. */
function ResizeHandle({ width, min, label, onResize, onReset }: { width: number; min: number; label: string; onResize: (w: number) => void; onReset: () => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current) onResize(Math.max(min, start.current.w + e.clientX - start.current.x));
  };
  return <div role="separator" aria-orientation="vertical" data-tip={label} onPointerDown={down} onPointerMove={move} onPointerUp={() => (start.current = null)} onDoubleClick={onReset} className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:left-1/2 after:top-2 after:h-4 after:w-px after:bg-line-strong hover:after:bg-accent" />;
}

function Rail({
  views, view, onView, count, tags, tagFilter, onTag, file, onHave, onMissing, onNewTag,
}: {
  views: [View, string][];
  view: View;
  onView: (v: View) => void;
  count: (v: View) => number;
  tags: { id: string; name: string; color: string; n: number }[];
  tagFilter: string[];
  onTag: (id: string) => void;
  file: { have: boolean; missing: boolean; nHave: number; nMissing: number };
  onHave: (on: boolean) => void;
  onMissing: (on: boolean) => void;
  onNewTag: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const box = (checked: boolean, onChange: (on: boolean) => void, label: React.ReactNode, n: number) => (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-sunk">
      <input type="checkbox" className="wb-check" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="tabular-nums text-ink-3">{n}</span>
    </label>
  );
  const head = 'mb-1 mt-4 px-1.5 text-[12px] font-semibold text-ink-3 first:mt-0';
  return (
    <aside className="sticky top-4 w-44 shrink-0 self-start">
      <h3 className={head}>{t.libView}</h3>
      <ul>
        {views.map(([v, label]) => (
          <li key={v}>
            <button type="button" aria-current={view === v} onClick={() => onView(v)} className={clsx('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-sunk', view === v && 'bg-accent-soft font-medium')}>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {v === 'relevant' ? null : <span className="tabular-nums text-ink-3">{count(v)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <h3 className={head}>{t.libTags}</h3>
      <ul>
        {tags.map((g) => (
          <li key={g.id}>{box(tagFilter.includes(g.id), () => onTag(g.id), <span className="inline-flex items-center gap-1.5"><TagDot color={g.color} />{g.name}</span>, g.n)}</li>
        ))}
      </ul>
      {adding ? (
        <form
          className="px-1.5 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void onNewTag(name).then(() => {
              setName('');
              setAdding(false);
            });
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} placeholder={t.libNewTagName} aria-label={t.libNewTagName} className="h-7 w-full rounded-md border border-line-strong bg-sheet px-2 text-[13px]" />
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-0.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-ink-3 hover:bg-sunk hover:text-ink">
          <Plus size={13} /> {t.libNewTag}
        </button>
      )}
      <h3 className={head}>{t.libFile}</h3>
      {box(file.have, onHave, t.libFileHave, file.nHave)}
      {box(file.missing, onMissing, t.libFileMissing, file.nMissing)}
    </aside>
  );
}

function Row({ row: r, template, exporting, selected, onToggle, active, onSelect }: { row: LibraryRow; template: string; exporting: boolean; selected: boolean; onToggle: () => void; active: boolean; onSelect: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const w = r.work;
  const res = r.resource;
  const setTags = (ids: string[]) => {
    if (w) setWorkTags(qc, w.id, ids);
    else if (res) void setTagsOn('resource', res.id, ids).then(() => refreshResources(qc));
  };
  const viewer = res && isPdf(res.file.filename) ? `/resources/${encodeURIComponent(res.id)}` : null;
  const plain = res && !viewer ? fileUrl(res) : null;
  const titleClass = clsx('line-clamp-2 break-words text-[14px] leading-snug', w && sure(w) ? 'font-medium' : r.kind === 'work' && 'italic text-ink-2');
  const click = (e: React.MouseEvent) => {
    if (exporting) {
      if (w) onToggle();
      return;
    }
    if (!(e.target as HTMLElement).closest('a,button,input,[role=menu],[role=dialog]')) onSelect();
  };
  return (
    <div data-row-key={r.key} className="group/row border-b border-line last:border-b-0">
      <div role="row" aria-selected={active} onClick={click} className={clsx('grid cursor-pointer items-start hover:bg-sunk', active && 'bg-accent-soft hover:bg-accent-soft')} style={{ gridTemplateColumns: template }}>
        <div className="grid h-9 place-items-center">
          {exporting && w ? (
            <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label={t.workSelectOne(r.title)} className="wb-check" />
          ) : w ? (
            <WorkStateMenu work={w} />
          ) : (
            <span aria-label={t.libMaterialNoState} className="size-1.5 rounded-full bg-line-strong" />
          )}
        </div>
        <div className="min-w-0 px-2 py-2">
          {viewer ? (
            <Link href={viewer} className={clsx(titleClass, 'hover:underline')}>
              {r.title}
            </Link>
          ) : plain ? (
            <a href={plain} target="_blank" rel="noreferrer" onClick={() => res && recordOpen(res.id)} className={clsx(titleClass, 'hover:underline')}>
              {r.title}
            </a>
          ) : (
            <span className={titleClass}>{r.title}</span>
          )}
        </div>
        <div className="min-w-0 px-2 py-2 text-[13px] leading-snug text-ink-2">
          <span className="line-clamp-2 break-words">{r.authors}</span>
        </div>
        <div className="px-2 py-2 text-[13px] tabular-nums text-ink-2">{r.year ?? ''}</div>
        <div className="min-w-0 px-2 py-1.5 text-[13px]">
          <RowTags value={r.tags} onChange={setTags} />
        </div>
        <div className="grid h-9 place-items-center">
          {viewer ? (
            <Link href={viewer} aria-label={t.libOpenFile} data-tip={t.libOpenFile} className="rounded p-1 text-ink-3 hover:bg-sunk hover:text-accent">
              <FileText size={15} />
            </Link>
          ) : plain ? (
            <a href={plain} target="_blank" rel="noreferrer" onClick={() => res && recordOpen(res.id)} aria-label={t.libOpenFile} data-tip={t.libOpenFile} className="rounded p-1 text-ink-3 hover:bg-sunk hover:text-accent">
              <FileText size={15} />
            </a>
          ) : (
            <span aria-label={t.libNoFile} data-tip={t.libNoFile} className="text-ink-3/50">–</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The selected row's details at the bottom of the table: collapsed to one line, or open with everything about it. */
function DetailPane({ row: r, open, onToggle, openRef, onEditResource, onDeleteResource }: { row: LibraryRow; open: boolean; onToggle: () => void; openRef: { current: HTMLElement | null }; onEditResource: (r: Resource) => void; onDeleteResource: (r: Resource) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const tagMap = useTagMap();
  const w = r.work;
  const res = r.resource;
  const version = useNewVersion(res ?? ({} as Resource));
  const marks = usePdfAnnotations(res?.id ?? '');
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [newTag, setNewTag] = useState<string | null>(null);
  const [height, setHeight] = useState(() => {
    try {
      return Math.min(600, Math.max(140, Number(localStorage.getItem(PANE_KEY)) || 260));
    } catch {
      return 260;
    }
  });
  const drag = useRef<{ y: number; h: number } | null>(null);
  const keep = (h: number) => {
    try {
      localStorage.setItem(PANE_KEY, String(h));
    } catch {
      /* not remembered */
    }
  };
  const setTags = (ids: string[]) => {
    if (w) setWorkTags(qc, w.id, ids);
    else if (res) void setTagsOn('resource', res.id, ids).then(() => refreshResources(qc));
  };
  const viewer = res && isPdf(res.file.filename) ? `/resources/${encodeURIComponent(res.id)}` : null;
  const plain = res && !viewer ? fileUrl(res) : null;
  const openLabel = t.libPaneOpen;
  const openButton = (cls: string): ReactNode =>
    viewer ? (
      <Link href={viewer} ref={(el: HTMLAnchorElement | null) => void (openRef.current = el)} className={cls}>
        {openLabel}
      </Link>
    ) : plain ? (
      <a href={plain} ref={(el) => void (openRef.current = el)} target="_blank" rel="noreferrer" onClick={() => res && recordOpen(res.id)} className={cls}>
        {openLabel}
      </a>
    ) : null;
  useEffect(() => () => void (openRef.current = null), [openRef]);
  const btn = 'rounded-md border border-line px-2 py-0.5 text-[12.5px] font-medium hover:bg-sunk';
  const head = 'mb-1 text-[12px] font-semibold text-ink-3';
  const tags = [...tagMap.values()];
  const tagNames = r.tags.map((id) => tagMap.get(id)?.name).filter(Boolean).join(', ');

  return (
    <section aria-label={t.libPaneLabel} className="sticky bottom-0 z-10 mt-2 rounded-t-lg border border-line-strong bg-sheet shadow-[var(--shadow)]">
      {open ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          data-tip={t.libPaneResize}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, h: height };
          }}
          onPointerMove={(e) => drag.current && setHeight(Math.min(600, Math.max(140, drag.current.h - (e.clientY - drag.current.y))))}
          onPointerUp={() => {
            drag.current = null;
            keep(height);
          }}
          className="h-2 cursor-row-resize touch-none rounded-t-lg after:mx-auto after:mt-0.5 after:block after:h-0.5 after:w-10 after:rounded after:bg-line-strong hover:after:bg-accent"
        />
      ) : null}
      <div className="flex items-center gap-3 px-3 py-1.5">
        {w ? <WorkStateButtons work={w} size="sm" /> : null}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{r.title}</span>
        <span className="hidden min-w-0 max-w-[30%] truncate text-[13px] text-ink-2 md:block">{r.authors}</span>
        {!open && tagNames ? <span className="hidden max-w-[20%] truncate text-[13px] text-ink-3 lg:block">{tagNames}</span> : null}
        {!open ? openButton(btn) : null}
        {!open && res ? <FileText size={15} aria-label={t.libOpenFile} className="shrink-0 text-ink-3" /> : null}
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={t.libPaneToggle} data-tip={t.libPaneToggle} className="rounded p-1 text-ink-3 hover:bg-sunk hover:text-ink">
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open ? (
        <div className="overflow-y-auto border-t border-line px-4 py-3 text-[13px]" style={{ height }}>
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            <div className="min-w-0">
              {w ? <WorkEntry work={w} fallback={w.raw} /> : <p className="break-words text-[14px] font-medium">{r.title}{r.authors ? <span className="font-normal text-ink-2"> · {r.authors}</span> : null}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {w ? (
                  <button type="button" className={btn} onClick={() => setEditing(true)}>
                    <Pencil size={12} className="mr-1 inline" />
                    {t.resourceEdit}
                  </button>
                ) : res ? (
                  <button type="button" className={btn} onClick={() => onEditResource(res)}>
                    <Pencil size={12} className="mr-1 inline" />
                    {t.resourceEdit}
                  </button>
                ) : null}
              </div>
              {w ? (
                <>
                  <h4 className={clsx(head, 'mt-4')}>{t.libPaneState}</h4>
                  <WorkStateButtons work={w} labels />
                </>
              ) : null}
              <h4 className={clsx(head, 'mt-4')}>{t.libTags}</h4>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {tags.map((g) => (
                  <label key={g.id} className="inline-flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" className="wb-check" checked={r.tags.includes(g.id)} onChange={(e) => setTags(e.target.checked ? [...r.tags, g.id] : r.tags.filter((x) => x !== g.id))} />
                    <TagDot color={g.color} />
                    {g.name}
                  </label>
                ))}
                {newTag === null ? (
                  <button type="button" onClick={() => setNewTag('')} className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
                    <Plus size={12} /> {t.libPaneNewTag}
                  </button>
                ) : (
                  <input
                    autoFocus
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setNewTag(null);
                      if (e.key === 'Enter' && newTag.trim()) {
                        e.preventDefault();
                        void ensureTag(qc, newTag).then((g) => {
                          setTags(r.tags.includes(g.id) ? r.tags : [...r.tags, g.id]);
                          setNewTag(null);
                        });
                      }
                    }}
                    placeholder={t.libNewTagName}
                    aria-label={t.libNewTagName}
                    className="h-6 w-32 rounded-md border border-line-strong bg-sheet px-2 text-[12.5px]"
                  />
                )}
              </div>
            </div>
            <div className="min-w-0">
              <h4 className={head}>{t.libFile}</h4>
              {res ? (
                <>
                  <p className="break-words text-ink-2">
                    {res.file.filename}
                    {res.lastPage !== null ? ` · ${t.libPaneLastPage(res.lastPage + 1)}` : ''}
                    {marks.data ? ` · ${t.libPaneMarks(marks.data.length)}` : ''}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {openButton(clsx(btn, 'text-accent'))}
                    <a href={fileUrl(res)} download={res.file.filename} className={btn}>
                      <Download size={12} className="mr-1 inline" />
                      {t.resourceDownload}
                    </a>
                    <button type="button" className={btn} onClick={version.choose}>
                      <Upload size={12} className="mr-1 inline" />
                      {t.resourceNewVersion}
                    </button>
                    {w ? (
                      <button type="button" className={btn} onClick={() => void linkWork(qc, w.id, null)}>
                        <Unlink size={12} className="mr-1 inline" />
                        {t.workMenuUnlink}
                      </button>
                    ) : null}
                    <button type="button" className={clsx(btn, 'text-danger')} onClick={() => onDeleteResource(res)}>
                      <Trash2 size={12} className="mr-1 inline" />
                      {t.resourceDelete}
                    </button>
                  </div>
                  {version.node}
                </>
              ) : (
                <>
                  <p className="text-ink-2">{t.libNoFile}</p>
                  {w && !linking ? (
                    <button type="button" className={clsx(btn, 'mt-1.5')} onClick={() => setLinking(true)}>
                      <Link2 size={12} className="mr-1 inline" />
                      {t.workMenuLink}
                    </button>
                  ) : null}
                  {w && linking ? <WorkLinkPicker work={w} onDone={() => setLinking(false)} /> : null}
                </>
              )}
              {w && (w.citedBy.length || w.citedOn.length) ? (
                <>
                  <h4 className={clsx(head, 'mt-4')}>{t.workCitedBy}</h4>
                  <ul className="space-y-0.5">
                    {w.citedBy.map((c) => (
                      <li key={c.resource}>
                        <Link href={`/resources/${encodeURIComponent(c.resource)}`} className="text-accent hover:underline">
                          {c.title}
                        </Link>{' '}
                        <span className="text-ink-3">×{c.count}</span>
                      </li>
                    ))}
                    {w.citedOn.map((c) => (
                      <li key={`${c.course}-${c.page}`}>
                        <Link href={c.href} className="text-accent hover:underline">
                          {c.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {w && w.similar.length ? (
                <>
                  <h4 className={clsx(head, 'mt-4')}>{t.workMenuSimilar}</h4>
                  <SimilarWorks work={w} similar={w.similar} />
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {editing && w ? <WorkEditDialog work={w} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}

/**
 * New finds from the PDFs, collapsed. Open, the keys sort the work under the cursor (L later, R read, K know, S skip),
 * the arrows move, and the next work slides into its place.
 */
function UnsortedTray({ works, alwaysOpen = false }: { works: LibraryWork[]; alwaysOpen?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [openState, setOpen] = useState(false);
  const open = alwaysOpen || openState;
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
    <section className={alwaysOpen ? '' : 'mt-6 border-t border-line-strong'} aria-label={t.workUnsorted}>
      {alwaysOpen ? null : (
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left text-[14px] font-semibold hover:bg-sunk">
        <span className="grid w-7 place-items-center text-ink-2">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
        <span>
          {t.workUnsorted} <span className="font-normal tabular-nums text-ink-2">{works.length}</span>
        </span>
      </button>
      )}
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

