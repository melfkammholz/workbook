import { MIN_CONFIDENCE, type SimilarWork, type Work } from '@wb/shared';
import { Link2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { keepWorksSeparate, linkWork, mergeWork } from '@/lib/bibliography';
import { useT } from '@/lib/i18n';
import { useResources } from '@/lib/resources';
import { useQueryClient } from '@tanstack/react-query';

/** Whether the fields read from a reference's text can be shown; if not, the raw text is. */
export const sure = (w: Pick<Work, 'confidence' | 'title'>) => !!w.title && w.confidence >= MIN_CONFIDENCE;

/** "Looks like X in your library": the student says it is the same work (merge) or not (kept separate). */
export function SimilarWorks({ work, similar }: { work: Work; similar: SimilarWork[] }) {
  const t = useT();
  const qc = useQueryClient();
  if (similar.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {similar.map((s) => (
        <li key={s.id} className="rounded-md bg-accent-soft px-2 py-1 text-[12px]">
          <span className="block break-words">{t.workLooksLike(s.title || s.authors, s.year, s.cited)}</span>
          <span className="mt-0.5 flex gap-2">
            <button type="button" onClick={() => void mergeWork(qc, s.id, work.id)} className="font-medium text-accent hover:underline">
              {t.workMerge}
            </button>
            <button type="button" onClick={() => void keepWorksSeparate(qc, work.id, s.id)} className="text-ink-2 hover:underline">
              {t.workKeepSeparate}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "I have this": which material of the student's is the work; following the link opens that PDF. */
export function WorkHave({ work, except }: { work: Work; except?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const resources = useResources(null).data?.resources;
  const [picking, setPicking] = useState(false);
  const linked = work.resource ? resources?.find((r) => r.id === work.resource) : undefined;
  if (work.resource) {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-2">
        <span>{t.workHave}</span>
        {linked ? (
          <Link href={`/resources/${encodeURIComponent(linked.id)}`} className="min-w-0 truncate font-medium text-accent hover:underline">
            {linked.title}
          </Link>
        ) : null}
        <button type="button" aria-label={t.workUnlink} data-tip={t.workUnlink} onClick={() => void linkWork(qc, work.id, null)} className="rounded p-0.5 text-ink-3 hover:bg-sunk hover:text-ink">
          <Unlink size={12} />
        </button>
      </p>
    );
  }
  if (!picking) {
    return (
      <button type="button" onClick={() => setPicking(true)} className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink hover:underline">
        <Link2 size={12} /> {t.workIHaveThis}
      </button>
    );
  }
  return (
    <select
      autoFocus
      aria-label={t.workPick}
      defaultValue=""
      onBlur={() => setPicking(false)}
      onKeyDown={(e) => e.key === 'Escape' && setPicking(false)}
      onChange={(e) => {
        if (e.target.value) void linkWork(qc, work.id, e.target.value);
        setPicking(false);
      }}
      className="wb-field mt-0.5 w-full max-w-full py-0.5 text-[12px]"
    >
      <option value="" disabled>
        {t.workPick}
      </option>
      {(resources ?? [])
        .filter((r) => r.id !== except)
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
    </select>
  );
}
