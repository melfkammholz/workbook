import { toBibtex, type Resource, type ResourceSeries, type ResourcesResponse, type WorkState } from '@wb/shared';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, ChevronUp, Copy, Download, ExternalLink, FileInput, FileText, Lightbulb, Link2, Merge, Pencil, Plus, Search, Trash2, Unlink, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { isTyping } from '@/lib/keys';
import { linkWork, removeWork, setWorkState, setWorkTags, useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { buildRows, type LibraryRow } from '@/lib/libraryRows';
import { isPdf } from '@/lib/pdf';
import { usePdfAnnotations } from '@/lib/pdfAnnotations';
import { fileUrl, recordOpen, refreshResources } from '@/lib/resources';
import { Button, Dialog, Empty, Spinner, clsx } from './ui';
import { ensureTag, setTagsOn, useTagMap } from '@/lib/tags';
import { useBibImport } from './BibImport';
import { MenuItem, MenuRule, MoreMenu } from './Menu';
import { useNewVersion } from './NewVersionButton';
import { RowTags } from './RowTags';
import { TagDot } from './TagPicker';
import { MergeDialog, MergeIntoDialog } from './MergeWorks';
import { SimilarWorks, WorkLinkPicker, WorkStateButtons, sure } from './WorkBits';
import { AddDialog, detect } from './AddDialog';
import { WorkEditDialog } from './WorkEditDialog';

type View = 'all' | 'relevant' | 'later' | 'read' | 'know' | 'skip' | 'unsorted';
type ColId = 'title' | 'authors' | 'year' | 'tags';

// Every column has a fixed width the student can drag; the ones after it move along, and what is left of the frame stays empty before the actions. Together they never exceed the frame.
const COLS: { id: ColId; width: number; min: number }[] = [
  { id: 'title', width: 260, min: 140 },
  { id: 'authors', width: 150, min: 90 },
  { id: 'year', width: 44, min: 44 },
  { id: 'tags', width: 200, min: 90 },
];
const ACTIONS_W = 150;
const DOT_W = 18;
// Padding, the state mark, the actions and the gaps between the six columns.
const FIXED_W = 36 + DOT_W + ACTIONS_W + 12 * 6;
const PANE_KEY = 'wb.library.pane';
const PANE_OPEN_KEY = 'wb.library.paneOpen';
const WIDTHS_KEY = 'wb.library.columns4';
const ROW_PAD = 'px-[18px]';

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

/** What a view shows. Archived (skip) rows only show in their own view; unsorted finds wait in theirs. */
const inView = (r: LibraryRow, v: View) => {
  if (v === 'all') return r.state !== 'skip' && !r.unsorted;
  if (v === 'relevant') return r.relevant && r.state !== 'skip';
  if (v === 'unsorted') return r.unsorted;
  return r.state === v;
};

/** The mock's state mark: dashed (unsorted or a material), quarter amber (later), green tick (read), ring with a dot (know), faded (archived). */
function StateDot({ row }: { row: LibraryRow }) {
  const t = useT();
  const st = row.state;
  if (!row.work) return <span aria-hidden className="size-4" />;
  const label = st === 'later' ? t.workStateLater : st === 'read' ? t.workStateRead : st === 'know' ? t.workStateKnow : st === 'skip' ? t.libViewSkip : t.workStateNone;
  const base = 'relative block size-4 rounded-full border-[1.6px]';
  return (
    <span role="img" aria-label={label} data-tip={label} className="grid place-items-center">
      {st === 'later' ? (
        <i className={clsx(base, 'border-review')} style={{ background: 'conic-gradient(var(--review) 0 25%, transparent 0)' }} />
      ) : st === 'read' ? (
        <i className={clsx(base, 'border-done bg-done after:absolute after:left-[4px] after:top-[1.5px] after:h-2 after:w-1 after:rotate-[40deg] after:border-b-[1.6px] after:border-r-[1.6px] after:border-sheet after:content-[""]')} />
      ) : st === 'know' ? (
        <i className={clsx(base, 'border-accent bg-accent-soft after:absolute after:inset-[3.5px] after:rounded-full after:bg-accent after:content-[""]')} />
      ) : (
        <i className={clsx(base, 'border-dashed border-line-strong', st === 'skip' && 'opacity-40')} />
      )}
    </span>
  );
}

/**
 * The library: works with their material, and materials that are no work's, as one table. A rail on the left filters
 * by workbook, view, tag and file; in the "All" view what is relevant now sits on top. With a workbook open the rail
 * starts on that workbook's own entries.
 */
export function WorksLibrary({ resources, courses, series, activeCourse, dropped, onDroppedUsed, onEditResource, onDeleteResource }: { resources: Resource[]; courses: ResourcesResponse['courses']; series: ResourceSeries[]; activeCourse: string | null; dropped: File[] | null; onDroppedUsed: () => void; onEditResource: (r: Resource) => void; onDeleteResource: (r: Resource) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const works = useWorks().data;
  const tagMap = useTagMap();
  const [adding, setAdding] = useState<string | null>(null);
  const [addFiles, setAddFiles] = useState<File[] | null>(null);
  const bib = useBibImport((text) => setAdding(text));
  // Files dropped onto the page open the add dialog on them.
  useEffect(() => {
    if (!dropped?.length) return;
    setAddFiles(dropped);
    setAdding('');
    onDroppedUsed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped]);
  const [view, setView] = useState<View>('all');
  const [scopeChoice, setScopeChoice] = useState<'course' | 'all' | null>(null);
  const [fileHave, setFileHave] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [descending, setDescending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergingTwo, setMergingTwo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [widths, setWidths] = useState(readWidths);
  const [active, setActive] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LibraryRow | null>(null);
  const [paneOpen, setPaneOpen] = useState(() => {
    try {
      return localStorage.getItem(PANE_OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const openRef = useRef<HTMLElement | null>(null);
  const course = activeCourse ? courses.find((c) => c.id === activeCourse) : undefined;
  const scope = course ? (scopeChoice ?? 'course') : 'all';

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

  const allRows = useMemo(() => (works ? buildRows(works, resources) : []), [works, resources]);
  const belongs = (r: LibraryRow) => !!activeCourse && (!!r.resource?.courses.includes(activeCourse) || !!r.work?.citedOn.some((c) => c.course === activeCourse));
  // In a workbook's scope, new finds from PDFs still wait in Unsorted.
  const rows = useMemo(() => (scope === 'course' ? allRows.filter((r) => belongs(r) || r.unsorted) : allRows), [allRows, scope, activeCourse]); // eslint-disable-line react-hooks/exhaustive-deps
  const nCourse = useMemo(() => allRows.filter(belongs).length, [allRows, activeCourse]); // eslint-disable-line react-hooks/exhaustive-deps
  const usedTags = [...tagMap.values()].filter((g) => rows.some((r) => r.tags.includes(g.id)));
  const needle = query.trim().toLowerCase();
  const matchesQuery = (r: LibraryRow) =>
    !needle ||
    [r.title, r.authors, r.year ?? '', r.resource?.file.filename ?? '', ...r.tags.map((g) => tagMap.get(g)?.name ?? '')]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  const byFilters = (r: LibraryRow) => tagFilter.every((g) => r.tags.includes(g)) && (fileHave === fileMissing || (fileHave ? r.hasFile : !r.hasFile)) && matchesQuery(r);
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);
  const sorted = (list: LibraryRow[]) => [...list].sort((a, b) => (descending ? -1 : 1) * collator.compare(a.title, b.title));
  const inThisView = rows.filter((r) => byFilters(r) && inView(r, view));
  const relevant = view === 'all' ? sorted(inThisView.filter((r) => r.relevant)) : [];
  const rest = sorted(view === 'all' ? inThisView.filter((r) => !r.relevant) : inThisView);
  const shownCount = inThisView.length;
  const order = useMemo(() => [...relevant, ...rest], [relevant, rest]);
  const activeRow = order.find((r) => r.key === active);
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
    if (exporting) return;
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTyping(e.target) || document.querySelector('[role=dialog]')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!order.length) return;
        const at = order.findIndex((r) => r.key === active);
        const next = e.key === 'ArrowDown' ? Math.min(at + 1, order.length - 1) : at < 0 ? 0 : Math.max(at - 1, 0);
        setActive(order[next]!.key);
        document.querySelector(`[data-row-key="${order[next]!.key}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
        togglePane();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [order, active, view, exporting]);

  // In Unsorted, L, R, K and S sort the selected work and the next one is selected (the page's own l and k must not fire too).
  useEffect(() => {
    if (view !== 'unsorted' || exporting) return;
    const keys: Record<string, WorkState> = { l: 'later', r: 'read', k: 'know', s: 'skip' };
    const on = (e: KeyboardEvent) => {
      const st = keys[e.key.toLowerCase()];
      const at = order.findIndex((r) => r.key === active);
      const cur = order[at];
      if (!st || !cur?.work || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('[role=dialog]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setActive((order[at + 1] ?? order[at - 1])?.key ?? null);
      setWorkState(qc, cur.work.id, st);
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [order, active, view, exporting, qc]);

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

  const frameRef = useRef<HTMLDivElement>(null);
  const dragBase = useRef<Record<ColId, number> | null>(null);
  const keepWidths = (next: Record<ColId, number>) => {
    try {
      localStorage.setItem(WIDTHS_KEY, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };
  /**
   * The columns together never exceed the frame. A column grows into the free space first (the ones after it just move);
   * once the frame is full it takes width from the columns after it, nearest first, down to their minimums. Computed from
   * the widths at the start of the drag, so dragging back gives the width back.
   */
  const setWidth = (id: ColId, w: number | null) => {
    const base = dragBase.current ?? widths;
    const at = COLS.findIndex((c) => c.id === id);
    const def = COLS[at]!;
    const next = { ...base };
    if (w === null) {
      next[id] = def.width;
    } else {
      const free = (frameRef.current?.clientWidth ?? Infinity) - FIXED_W - COLS.reduce((n, c) => n + base[c.id], 0);
      let want = Math.max(def.min, Math.round(w));
      let deficit = want - base[id] - Math.max(free, 0);
      for (const c of COLS.slice(at + 1)) {
        if (deficit <= 0) break;
        const take = Math.min(deficit, next[c.id] - c.min);
        next[c.id] -= take;
        deficit -= take;
      }
      if (deficit > 0) want -= deficit;
      next[id] = Math.max(def.min, want);
    }
    setWidths(next);
    keepWidths(next);
  };
  const template = `${DOT_W}px ${COLS.map((c) => `${widths[c.id]}px`).join(' ')} minmax(0,1fr) ${ACTIONS_W}px`;
  const tableMin = FIXED_W + COLS.reduce((n, c) => n + widths[c.id], 0);

  /** Archive hides a work (state "skip"); archiving again brings it back. Materials without a work have no state. */
  const archive = (r: LibraryRow) => r.work && setWorkState(qc, r.work.id, r.state === 'skip' ? null : 'skip');
  const askRemove = (r: LibraryRow) => (r.work ? setRemoving(r) : r.resource ? onDeleteResource(r.resource) : undefined);
  const ops = { archive, remove: askRemove, editResource: onEditResource };

  const renderRow = (r: LibraryRow) => (
    <Row key={r.key} row={r} template={template} exporting={exporting} active={r.key === active} onSelect={() => { setActive(r.key); setPaneOpen(true); }} selected={r.work ? selected.has(r.work.id) : false} onToggle={() => r.work && toggle(r.work.id)} ops={ops} />
  );
  const divider = (first: boolean, children: ReactNode) => (
    <div className={clsx('flex items-center gap-2.5 pb-1 text-[12.5px] after:h-px after:flex-1', ROW_PAD, first ? 'pt-2 font-semibold text-accent after:bg-accent/40' : 'pt-3.5 text-ink-3 after:bg-line-strong')}>{children}</div>
  );

  const toolbar = (
    <div className={clsx('flex flex-wrap items-center gap-2.5 pb-2.5 pt-3.5', ROW_PAD)}>
      <h1 className="text-xl font-semibold tracking-[-0.02em]">{t.library}</h1>
      <span className="flex-1" />
      <label className="flex h-[30px] min-w-48 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-ink-3 focus-within:border-accent">
        <Search size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.libSearch} aria-label={t.libSearch} className="w-full min-w-0 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3" />
      </label>
      <MoreMenu label={t.moreActions} pinned width="w-72" className="size-[30px]">
        <MenuItem icon={<FileInput size={15} />} onSelect={bib.pickFile}>
          {t.bibImportFile}
        </MenuItem>
        <p className="px-2.5 pb-1 text-[12px] leading-snug text-ink-3">{t.bibImportHint}</p>
        <MenuRule />
        <MenuItem icon={<Copy size={15} />} onSelect={() => setExporting(true)}>
          {t.workExport}
        </MenuItem>
      </MoreMenu>
      <Button size="sm" variant="primary" onClick={() => setAdding('')}>
        <Plus size={14} /> {t.workAdd}
      </Button>
    </div>
  );

  const dialogs = (
    <>
      {bib.node}
      {mergingTwo && chosen.length === 2 ? <MergeDialog a={chosen[0]!} b={chosen[1]!} onClose={() => { setMergingTwo(false); stopExport(); }} /> : null}
      {adding !== null ? <AddDialog initialText={adding} initialFiles={addFiles} courses={courses} series={series} course={activeCourse} onClose={() => { setAdding(null); setAddFiles(null); }} /> : null}
      {removing?.work ? (
        <Dialog open onOpenChange={(o) => !o && setRemoving(null)} title={t.libDeleteTitle(removing.title)}>
          <p className="text-sm text-ink-2">{t.workRemoveAsk}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const w = removing.work!;
                setRemoving(null);
                setActive(null);
                void removeWork(qc, w.id).catch(() => undefined);
              }}
            >
              {t.libDelete}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );

  if (!works || allRows.length === 0) {
    return (
      <div className="mx-auto flex h-full w-full max-w-[1240px] flex-col px-6 pb-5 pt-4">
        <div className="rounded-[10px] border border-line bg-sheet">
          {toolbar}
          <div className="px-4 pb-10 pt-6">{!works ? <div className="grid place-items-center"><Spinner /></div> : <Empty title={t.workNone} />}</div>
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1240px] flex-col px-6 pb-5 pt-4">
      <div className="grid min-h-0 flex-1 grid-cols-[215px_minmax(0,1fr)] overflow-hidden rounded-[10px] border border-line bg-sheet">
        <Rail
          scope={course ? { title: course.title, value: scope, nCourse, nAll: allRows.length, onChange: setScopeChoice } : null}
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
        <div className="flex min-h-0 min-w-0 flex-col">
          {toolbar}
          <div ref={frameRef} className="min-h-0 flex-1 overflow-x-auto">
            <div className="flex h-full min-h-0 flex-col" style={{ minWidth: tableMin }}>
              <div role="row" className={clsx('grid h-[30px] shrink-0 items-center gap-x-3 border-b border-line text-[12.5px] text-ink-3', ROW_PAD)} style={{ gridTemplateColumns: template }}>
                <span />
                <div role="columnheader" className="relative">
                  <button type="button" onClick={() => setDescending(!descending)} className="inline-flex items-center gap-1 font-semibold text-ink hover:text-accent" aria-label={`${t.libColTitle}: ${descending ? '↓' : '↑'}`}>
                    {t.libColTitle}
                    {descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                  </button>
                  <ResizeHandle width={widths.title} min={140} label={t.libResizeHint} onStart={() => (dragBase.current = widths)} onResize={(w) => setWidth('title', w)} onReset={() => setWidth('title', null)} />
                </div>
                {COLS.slice(1).map((c) => (
                  <div key={c.id} role="columnheader" className="relative">
                    {t[c.id === 'authors' ? 'libColAuthors' : c.id === 'year' ? 'libColYear' : 'libColTags']}
                    <ResizeHandle width={widths[c.id]} min={c.min} label={t.libResizeHint} onStart={() => (dragBase.current = widths)} onResize={(w) => setWidth(c.id, w)} onReset={() => setWidth(c.id, null)} />
                  </div>
                ))}
                <span />
                <span />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {view === 'unsorted' && shownCount ? <p className={clsx('pb-1 pt-2.5 text-[13px] text-ink-2', ROW_PAD)}>{t.workUnsortedHint}</p> : null}
                {shownCount === 0 ? (
                  <div className="p-4 text-ink-2">
                    <p>{scope === 'course' && course && !needle && !tagFilter.length && view === 'all' ? t.libNothingIn(course.title) : t.workNoneFilter}</p>
                    {scope === 'course' ? (
                      <button type="button" onClick={() => setScopeChoice('all')} className="mt-1 font-medium text-accent hover:underline">
                        {t.libShowAll}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    {relevant.length ? (
                      <>
                        {divider(true, <>{t.libRelevantHead} <small className="font-normal text-ink-3">{t.libRelevantSub}</small></>)}
                        {relevant.map(renderRow)}
                        {rest.length ? divider(false, <>{t.libOthers} <small>{rest.length}</small></>) : null}
                      </>
                    ) : null}
                    {rest.map(renderRow)}
                  </>
                )}
              </div>
            </div>
          </div>
          {exporting ? (
            <div role="group" aria-label={t.workSelectionLabel} className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-strong bg-sheet py-2 pl-4 pr-2">
              <span className="tabular-nums text-[13px] text-ink-2">{chosen.length ? t.workSelected(chosen.length) : t.workExportHint}</span>
              <Button size="sm" variant="primary" disabled={!chosen.length} onClick={copy}>
                <Copy size={13} />
                {copied ? t.workCopied : t.workCopyBibtex}
              </Button>
              {chosen.length === 2 ? (
                <Button size="sm" variant="ghost" onClick={() => setMergingTwo(true)}>
                  <Merge size={13} />
                  {t.workMergeTwo}
                </Button>
              ) : null}
              <button type="button" onClick={() => setSelected(new Set([...selected, ...inThisView.flatMap((r) => (r.work ? [r.work.id] : []))]))} className="text-[13px] text-ink-2 hover:underline">
                {t.workSelectShown}
              </button>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={stopExport}>
                {t.cancel}
              </Button>
            </div>
          ) : activeRow ? (
            <DetailPane key={activeRow.key} row={activeRow} open={paneOpen} onToggle={togglePane} openRef={openRef} ops={ops} />
          ) : null}
        </div>
      </div>
      {dialogs}
    </div>
  );
}

type Ops = { archive: (r: LibraryRow) => void; remove: (r: LibraryRow) => void; editResource: (r: Resource) => void };

/** The drag edge of a column header: dragging sets the width (the columns after it move along), a double click resets it. */
function ResizeHandle({ width, min, label, onStart, onResize, onReset }: { width: number; min: number; label: string; onStart: () => void; onResize: (w: number) => void; onReset: () => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    onStart();
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current) onResize(Math.max(min, start.current.w + e.clientX - start.current.x));
  };
  return <div role="separator" aria-orientation="vertical" data-tip={label} onPointerDown={down} onPointerMove={move} onPointerUp={() => (start.current = null)} onDoubleClick={() => { onStart(); onReset(); }} className="absolute -right-3 -top-1.5 z-10 flex h-[30px] w-3 cursor-col-resize touch-none justify-center after:h-full after:w-px hover:after:w-0.5 hover:after:bg-accent" />;
}

function Rail({
  scope, views, view, onView, count, tags, tagFilter, onTag, file, onHave, onMissing, onNewTag,
}: {
  scope: { title: string; value: 'course' | 'all'; nCourse: number; nAll: number; onChange: (v: 'course' | 'all') => void } | null;
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
    <label className="-mx-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-[3px] text-ink-2 hover:bg-sunk">
      <input type="checkbox" className="wb-check" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[12.5px] tabular-nums text-ink-3">{n}</span>
    </label>
  );
  const option = (on: boolean, label: ReactNode, n: number | null, onClick: () => void) => (
    <button type="button" aria-current={on} onClick={onClick} className={clsx('-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-[3px] text-left hover:bg-sunk', on ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2')}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {n === null ? null : <span className="text-[12.5px] font-normal tabular-nums text-ink-3">{n}</span>}
    </button>
  );
  const head = 'mb-1 mt-4 text-[12.5px] font-semibold text-ink-2 first:mt-0';
  return (
    <aside className="min-h-0 overflow-y-auto border-r border-line p-4 text-[13.5px]">
      {scope ? (
        <>
          <h3 className={head}>{t.libScope}</h3>
          {option(scope.value === 'course', scope.title, scope.nCourse, () => scope.onChange('course'))}
          {option(scope.value === 'all', t.libScopeAll, scope.nAll, () => scope.onChange('all'))}
        </>
      ) : null}
      <h3 className={head}>{t.libView}</h3>
      {views.map(([v, label]) => (
        <div key={v}>{option(view === v, label, v === 'relevant' ? null : count(v), () => onView(v))}</div>
      ))}
      <h3 className={head}>{t.libTags}</h3>
      {tags.map((g) => (
        <div key={g.id}>{box(tagFilter.includes(g.id), () => onTag(g.id), <span className="inline-flex items-center gap-1.5"><TagDot color={g.color} />{g.name}</span>, g.n)}</div>
      ))}
      {adding ? (
        <form
          className="pt-1"
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
        <button type="button" onClick={() => setAdding(true)} className="mt-0.5 flex items-center gap-1.5 rounded-md py-1 text-ink-3 hover:text-ink">
          <Plus size={13} /> {t.libNewTag}
        </button>
      )}
      <h3 className={head}>{t.libFile}</h3>
      {box(file.have, onHave, t.libFileHave, file.nHave)}
      {box(file.missing, onMissing, t.libFileMissing, file.nMissing)}
    </aside>
  );
}

const iconBtn = 'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-line hover:text-ink';

function Row({ row: r, template, exporting, selected, onToggle, active, onSelect, ops }: { row: LibraryRow; template: string; exporting: boolean; selected: boolean; onToggle: () => void; active: boolean; onSelect: () => void; ops: Ops }) {
  const t = useT();
  const qc = useQueryClient();
  const w = r.work;
  const res = r.resource;
  const setTags = (ids: string[]) => {
    if (w) {
      setWorkTags(qc, w.id, ids);
      // One owner: a linked material's own tags are cleared, the work holds the union.
      if (res?.labels.length) void setTagsOn('resource', res.id, []).then(() => refreshResources(qc));
    } else if (res) void setTagsOn('resource', res.id, ids).then(() => refreshResources(qc));
  };
  const viewer = res && isPdf(res.file.filename) ? `/resources/${encodeURIComponent(res.id)}` : null;
  const plain = res && !viewer ? fileUrl(res) : null;
  const titleClass = clsx('line-clamp-2 break-words leading-snug', w && sure(w) ? 'font-medium' : r.kind === 'work' && 'italic text-ink-2');
  const click = (e: React.MouseEvent) => {
    if (exporting) {
      if (w) onToggle();
      return;
    }
    if (!(e.target as HTMLElement).closest('a,button,input,[role=menu],[role=dialog]')) onSelect();
  };
  const openFile = viewer ? (
    <Link href={viewer} aria-label={t.libOpenFile} data-tip={t.libOpenFile} className={iconBtn}>
      <ExternalLink size={14} />
    </Link>
  ) : plain ? (
    <a href={plain} target="_blank" rel="noreferrer" onClick={() => res && recordOpen(res.id)} aria-label={t.libOpenFile} data-tip={t.libOpenFile} className={iconBtn}>
      <ExternalLink size={14} />
    </a>
  ) : null;
  const stateBtn = (st: 'later' | 'read', Icon: typeof Bookmark, label: string) =>
    w ? (
      <button key={st} type="button" aria-pressed={r.state === st} aria-label={label} data-tip={label} onClick={() => setWorkState(qc, w.id, r.state === st ? null : st)} className={clsx(iconBtn, r.state === st && 'bg-accent-soft text-accent')}>
        <Icon size={14} />
      </button>
    ) : null;
  return (
    <div data-row-key={r.key} className="group/row border-b border-line/60">
      <div
        role="row"
        aria-selected={active}
        onClick={click}
        className={clsx('grid min-h-[34px] cursor-pointer items-center gap-x-3 py-1.5 text-[13.5px] hover:bg-sunk', ROW_PAD, r.relevant && !active && 'bg-accent-soft/40', active && 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)] hover:bg-accent-soft')}
        style={{ gridTemplateColumns: template }}
      >
        <StateDot row={r} />
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={titleClass}>{r.title}</span>
          {w && w.similar.length ? <Merge size={13} aria-label={t.workSimilarNote} data-tip={t.workSimilarNote} className="shrink-0 text-accent" /> : null}
        </div>
        <div className="min-w-0 text-[13px] leading-snug text-ink-3">
          <span className="line-clamp-2 break-words">{r.authors}</span>
        </div>
        <div className="text-[13px] tabular-nums text-ink-2">{r.year ?? ''}</div>
        <div className="min-w-0 text-[13px]">
          <RowTags value={r.tags} onChange={setTags} />
        </div>
        <span />
        <div className="relative flex h-6 items-center justify-end gap-1.5 text-ink-3">
          {exporting && w ? (
            <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label={t.workSelectOne(r.title)} className="wb-check" />
          ) : (
            <>
              <span className={clsx('flex items-center gap-1.5', 'group-hover/row:invisible group-focus-within/row:invisible', active && 'invisible')}>
                <FileText size={15} aria-label={res ? undefined : t.libNoFile} className={clsx(!res && 'opacity-35')} />
              </span>
              <span role="group" aria-label={t.libQuickActions} className={clsx('absolute inset-y-0 right-0 flex items-center gap-0.5', active ? 'visible' : 'invisible group-hover/row:visible group-focus-within/row:visible')}>
                {stateBtn('later', Bookmark, t.workStateLater)}
                {stateBtn('read', Check, t.workStateRead)}
                {w ? (
                  <button type="button" aria-label={r.state === 'skip' ? t.libUnarchive : t.libArchive} data-tip={r.state === 'skip' ? t.libUnarchive : t.libArchive} onClick={() => ops.archive(r)} className={iconBtn}>
                    {r.state === 'skip' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  </button>
                ) : null}
                {openFile}
                <RowMenu row={r} ops={ops} />
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** "⋯" of a row: everything the quick actions leave out. */
function RowMenu({ row: r, ops }: { row: LibraryRow; ops: Ops }) {
  const t = useT();
  const qc = useQueryClient();
  const w = r.work;
  const res = r.resource;
  const version = useNewVersion(res ?? ({} as Resource));
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  return (
    <>
      <MoreMenu label={t.moreActions} pinned width="w-56" className="size-6">
        {w ? (
          <MenuItem icon={<Merge size={15} />} onSelect={() => setMerging(true)}>
            {t.workMergeInto}
          </MenuItem>
        ) : null}
        {w ? (
          <MenuItem icon={<Lightbulb size={15} />} onSelect={() => setWorkState(qc, w.id, r.state === 'know' ? null : 'know')}>
            {t.workStateKnow}
          </MenuItem>
        ) : null}
        {w ? (
          <MenuItem icon={<Pencil size={15} />} onSelect={() => setEditing(true)}>
            {t.resourceEdit}
          </MenuItem>
        ) : res ? (
          <MenuItem icon={<Pencil size={15} />} onSelect={() => ops.editResource(res)}>
            {t.resourceEdit}
          </MenuItem>
        ) : null}
        {res ? (
          <>
            <MenuItem icon={<Download size={15} />} href={fileUrl(res)} download={res.file.filename}>
              {t.resourceDownload}
            </MenuItem>
            <MenuItem icon={<Upload size={15} />} onSelect={version.choose}>
              {t.resourceNewVersion}
            </MenuItem>
          </>
        ) : null}
        <MenuRule />
        <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => ops.remove(r)}>
          {t.libDelete}
        </MenuItem>
      </MoreMenu>
      {editing && w ? <WorkEditDialog work={w} onClose={() => setEditing(false)} /> : null}
      {merging && w ? <MergeIntoDialog work={w} onClose={() => setMerging(false)} /> : null}
      {version.node}
    </>
  );
}

/** The selected row's details at the bottom of the table: collapsed to one line, or open with everything about it. */
function DetailPane({ row: r, open, onToggle, openRef, ops }: { row: LibraryRow; open: boolean; onToggle: () => void; openRef: { current: HTMLElement | null }; ops: Ops }) {
  const t = useT();
  const qc = useQueryClient();
  const w = r.work;
  const res = r.resource;
  const version = useNewVersion(res ?? ({} as Resource));
  const marks = usePdfAnnotations(res?.id ?? '');
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [height, setHeight] = useState(() => {
    try {
      return Math.min(600, Math.max(120, Number(localStorage.getItem(PANE_KEY)) || 200));
    } catch {
      return 200;
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
    if (w) {
      setWorkTags(qc, w.id, ids);
      // One owner: a linked material's own tags are cleared, the work holds the union.
      if (res?.labels.length) void setTagsOn('resource', res.id, []).then(() => refreshResources(qc));
    } else if (res) void setTagsOn('resource', res.id, ids).then(() => refreshResources(qc));
  };
  const viewer = res && isPdf(res.file.filename) ? `/resources/${encodeURIComponent(res.id)}` : null;
  const plain = res && !viewer ? fileUrl(res) : null;
  const openButton = (cls: string, label: ReactNode): ReactNode =>
    viewer ? (
      <Link href={viewer} ref={(el: HTMLAnchorElement | null) => void (openRef.current = el)} className={cls}>
        {label}
      </Link>
    ) : plain ? (
      <a href={plain} ref={(el) => void (openRef.current = el)} target="_blank" rel="noreferrer" onClick={() => res && recordOpen(res.id)} className={cls}>
        {label}
      </a>
    ) : null;
  useEffect(() => () => void (openRef.current = null), [openRef]);
  const btn = 'inline-flex size-7 items-center justify-center rounded-lg border border-line-strong bg-sheet text-ink-2 hover:bg-sunk hover:text-ink';
  const tip = (label: string) => ({ 'aria-label': label, 'data-tip': label });
  const tagNames = useTagMap();
  const tagLine = r.tags.map((id) => tagNames.get(id)?.name).filter(Boolean).join(', ');
  const by = w ? [w.authors, w.year, w.venue].filter(Boolean).join(' · ') : [r.authors, r.year].filter(Boolean).join(' · ');
  const ids = w ? [w.doi, w.arxiv ? `arXiv:${w.arxiv}` : ''].filter(Boolean).join(' · ') : '';
  const kv = 'grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-3 border-t border-line py-[7px] first:border-t-0 first:pt-0';
  const kvHead = 'text-[13px] font-semibold text-ink-3';
  const archived = r.state === 'skip';

  return (
    <section aria-label={t.libPaneLabel} className="relative shrink-0 border-t border-line-strong bg-sunk/45">
      {open ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          data-tip={t.libPaneResize}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, h: height };
          }}
          onPointerMove={(e) => drag.current && setHeight(Math.min(600, Math.max(120, drag.current.h - (e.clientY - drag.current.y))))}
          onPointerUp={() => {
            drag.current = null;
            keep(height);
          }}
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none after:mx-auto after:block after:h-[7px] after:w-11 after:rounded after:bg-line-strong hover:after:bg-accent"
        />
      ) : null}
      <div className="flex items-center gap-2 px-4 py-2 text-[13.5px]">
        {open ? (
          <span className="flex-1" />
        ) : (
          <>
            <span className="min-w-0 truncate font-medium">{r.title}</span>
            <span className="hidden min-w-0 shrink-[2] truncate text-ink-2 md:block">{by}</span>
            {tagLine ? <span className="hidden shrink-0 text-ink-3 lg:block">{tagLine}</span> : null}
            <span className="flex-1" />
          </>
        )}
        {openButton(clsx(btn, 'text-accent'), <ExternalLink size={14} aria-label={t.libPaneOpen} data-tip={t.libPaneOpen} />)}
        {w ? (
          <button type="button" className={btn} onClick={() => setEditing(true)} {...tip(t.resourceEdit)}>
            <Pencil size={14} />
          </button>
        ) : res ? (
          <button type="button" className={btn} onClick={() => ops.editResource(res)} {...tip(t.resourceEdit)}>
            <Pencil size={14} />
          </button>
        ) : null}
        {w ? (
          <button type="button" className={btn} onClick={() => ops.archive(r)} {...tip(archived ? t.libUnarchive : t.libArchive)}>
            {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
        ) : null}
        <button type="button" className={clsx(btn, 'hover:text-danger')} onClick={() => ops.remove(r)} {...tip(t.libDelete)}>
          <Trash2 size={14} />
        </button>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={t.libPaneToggle} data-tip={t.libPaneToggle} className="rounded p-1 text-ink-3 hover:bg-sunk hover:text-ink">
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open ? (
        <div className="overflow-y-auto border-t border-line px-6 py-3.5 text-[13.5px]" style={{ height }}>
          <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
            <div className="min-w-0">
              <div className="pb-2">
                <h2 className="break-words text-base font-semibold leading-snug tracking-[-0.01em]">{r.title}</h2>
                {by ? <p className="mt-0.5 text-ink-2">{by}</p> : null}
                {ids ? <p className="mt-0.5 text-[12.5px] text-ink-3">{ids}</p> : null}
              </div>
              {w ? (
                <div className={kv}>
                  <h3 className={kvHead}>{t.libPaneState}</h3>
                  <WorkStateButtons work={w} />
                </div>
              ) : null}
              <div className={clsx(kv, 'group/row')}>
                <h3 className={kvHead}>{t.libTags}</h3>
                <div>
                  <RowTags value={r.tags} onChange={setTags} />
                </div>
              </div>
            </div>
            <div className="min-w-0">
              <div className={kv}>
                <h3 className={kvHead}>{t.libFile}</h3>
                {res ? (
                  <div className="min-w-0">
                    <p className="break-words">{res.file.filename}</p>
                    <p className="text-[12.5px] text-ink-3">{[res.lastPage !== null ? t.libPaneLastPage(res.lastPage + 1) : '', marks.data?.length ? t.libPaneMarks(marks.data.length) : ''].filter(Boolean).join(' · ')}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <a href={fileUrl(res)} download={res.file.filename} className={btn} {...tip(t.resourceDownload)}>
                        <Download size={14} />
                      </a>
                      <button type="button" className={btn} onClick={version.choose} {...tip(t.resourceNewVersion)}>
                        <Upload size={14} />
                      </button>
                      {w?.resource ? (
                        <button type="button" className={btn} onClick={() => void linkWork(qc, w.id, null)} {...tip(t.workMenuUnlink)}>
                          <Unlink size={14} />
                        </button>
                      ) : null}
                    </div>
                    {version.node}
                  </div>
                ) : (
                  <div>
                    <p className="text-ink-3">{t.libNoFile}</p>
                    {w && !linking ? (
                      <button type="button" className={clsx(btn, 'mt-1.5')} onClick={() => setLinking(true)} {...tip(t.workMenuLink)}>
                        <Link2 size={14} />
                      </button>
                    ) : null}
                    {w && linking ? <WorkLinkPicker work={w} onDone={() => setLinking(false)} /> : null}
                  </div>
                )}
              </div>
              {w && (w.citedBy.length || w.citedOn.length) ? (
                <div className={kv}>
                  <h3 className={kvHead}>{t.libCited}</h3>
                  <ul>
                    {w.citedOn.map((c) => (
                      <li key={`${c.course}-${c.page}`} className="flex justify-between gap-3 py-0.5">
                        <span className="min-w-0 truncate">{c.title}</span>
                        <Link href={c.href} className="shrink-0 text-accent hover:underline">
                          {t.libPaneOpen}
                        </Link>
                      </li>
                    ))}
                    {w.citedBy.map((c) => (
                      <li key={c.resource} className="flex justify-between gap-3 py-0.5">
                        <span className="min-w-0 truncate">{c.title}</span>
                        <Link href={`/resources/${encodeURIComponent(c.resource)}`} className="shrink-0 text-accent hover:underline">
                          ×{c.count}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {w && w.similar.length ? (
                <div className={kv}>
                  <h3 className={kvHead}>{t.libSimilar}</h3>
                  <SimilarWorks work={w} similar={w.similar} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {editing && w ? <WorkEditDialog work={w} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}
