import type { Resource, ResourceSeries, ResourceType } from '@wb/shared';
import { Download, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useBibImport } from '@/components/BibImport';
import { WorksLibrary } from '@/components/WorksLibrary';
import { WorkEditDialog } from '@/components/WorkEditDialog';
import { NewVersionButton } from '@/components/NewVersionButton';
import { DeleteDialog, EditDialog, UploadDialog } from '@/components/ResourceDialogs';
import { Button, Empty, IconButton, Spinner } from '@/components/ui';
import { useTags } from '@/lib/tags';
import { useOutline } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { isPdf, preloadPdf } from '@/lib/pdf';
import { fileUrl, formatSize, useResources } from '@/lib/resources';
import { useSettings } from '@/lib/api';

const TYPES: ResourceType[] = ['notes', 'slides', 'paper', 'other'];

function dateText(date: string): string {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The materials of the open course. */
export function MaterialsPage() {
  const course = useOutline().data;
  const t = useT();
  return <ResourcesView course={course?.id ?? null} heading={t.materials} intro={course ? t.materialsIntro(course.title) : ''} otherLink={{ href: '/library', label: t.allMaterials }} />;
}

/** Everything the student uploaded, grouped by type, with a group for what is in no course. */
export function LibraryPage() {
  const t = useT();
  return <ResourcesView course={null} heading={t.library} intro={t.libraryIntro} otherLink={null} activeCourse={useOutline().data?.id ?? null} />;
}

function ResourcesView({ course, activeCourse = course, heading, intro, otherLink }: { course: string | null; activeCourse?: string | null; heading: string; intro: string; otherLink: { href: string; label: string } | null }) {
  const t = useT();
  const list = useResources(course);
  const [uploading, setUploading] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const data = list.data;
  const labelDefs = useTags().data ?? [];
  const [tab, setTab] = useState<'files' | 'references'>('files');
  const bib = useBibImport();
  const [newWork, setNewWork] = useState(false);
  const refs = !course && tab === 'references';
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const usedLabels = labelDefs.filter((l) => data?.resources.some((r) => r.labels.includes(l.id)));
  const matches = (r: Resource) => labelFilter.every((l) => r.labels.includes(l));
  const seriesById = useMemo(() => new Map((data?.series ?? []).map((s) => [s.id, s])), [data]);
  const anyPdf = !!data?.resources.some((r) => isPdf(r.file.filename));
  // Opening a PDF then finds pdf.js and its worker already loaded.
  useEffect(() => {
    if (anyPdf) preloadPdf();
  }, [anyPdf]);
  const titleOfCourse = (id: string) => data?.courses.find((c) => c.id === id)?.title ?? id;

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }

  // In the library, what belongs to no course is a group of its own, after the types.
  const sections: { key: string; title: string; type: ResourceType | null; items: Resource[] }[] = [];
  const visible = data.resources.filter(matches);
  const asked = course ? visible : visible.filter((r) => r.courses.length > 0);
  for (const type of TYPES) sections.push({ key: type, title: t.resourceTypes[type], type, items: asked.filter((r) => r.type === type) });
  if (!course) sections.push({ key: 'none', title: t.resourceNoCourse, type: null, items: visible.filter((r) => r.courses.length === 0) });

  /** "new version 3 days ago, 2 notes to fix": for a month after a replacement, and as long as something is left to fix. */
  const versionNote = (r: Resource) => {
    if (r.versions < 2) return '';
    const days = Math.floor((Date.now() - r.file.uploadedAt) / 86_400_000);
    return days <= 30 || r.unplaced > 0 ? t.resourceVersionNote(days, r.unplaced) : '';
  };
  const row = (r: Resource, label?: string) => (
    <li key={r.id} className="group flex items-center gap-3 py-2.5">
      <FileText size={18} className="shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        {isPdf(r.file.filename) ? (
          <Link href={`/resources/${encodeURIComponent(r.id)}`} className="block truncate text-[15px] font-medium hover:underline">
            {label ? <span className="mr-2 text-ink-3">{label}</span> : null}
            {r.title}
          </Link>
        ) : (
          <a href={fileUrl(r)} target="_blank" rel="noreferrer" className="block truncate text-[15px] font-medium hover:underline">
            {label ? <span className="mr-2 text-ink-3">{label}</span> : null}
            {r.title}
          </a>
        )}
        <div className="truncate text-[13px] text-ink-2">
          {[r.author, dateText(r.date), formatSize(r.file.size), r.lastPage ? t.resourceOpenedAt(r.lastPage) : '', versionNote(r), !course && r.courses.length ? `${t.resourceInCourses} ${r.courses.map(titleOfCourse).join(', ')}` : '', r.labels.map((l) => labelDefs.find((d) => d.id === l)?.name).filter(Boolean).map((n) => `#${n}`).join(' ')].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <a href={fileUrl(r)} download={r.file.filename} aria-label={t.resourceDownload} title={t.resourceDownload} className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink">
          <Download size={16} />
        </a>
        <NewVersionButton resource={r} icon />
        <IconButton label={t.resourceEdit} onClick={() => setEditing(r)}>
          <Pencil size={16} />
        </IconButton>
        <IconButton label={t.resourceDelete} onClick={() => setDeleting(r)}>
          <Trash2 size={16} />
        </IconButton>
      </div>
    </li>
  );

  /** A series is one entry with its parts in order, each with its date. */
  const body = (items: Resource[]) => {
    const rows: ReactNode[] = [];
    const done = new Set<string>();
    for (const r of items) {
      if (!r.series) {
        rows.push(row(r));
        continue;
      }
      if (done.has(r.series)) continue;
      done.add(r.series);
      const s: ResourceSeries | undefined = seriesById.get(r.series);
      const parts = items.filter((x) => x.series === r.series).sort((a, b) => a.position - b.position);
      rows.push(
        <li key={`s-${r.series}`} className="py-2.5">
          <div className="mb-0.5 pl-[30px] text-sm font-semibold">{s?.title}</div>
          <ul className="divide-y divide-line/60 pl-4">{parts.map((p, i) => row(p, t.resourcePart(i + 1)))}</ul>
        </li>,
      );
    }
    return rows;
  };

  const hasFiles = (e: DragEvent<HTMLElement>) => [...e.dataTransfer.types].includes('Files');
  const drop = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    // Folders are ignored; only plain files are taken.
    const items = [...e.dataTransfer.items];
    const files = [...e.dataTransfer.files].filter((_, i) => !items[i]?.webkitGetAsEntry?.()?.isDirectory);
    if (!files.length) return;
    setDropped(files);
    setUploading(true);
  };
  const empty = sections.every((s) => s.items.length === 0);
  return (
    <div
      className={`h-full overflow-y-auto ${dragging ? 'outline outline-2 -outline-offset-4 outline-accent' : ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={drop}
    >
      <div className="settle wb-page mx-auto max-w-3xl px-6 pb-12 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{heading}</h1>
          <Button variant="primary" className="ml-auto" onClick={() => setUploading(true)}>
            <Plus size={16} /> {t.uploadFiles}
          </Button>
        </div>
        {intro ? <p className="mt-2 max-w-prose text-ink-2">{intro}</p> : null}
        {otherLink ? (
          <Link href={otherLink.href} className="mt-1 inline-block text-sm font-medium text-accent hover:underline">
            {otherLink.label}
          </Link>
        ) : null}
        {!course ? (
          <div className="mt-4 flex gap-4 border-b border-line" role="tablist">
            {(['files', 'references'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-0.5 pb-1.5 text-[14px] ${tab === k ? 'border-accent font-medium' : 'border-transparent text-ink-2 hover:text-ink'}`}>
                {k === 'files' ? t.workTabFiles : t.workTabReferences}
              </button>
            ))}
          </div>
        ) : null}
        {refs ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button size="sm" variant="primary" onClick={() => setNewWork(true)}>
              {t.workNew}
            </Button>
            <Button size="sm" onClick={bib.pickFile}>
              {t.bibImportFile}
            </Button>
            <span className="text-[12px] text-ink-3">{t.bibImportHint}</span>
          </div>
        ) : null}
        {bib.node}
        {newWork ? <WorkEditDialog onClose={() => setNewWork(false)} /> : null}
        {refs ? <WorksLibrary /> : null}
        {!refs && usedLabels.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label={t.resourceLabelFilter}>
            {usedLabels.map((l) => {
              const on = labelFilter.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setLabelFilter(on ? labelFilter.filter((x) => x !== l.id) : [...labelFilter, l.id])}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] ${on ? 'border-accent bg-accent-soft font-medium' : 'border-line text-ink-2 hover:bg-sunk'}`}
                >
                  <span className="size-2 rounded-full" style={{ background: l.color }} />
                  {l.name}
                </button>
              );
            })}
          </div>
        ) : null}
        {refs ? null : empty ? (
          <div className="mt-10">
            <Empty title={course ? t.resourceNoneCourse : t.resourceNone} />
          </div>
        ) : (
          sections
            .filter((s) => s.items.length)
            .map((s) => (
              <section key={s.key} className="mt-8">
                <h2 className="mb-1 text-[15px] font-semibold">{s.title}</h2>
                <ul className="divide-y divide-line">{body(s.items)}</ul>
              </section>
            ))
        )}
      </div>
      <UploadDialog open={uploading} onClose={() => {
          setUploading(false);
          setDropped(null);
        }}
        courses={data.courses}
        series={data.series}
        course={activeCourse}
        initial={dropped}
      />
      <EditDialog resource={editing} onClose={() => setEditing(null)} courses={data.courses} series={data.series} />
      <DeleteDialog resource={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
