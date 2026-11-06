import { CircleAlert, CircleCheck, CircleDashed, CircleStop, CircleX, Play, TimerOff } from 'lucide-react';
import type { CheckResult, CheckRun } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { ExplainError } from './ExplainError';
import { Button, Empty, IconButton, Spinner, clsx } from './ui';

/** The test harnesses (Workbook.Check, workbook_check.pl) start this message with these words. */
const NOT_IMPLEMENTED = 'not implemented yet';

export function TestsPanel({
  run,
  running,
  error,
  onRun,
  onStop,
  firstRun,
  banner,
}: {
  run: CheckRun | null;
  running: boolean;
  error: string | null;
  onRun: () => void;
  onStop: () => void;
  firstRun: boolean;
  banner?: React.ReactNode;
}) {
  const t = useT();
  const results = run?.results ?? [];
  const passed = results.filter((r) => r.status === 'pass').length;
  const pending = results.filter((r) => r.message.startsWith(NOT_IMPLEMENTED)).length;
  const allPass = run?.compiled && !run.stopped && results.length > 0 && passed === results.length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-sheet">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0 text-sm">
          {running ? (
            <span className="inline-flex items-center gap-2 text-ink-2">
              <Spinner /> {t.runningTests}
            </span>
          ) : run ? (
            run.stopped ? (
              <span className="font-medium text-ink">
                {t.testsStopped}
                {results.length > 0 ? <span className="ml-2 font-normal text-ink-3">{t.nOfMTestsPass(passed, results.length)}</span> : null}
              </span>
            ) : run.compiled && results.length > 0 ? (
              <span className={clsx('font-medium', allPass ? 'text-done' : 'text-ink')}>
                {allPass ? t.allTestsPass : t.nOfMTestsPass(passed, results.length)}
                {pending > 0 && !allPass ? <span className="ml-2 font-normal text-ink-3">{t.nNotImplemented(pending)}</span> : null}
              </span>
            ) : (
              <span className="font-medium text-danger">{run.runnerError ? t.testsCouldNotRun : t.codeDoesNotCompile}</span>
            )
          ) : (
            <span className="text-ink-2">{t.runWhenYouWant}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allPass ? banner : null}
          <IconButton label={t.stopTests} onClick={onStop} disabled={!running}>
            <CircleStop size={16} />
          </IconButton>
          <Button variant={allPass && banner ? 'secondary' : 'primary'} size="sm" onClick={onRun} disabled={running}>
            <Play size={13} /> {firstRun ? t.runTests : t.runAgain}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
        {!run && !error && !running ? <Empty title={t.noTestsYet}>{t.testsUseSaved}</Empty> : null}

        {run && !run.compiled ? (
          <div className="p-4">
            {run.runnerError ? <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{run.runnerError}</p> : null}
            {run.diagnostics
              .filter((d) => d.severity === 'error')
              .map((d, i) => (
                <div key={i} className="mb-2 rounded-md bg-sunk p-3">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px] text-ink">
                  <span className="text-danger">
                    {d.file}:{d.line}:{d.column}
                  </span>
                  {'\n'}
                  {d.message}
                </pre>
                <ExplainError code={d.code} />
                </div>
              ))}
          </div>
        ) : null}

        {run?.compiled ? (
          <ul className="divide-y divide-line">
            {results.map((r, i) => (
              <ResultRow key={i} r={r} />
            ))}
          </ul>
        ) : null}

        {run?.compiled && run.runnerError ? <p className="m-4 whitespace-pre-wrap rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{run.runnerError}</p> : null}
        {run?.stdout.trim() ? (
          <details className="border-t border-line px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-ink-2">{t.outputFromCode}</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px] text-ink-2">{run.stdout}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function ResultRow({ r }: { r: CheckResult }) {
  const t = useT();
  const notImpl = r.message.startsWith(NOT_IMPLEMENTED);
  const message = notImpl ? t.notImplementedYet + r.message.slice(NOT_IMPLEMENTED.length) : r.message;
  const Icon = r.status === 'pass' ? CircleCheck : notImpl ? CircleDashed : r.status === 'timeout' ? TimerOff : r.status === 'fail' ? CircleX : CircleAlert;
  const tone = r.status === 'pass' ? 'text-done' : notImpl ? 'text-ink-3' : r.status === 'fail' ? 'text-danger' : 'text-review';
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={clsx('mt-[3px] shrink-0', tone)} aria-label={t.testStatus[r.status] ?? r.status} />
        <div className="min-w-0 flex-1">
          <p className={clsx('text-sm', r.status === 'pass' ? 'text-ink-2' : 'font-medium text-ink')}>{r.name}</p>
          {r.status !== 'pass' && message ? <pre className={clsx('mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-sunk p-2.5 font-mono text-[12.5px] leading-relaxed', notImpl ? 'text-ink-3' : 'text-ink')}>{message}</pre> : null}
        </div>
      </div>
    </li>
  );
}
