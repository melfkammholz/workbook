import { useQueryClient } from '@tanstack/react-query';
import { RESOURCE_TYPES, type Resource, type ResourceFields, type ResourceSeries, type ResourcesResponse } from '@wb/shared';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { isPdf, pdfMetadata } from '@/lib/pdf';
import { MAX_FILE_BYTES, deleteResource, formatSize, naturalCompare, refreshResources, titleFromFilename, updateResource, uploadResource } from '@/lib/resources';
import { TagPicker } from './TagPicker';
import { Button, Dialog, Segmented } from './ui';

type Course = ResourcesResponse['courses'][number];
const NEW = '__new__';

/** What the two dialogs share: everything but the title and the file. */
function Details({ fields, set, courses, series, many }: { fields: ResourceFields; set: (p: Partial<ResourceFields>) => void; courses: Course[]; series: ResourceSeries[]; many?: boolean }) {
  const t = useT();
  const seriesValue = fields.newSeries !== undefined ? NEW : (fields.series ?? '');
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-sm font-medium">{t.resourceType}</div>
        <Segmented value={fields.type} options={RESOURCE_TYPES.map((x) => [x, t.resourceTypes[x]])} onChange={(type) => set({ type })} />
        <p className="mt-1 text-[13px] text-ink-2">{t.resourceTypeHint[fields.type]}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t.resourceAuthor}</span>
          <input value={fields.author} onChange={(e) => set({ author: e.target.value })} className="h-9 w-full wb-field px-2.5" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t.resourceDate}</span>
          <input type="date" value={fields.date} onChange={(e) => set({ date: e.target.value })} className="h-9 w-full wb-field px-2.5" />
        </label>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t.resourceCourses}</legend>
        {courses.length ? (
          <div className="space-y-1">
            {courses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="wb-check"
                  checked={fields.courses.includes(c.id)}
                  onChange={(e) => set({ courses: e.target.checked ? [...fields.courses, c.id] : fields.courses.filter((x) => x !== c.id) })}
                />
                {c.title}
              </label>
            ))}
          </div>
        ) : null}
        {fields.courses.length === 0 ? <p className="text-[13px] text-ink-2">{t.resourceCoursesNone}</p> : null}
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t.resourceLabels}</legend>
        <TagPicker value={fields.labels} onChange={(labels) => set({ labels })} />
      </fieldset>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t.resourceSeries}</span>
        <select
          value={seriesValue}
          onChange={(e) => (e.target.value === NEW ? set({ series: null, newSeries: '' }) : set({ series: e.target.value || null, newSeries: undefined }))}
          className="h-9 w-full wb-field px-2"
        >
          <option value="">{t.resourceNoSeries}</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
          <option value={NEW}>{t.resourceNewSeries}</option>
        </select>
        {fields.newSeries !== undefined ? (
          <input autoFocus value={fields.newSeries} onChange={(e) => set({ newSeries: e.target.value })} placeholder={t.resourceSeriesTitle} className="mt-2 h-9 w-full wb-field px-2.5" />
        ) : null}
        {many && seriesValue ? <span className="mt-1 block text-[13px] text-ink-2">{t.resourceSeriesOrder}</span> : null}
      </label>
    </div>
  );
}

const blank = (course: string | null): ResourceFields => ({ title: '', type: 'notes', author: '', date: '', courses: course ? [course] : [], labels: [], series: null });

