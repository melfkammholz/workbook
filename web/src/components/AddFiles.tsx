import { RESOURCE_TYPES, normalizeDoi, normalizeTitle, workKeys, type LibraryWork, type ResourceSeries, type ResourceType, type ResourcesResponse, type WorkEdit, type WorkState } from '@wb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/api';
import { keepWorksSeparate, lookupWork, sortNewWorks, useWorks } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { isPdf, pdfMetadata } from '@/lib/pdf';
import { MAX_FILE_BYTES, formatSize, naturalCompare, refreshResources, titleFromFilename, uploadResource } from '@/lib/resources';
import { Kv, StateRow, TagsRow } from './AddShared';
import { Button, clsx } from './ui';

type Course = ResourcesResponse['courses'][number];
const NEW = '__new__';
const SLIDES = /\.(pptx?|odp|key)$|folien|slides|vorlesung|lecture/i;

interface FileRow {
  file: File;
  on: boolean;
  title: string;
  type: ResourceType;
  /** What was read from the PDF: shown as the row's note and used for the work of a paper. */
  found: { doi: string; author: string; fields: Partial<WorkEdit> | null } | null;
  /** The student's answer to "looks like X": the reference the file joins, or none. Unset: the default. */
  merge?: boolean;
}

/** The references of the library a paper row may be the same as (same DOI or title, or title and year), the sure ones first. */
function lookalikes(r: FileRow, works: LibraryWork[]): { work: LibraryWork; sure: boolean }[] {
  const doi = normalizeDoi(r.found?.doi ?? '');
  const title = normalizeTitle(r.title);
  const keys = workKeys({ title: r.title, year: r.found?.fields?.year ?? null, doi });
  return works.flatMap((w) => {
    const byDoi = !!doi && normalizeDoi(w.doi) === doi;
    const byTitle = title.length >= 8 && normalizeTitle(w.title) === title;
    if (!byDoi && !byTitle && !workKeys(w).some((k) => keys.includes(k))) return [];
    return [{ work: w, sure: byDoi || byTitle }];
  }).sort((x, y) => Number(y.sure) - Number(x.sure));
}

/** The guess: a PDF with a DOI is a paper, slides by their name, else notes. */
const guess = (name: string, doi: string): ResourceType => (doi ? 'paper' : SLIDES.test(name) ? 'slides' : 'notes');

/** "Looks like X in your library": merge (the file becomes the reference's file) or keep separate; a reference that has a file is only mentioned. */
function LooksLike({ row, onChoose }: { row: { work: LibraryWork; free: boolean; merge: boolean }; onChoose: (merge: boolean) => void }) {
  const t = useT();
  const btn = (on: boolean) => clsx('rounded px-1.5 py-px text-[12px]', on ? 'bg-accent text-white' : 'text-accent hover:underline');
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-accent-soft px-2 py-1 text-[12px] text-ink-2">
      <span className="min-w-0 break-words">{t.addLooksLike(row.work.title || row.work.authors)}</span>
      {row.free ? (
        <button type="button" aria-pressed={row.merge} onClick={() => onChoose(true)} className={btn(row.merge)}>
          {t.addMergeFile}
        </button>
      ) : (
        <span className="text-ink-3">{t.addHasFile}</span>
      )}
      <button type="button" aria-pressed={!row.merge} onClick={() => onChoose(false)} className={btn(!row.merge)}>
        {t.addKeepSeparate}
      </button>
    </span>
  );
}

/**
 * Files in the add dialog: a row per file (title and kind guessed), what they share once underneath. A paper also
 * becomes a work of the library, linked to its file, and gets the state.
 */
