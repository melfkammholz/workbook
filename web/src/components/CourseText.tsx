import { MessageCircle } from 'lucide-react';
import { useDoc } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Prose } from './Prose';
import { Spinner } from './ui';

/** A text the author wrote that is not an exercise: landing page, chapter introduction, adventure page. */
export function CourseText({ url }: { url: string }) {
  const t = useT();
  const doc = useDoc(url);
  if (doc.isPending) return <Spinner />;
  if (!doc.data) return null;
  const errors = doc.data.diagnostics.filter((d) => d.severity === 'error');
  return (
    <>
      {errors.length ? (
        <div className="mb-6 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          <p className="font-medium">{t.typstErrors}</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>
                {e.line ? t.lineN(e.line) : ''}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Prose html={doc.data.task} css={doc.data.css} />
      {doc.data.remarks.length ? (
        <div className="mt-6 space-y-3">
          {doc.data.remarks.map((r, i) => (
            <aside key={i} className="flex gap-3 rounded-lg border border-line bg-sheet p-4">
              <MessageCircle size={17} className="mt-1 shrink-0 text-accent" aria-label={t.remark} />
              <Prose html={r} className="prose-note min-w-0 flex-1 text-[15.5px]" />
            </aside>
          ))}
        </div>
      ) : null}
    </>
  );
}
