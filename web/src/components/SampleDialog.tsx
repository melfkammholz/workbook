import { useT } from '@/lib/i18n';
import { Prose } from './Prose';
import { RenderedText } from './RenderedText';
import { Dialog } from './ui';

/** The author's sample answer, next to what the student wrote. */
export function SampleDialog({ open, onClose, sample, mine }: { open: boolean; onClose: () => void; sample: { samples: string[]; css: string } | null; /** Null for code, which has its own compare view. */ mine: string | null }) {
  const t = useT();
  const side = mine !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.sampleTitle} description={t.sampleNote} width={side ? 'max-w-5xl' : 'max-w-2xl'}>
      <div className={side ? 'grid gap-4 md:grid-cols-2' : ''}>
        {side ? (
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold text-ink-2">{t.sampleYours}</p>
            {mine.trim() ? <RenderedText source={mine} /> : <p className="text-sm text-ink-3">{t.sampleEmpty}</p>}
          </div>
        ) : null}
        <div className="min-w-0">
          {side ? <p className="mb-1 text-xs font-semibold text-ink-2">{t.sampleTitle}</p> : null}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-md border border-line bg-paper px-4 py-3">
            {sample?.samples.map((html, i) => <Prose key={i} html={html} css={sample.css} className="prose-note text-[15px]" />)}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