/** Choose files, say what they are, upload them one after the other. */
export function UploadDialog({ open, onClose, courses, series, course, initial }: { open: boolean; onClose: () => void; courses: Course[]; series: ResourceSeries[]; course: string | null; initial?: File[] | null }) {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ file: File; title: string }[]>([]);
  const [fields, setFields] = useState<ResourceFields>(() => blank(course));
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFiles([]);
    setFields(blank(course));
    setProgress(null);
    setError(null);
  };
  const close = () => {
    if (progress !== null) return;
    reset();
    onClose();
  };
  const choose = (list: FileList | File[] | null) => {
    if (!list?.length) return;
    const picked = [...list].sort((a, b) => naturalCompare(a.name, b.name)).map((file) => ({ file, title: titleFromFilename(file.name) }));
    setFiles(picked);
    setError(picked.some((p) => p.file.size > MAX_FILE_BYTES) ? t.resourceTooLarge : null);
    // A PDF knows its own title and author; they fill in what the student has not typed yet.
    for (const p of picked) {
      if (!isPdf(p.file.name) || p.file.size > MAX_FILE_BYTES) continue;
      void pdfMetadata(p.file).then(
        (m) => {
          const guessed = p.title;
          if (m.title) setFiles((cur) => cur.map((x) => (x.file === p.file && x.title === guessed ? { ...x, title: m.title } : x)));
          if (m.author) setFields((f) => (f.author ? f : { ...f, author: m.author }));
        },
        () => undefined,
      );
    }
  };
  // Files dropped onto the page arrive here already chosen.
  useEffect(() => {
    if (open && initial?.length) choose(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);
  const submit = async () => {
    const ok = files.filter((f) => f.file.size <= MAX_FILE_BYTES);
    if (!ok.length || progress !== null || ok.some((f) => !f.title.trim()) || (fields.newSeries !== undefined && !fields.newSeries.trim())) return;
    setError(null);
    let series = fields.series;
    let newSeries = fields.newSeries?.trim() || undefined;
    let i = 0;
    try {
      for (; i < ok.length; i++) {
        setProgress(i);
        const r = await uploadResource(ok[i]!.file, { ...fields, title: ok[i]!.title.trim(), series, newSeries });
        // The next parts join the series the first one made.
        if (newSeries) {
          series = r.series;
          newSeries = undefined;
        }
      }
      void refreshResources(qc);
      setProgress(null);
      reset();
      onClose();
    } catch (e) {
      void refreshResources(qc);
      setError(t.resourceUploadFailed(ok[Math.min(i, ok.length - 1)]!.file.name, e instanceof Error ? e.message : ''));
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t.uploadFiles} width="max-w-xl">
      <div className="space-y-4">
        <div>
          <input ref={input} type="file" multiple hidden onChange={(e) => choose(e.target.files)} />
          <Button onClick={() => input.current?.click()} disabled={progress !== null}>
            {t.resourceChooseFiles}
          </Button>
        </div>
        {files.length ? (
          <ul className="space-y-2">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  aria-label={t.resourceTitle}
                  value={f.title}
                  onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  className="h-9 min-w-0 flex-1 wb-field px-2.5 text-sm"
                />
                <span className="shrink-0 text-xs text-ink-3">{formatSize(f.file.size)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {files.length ? <Details fields={fields} set={(p) => setFields({ ...fields, ...p })} courses={courses} series={series} many={files.length > 1} /> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex items-center justify-end gap-2">
          {progress !== null ? <span className="mr-auto text-sm text-ink-2">{t.resourceUploading(progress + 1, files.length)}</span> : null}
          <Button variant="ghost" onClick={close} disabled={progress !== null}>
            {t.cancel}
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!files.length || progress !== null}>
            {t.resourceUpload}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function EditDialog({ resource, onClose, courses, series }: { resource: Resource | null; onClose: () => void; courses: Course[]; series: ResourceSeries[] }) {
  const t = useT();
  const qc = useQueryClient();
  return resource ? <EditForm key={resource.id} resource={resource} onClose={onClose} courses={courses} series={series} qc={qc} t={t} /> : null;
}

function EditForm({ resource, onClose, courses, series, qc, t }: { resource: Resource; onClose: () => void; courses: Course[]; series: ResourceSeries[]; qc: ReturnType<typeof useQueryClient>; t: ReturnType<typeof useT> }) {
  const [fields, setFields] = useState<ResourceFields>({ title: resource.title, type: resource.type, author: resource.author, date: resource.date, courses: resource.courses, labels: resource.labels, series: resource.series });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!fields.title.trim() || busy) return;
    setBusy(true);
    try {
      await updateResource(resource.id, { ...fields, title: fields.title.trim(), newSeries: fields.newSeries?.trim() || undefined });
      await refreshResources(qc);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.resourceEditTitle} width="max-w-xl">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t.resourceTitle}</span>
          <input autoFocus value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} className="h-9 w-full wb-field px-2.5" />
        </label>
        <Details fields={fields} set={(p) => setFields({ ...fields, ...p })} courses={courses} series={series} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !fields.title.trim()}>
            {t.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Says what goes before anything is removed. */
export function DeleteDialog({ resource, onClose }: { resource: Resource | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!resource) return null;
  const go = async () => {
    setBusy(true);
    try {
      await deleteResource(resource.id);
      await refreshResources(qc);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.resourceDeleteTitle(resource.title)}>
      <p className="text-sm text-ink-2">{t.resourceDeleteBody}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button variant="primary" onClick={() => void go()} disabled={busy}>
          {t.resourceDelete}
        </Button>
      </div>
    </Dialog>
  );
}
