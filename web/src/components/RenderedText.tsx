import { useQuery } from '@tanstack/react-query';
import { previewNote } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { CodeBlock } from './Dialogs';
import { Prose } from './Prose';
import { Spinner, clsx } from './ui';

/** Typst source as the reader will see it. If it does not compile, the source is still worth showing. */
export function RenderedText({ source, full }: { source: string; /** All of it, however long. */ full?: boolean }) {
  const t = useT();
  const preview = useQuery({ queryKey: ['rendered-text', source], queryFn: () => previewNote(source), staleTime: Infinity });
  if (preview.isPending) return <Spinner />;
  if (!preview.data || preview.data.diagnostics.some((d) => d.severity === 'error')) {
    return (
      <>
        <p className="mb-1 text-[13px] text-ink-3">{t.notRendered}</p>
        <CodeBlock code={source} language={null} className={clsx('whitespace-pre-wrap', !full && 'max-h-60')} />
      </>
    );
  }
  return (
    <div className={clsx('rounded-md border border-line bg-paper px-4 py-3', !full && 'max-h-96 overflow-y-auto')}>
      <Prose html={preview.data.html} css={preview.data.css} className="prose-note text-[15px]" />
    </div>
  );
}
