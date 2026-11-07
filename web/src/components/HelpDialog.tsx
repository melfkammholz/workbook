import { useT } from '@/lib/i18n';
import { Legend } from './Legend';
import { Dialog } from './ui';

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const sections: [string, string][] = [
    [t.helpWorkingTitle, t.helpWorking],
    [t.helpInterpreterTitle, t.helpInterpreter],
    [t.helpReviewTitle, t.helpReview],
    [t.helpFocusTitle, t.helpFocus],
    [t.helpTimerTitle, t.helpTimer],
    [t.helpAiTitle, t.helpAi],
  ];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.help} description={t.helpIntro} width="max-w-2xl">
      <div className="space-y-5 text-sm">
        <Legend />

        {sections.map(([title, body]) => (
          <section key={title}>
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-ink-2">{body}</p>
          </section>
        ))}

        <section>
          <h3 className="font-semibold">{t.helpTypstTitle}</h3>
          <p className="mt-1 text-ink-2">{t.helpTypst}</p>
          <dl className="mt-2 divide-y divide-line rounded-lg border border-line">
            {t.helpTypstRows.map(([what, how]) => (
              <div key={what} className="grid gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-[11rem_1fr]">
                <dt className="text-ink-2">{what}</dt>
                <dd className="overflow-x-auto">
                  <pre className="font-mono text-[12.5px]">{how}</pre>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="font-semibold">{t.helpKeysTitle}</h3>
          <dl className="mt-2 space-y-1">
            {t.helpKeys.map(([key, what]) => (
              <div key={key} className="flex flex-wrap items-baseline gap-x-3">
                <dt>
                  <kbd className="rounded border border-line bg-paper px-1.5 py-0.5 font-sans text-xs">{key}</kbd>
                </dt>
                <dd className="text-ink-2">{what}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="font-semibold">{t.helpDataTitle}</h3>
          <p className="mt-1 text-ink-2">{t.helpData}</p>
        </section>
      </div>
    </Dialog>
  );
}