export function AddFiles({ files, courses, series, course, onBack, onClose }: { files: File[]; courses: Course[]; series: ResourceSeries[]; course: string | null; onBack: () => void; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const lookupOn = !!useSettings().data?.lookupReferences;
  const works = useWorks().data;
  const [rows, setRows] = useState<FileRow[]>(() =>
    [...files].sort((a, b) => naturalCompare(a.name, b.name)).map((file) => ({ file, on: file.size <= MAX_FILE_BYTES, title: titleFromFilename(file.name), type: guess(file.name, ''), found: null })),
  );
  const [inCourses, setInCourses] = useState<string[]>(course ? [course] : []);
  const [tags, setTags] = useState<string[]>([]);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [newSeries, setNewSeries] = useState<string | undefined>(undefined);
  const [state, setState] = useState<WorkState | null>(null);
  const [more, setMore] = useState(false);
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A PDF knows its title and author, and may print its DOI; that makes it a paper, with the details a lookup gives.
  useEffect(() => {
    let live = true;
    for (const r of rows) {
      if (!isPdf(r.file.name) || r.file.size > MAX_FILE_BYTES) continue;
      void pdfMetadata(r.file).then(
        async (m) => {
          const fields = m.doi && lookupOn ? await lookupWork(m.doi) : null;
          if (!live) return;
          setRows((cur) =>
            cur.map((x) => {
              if (x.file !== r.file) return x;
              const title = x.title === titleFromFilename(x.file.name) ? (fields?.title || m.title || x.title) : x.title;
              return { ...x, title, type: x.type === guess(x.file.name, '') ? guess(x.file.name, m.doi) : x.type, found: { doi: m.doi, author: m.author, fields } };
            }),
          );
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
    // The rows are made once from the files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** For a paper row: the reference it looks like (if any) and whether it joins it (a reference with a file is only mentioned). */
  const looks = (r: FileRow) => {
    const first = r.type === 'paper' && works ? lookalikes(r, works)[0] : undefined;
    if (!first) return null;
    const free = !first.work.resource;
    return { work: first.work, free, merge: free && (r.merge ?? first.sure) };
  };
  const chosen = rows.filter((r) => r.on);
  const papers = chosen.filter((r) => r.type === 'paper').length;
  const bad = chosen.some((r) => !r.title.trim()) || (newSeries !== undefined && !newSeries.trim());
  const patch = (i: number, p: Partial<FileRow>) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const submit = async () => {
    if (!chosen.length || bad || progress !== null) return;
    setError(null);
    let sid = seriesId;
    let fresh = newSeries?.trim() || undefined;
    let i = 0;
    try {
      for (; i < chosen.length; i++) {
        setProgress(i);
        const r = chosen[i]!;
        const f = r.found?.fields;
        const year = f?.year ?? (/^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
        const lk = looks(r);
        const choice = lk ? (lk.merge ? { into: lk.work.id } : { separate: true }) : {};
        const res = await uploadResource(r.file, { title: r.title.trim(), type: r.type, author: author || r.found?.author || '', date, courses: inCourses, labels: tags, series: sid, newSeries: fresh }, { doi: f?.doi || r.found?.doi || '', authors: f?.authors ?? '', year, venue: f?.venue ?? '', url: f?.url ?? '', ...choice });
        if (fresh) {
          sid = res.series;
          fresh = undefined;
        }
        // The server made or found the paper's reference; it gets the state and the tags.
        if (res.work) await sortNewWorks(qc, [res.work], state, tags);
        // Kept apart on purpose: the pair is not suggested again.
        if (res.work && lk && !lk.merge) await keepWorksSeparate(qc, res.work, lk.work.id);
      }
      void refreshResources(qc);
      onClose();
    } catch (e) {
      void refreshResources(qc);
      setError(t.resourceUploadFailed(chosen[Math.min(i, chosen.length - 1)]!.file.name, e instanceof Error ? e.message : ''));
      setProgress(null);
    }
  };

  const seriesValue = newSeries !== undefined ? NEW : (seriesId ?? '');
  const field = 'wb-field h-8 px-2 text-[13px] text-ink';
  return (
    <div className="space-y-3">
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-2">
            <input type="checkbox" className="wb-check mt-2" aria-label={r.file.name} checked={r.on} disabled={r.file.size > MAX_FILE_BYTES} onChange={(e) => patch(i, { on: e.target.checked })} />
            <div className="min-w-0 flex-1">
              <input aria-label={t.resourceTitle} value={r.title} onChange={(e) => patch(i, { title: e.target.value })} className={clsx(field, 'w-full', !r.on && 'text-ink-3')} />
              <small className={clsx('mt-0.5 block text-[12px]', r.found?.doi ? 'text-done' : 'text-ink-3')}>
                {r.file.size > MAX_FILE_BYTES ? t.resourceTooLarge : r.found?.doi ? (r.found.fields ? t.addDoiTaken : t.addDoiFound) : t.addFromName}
              </small>
              {r.on && looks(r) ? <LooksLike row={looks(r)!} onChoose={(merge) => patch(i, { merge })} /> : null}
            </div>
            <select aria-label={t.resourceType} value={r.type} onChange={(e) => patch(i, { type: e.target.value as ResourceType })} className={clsx(field, 'w-28 shrink-0')}>
              {RESOURCE_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t.resourceTypes[x]}
                </option>
              ))}
            </select>
            <span className="w-16 shrink-0 pt-2 text-right text-[12px] text-ink-3">{formatSize(r.file.size)}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-line pt-2">
        {courses.length ? (
          <Kv label={t.addWorkbooks}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5">
              {courses.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5">
                  <input type="checkbox" className="wb-check" checked={inCourses.includes(c.id)} onChange={(e) => setInCourses(e.target.checked ? [...inCourses, c.id] : inCourses.filter((x) => x !== c.id))} />
                  {c.title}
                </label>
              ))}
            </div>
          </Kv>
        ) : null}
        {papers ? <StateRow value={state} onChange={setState} /> : null}
        <TagsRow value={tags} onChange={setTags} />
        <Kv label={t.resourceSeries}>
          <select
            value={seriesValue}
            onChange={(e) => (e.target.value === NEW ? (setSeriesId(null), setNewSeries('')) : (setSeriesId(e.target.value || null), setNewSeries(undefined)))}
            className={clsx(field, 'w-60')}
          >
            <option value="">{t.resourceNoSeries}</option>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
            <option value={NEW}>{t.resourceNewSeries}</option>
          </select>
          {newSeries !== undefined ? <input autoFocus value={newSeries} onChange={(e) => setNewSeries(e.target.value)} placeholder={t.resourceSeriesTitle} className={clsx(field, 'ml-2 w-52')} /> : null}
          {chosen.length > 1 && seriesValue ? <span className="mt-1 block text-[12px] text-ink-3">{t.resourceSeriesOrder}</span> : null}
        </Kv>
        {more ? (
          <>
            <Kv label={t.resourceAuthor}>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} className={clsx(field, 'w-full')} />
            </Kv>
            <Kv label={t.resourceDate}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </Kv>
          </>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="ml-[7.25rem] text-[13px] font-medium text-accent hover:underline">
            {t.addMore}
          </button>
        )}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex items-center gap-2 pt-1">
        <span className="mr-auto text-[12px] text-ink-3">{progress !== null ? t.resourceUploading(progress + 1, chosen.length) : papers < chosen.length ? t.addStateNote : ''}</span>
        <Button variant="ghost" onClick={onBack} disabled={progress !== null}>
          {t.addBack}
        </Button>
        <Button variant="primary" disabled={!chosen.length || bad || progress !== null} onClick={() => void submit()}>
          {t.addCount(chosen.length)}
        </Button>
      </div>
    </div>
  );
}
