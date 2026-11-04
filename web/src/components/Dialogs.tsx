import { useEffect, useMemo, useState } from 'react';
import type { AnswerVersion } from '@wb/shared';
import { fetchVersions } from '@/lib/api';
import { highlightToHtml } from '@/lib/highlight';
import { commonLines } from '@/lib/diff';
import { useLang, useT } from '@/lib/i18n';
import { RenderedText } from './RenderedText';
import { Button, Dialog, Empty, Segmented, Spinner, clsx } from './ui';

export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} width="max-w-md">
      <div className="text-sm text-ink-2">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export function CodeBlock({ code, language, className }: { code: string; language: string | null; className?: string }) {
  const html = language ? highlightToHtml(code, language) : null;
  return (
    <pre className={clsx('overflow-auto rounded-md border border-line bg-sunk p-3 font-mono text-[12.5px] leading-relaxed', className)}>
      {html !== null ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
    </pre>
  );
}

function CompareColumn({ title, code, language, shared, mark }: { title: string; code: string; language: string; shared: boolean[] | null; mark: string }) {
  const lines = code.split('\n');
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-ink-2">{title}</p>
      <pre className="max-h-[55vh] overflow-auto rounded-md border border-line bg-sunk py-2 font-mono text-[12.5px] leading-relaxed">
        <code className="block w-max min-w-full">
          {lines.map((line, i) => {
            const different = shared !== null && !shared[i];
            const html = highlightToHtml(line, language);
            return (
              <span key={i} className={clsx('flex pr-3', different && 'bg-review-soft')}>
                <span aria-hidden className="w-5 shrink-0 select-none text-center text-ink-3">{different ? mark : ''}</span>
                {html !== null ? <span dangerouslySetInnerHTML={{ __html: html || ' ' }} /> : <span>{line || ' '}</span>}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

function CompareFile({ path, solution, mine, language, partial }: { path: string; solution: string; mine: string; language: string; partial: boolean }) {
  const t = useT();
  const common = useMemo(() => commonLines(mine, solution), [mine, solution]);
  const same = common && common.a.every(Boolean) && common.b.every(Boolean);
  return (
    <div className="mb-4">
      <p className="mb-1 font-mono text-xs text-ink-3">{path}</p>
      {same ? <p className="mb-2 text-sm font-medium text-done">{t.compareSame}</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {/* With only part of a shared file on the right, everything else on the left is not a difference. */}
        <CompareColumn title={t.compareMine} code={mine} language={language} shared={partial ? null : (common?.a ?? null)} mark="−" />
        <CompareColumn title={t.compareSolution} code={solution} language={language} shared={common?.b ?? null} mark="+" />
      </div>
    </div>
  );
}

export function SolutionDialog({
  open,
  onClose,
  files,
  mine,
  partial,
  language,
}: {
  open: boolean;
  onClose: () => void;
  files: Record<string, string> | null;
  mine: Record<string, string>;
  /** The solution is only the part the author assigned to this exercise. */
  partial: boolean;
  language: string;
}) {
  const t = useT();
  const [view, setView] = useState<'solution' | 'compare'>('solution');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.referenceSolution} description={t.solutionNote} width={view === 'compare' ? 'max-w-5xl' : 'max-w-2xl'}>
      {files ? (
        <>
          <div className="mb-3">
            <Segmented
              value={view}
              options={[
                ['solution', t.viewSolution],
                ['compare', t.viewCompare],
              ]}
              onChange={setView}
            />
          </div>
          {view === 'compare' ? <p className="mb-3 text-[13px] text-ink-2">{partial ? t.compareNotePartial : t.compareNote}</p> : null}
          {Object.entries(files).map(([path, code]) =>
            view === 'compare' ? (
              <CompareFile key={path} path={path} solution={code} mine={mine[path] ?? ''} language={language} partial={partial} />
            ) : (
              <div key={path} className="mb-3">
                <p className="mb-1 font-mono text-xs text-ink-3">{path}</p>
                <CodeBlock code={code} language={language} className="max-h-[50vh]" />
              </div>
            ),
          )}
        </>
      ) : (
        <Spinner />
      )}
    </Dialog>
  );
}

/** What was set aside before trying again, next to what came out of trying. */
export function AttemptDialog({ open, onClose, earlier, now, language }: { open: boolean; onClose: () => void; earlier: string; now: string; language: string | null }) {
  const t = useT();
  const common = useMemo(() => (language ? commonLines(earlier, now) : null), [earlier, now, language]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.compareAttempt} description={t.compareAttemptNote} width="max-w-5xl">
      {language ? (
        <div className="grid gap-3 md:grid-cols-2">
          <CompareColumn title={t.attemptEarlier} code={earlier} language={language} shared={common?.a ?? null} mark="−" />
          <CompareColumn title={t.attemptNow} code={now} language={language} shared={common?.b ?? null} mark="+" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold text-ink-2">{t.attemptEarlier}</p>
            <RenderedText source={earlier} />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold text-ink-2">{t.attemptNow}</p>
            {now.trim() ? <RenderedText source={now} /> : <p className="text-sm text-ink-3">{t.sampleEmpty}</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function HistoryDialog({
  open,
  onClose,
  id,
  slot,
  language,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
  slot: string;
  language: string | null;
  onRestore: (content: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [versions, setVersions] = useState<AnswerVersion[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    setSelected(null);
    void fetchVersions(id, slot).then((v) => {
      const list = [...v].sort((a, b) => b.createdAt - a.createdAt);
      setVersions(list);
      setSelected(list[0]?.id ?? null);
    });
  }, [open, id, slot]);

  const current = versions?.find((v) => v.id === selected);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.earlierVersions} description={t.versionsNote} width="max-w-3xl">
      {!versions ? (
        <Spinner />
      ) : versions.length === 0 ? (
        <Empty title={t.noVersions}>{t.noVersionsBody}</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[13rem_1fr]">
          <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSelected(v.id)}
                  className={clsx('w-full rounded-md px-2.5 py-1.5 text-left text-sm', v.id === selected ? 'bg-accent-soft text-accent' : 'hover:bg-sunk')}
                >
                  <span className="block font-medium">{new Date(v.createdAt).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span className="block text-xs text-ink-3">{t.versionReason[v.reason] ?? v.reason}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            {current ? <CodeBlock code={current.content} language={language} className="max-h-[50vh]" /> : null}
            <div className="mt-3 flex justify-end">
              <Button
                variant="primary"
                disabled={!current}
                onClick={() => {
                  if (current) onRestore(current.content);
                  onClose();
                }}
              >
                {t.restoreVersion}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
