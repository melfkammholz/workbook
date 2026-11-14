import { assistantAction, useAssistant } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button } from './ui';

/**
 * What the helper is doing for the student: one thin line per request that waits or runs (with cancel), and a card for
 * a request that failed (try again or dismiss). A request that went well shows nothing here: its proposals are on the
 * questions. No counts of what is left.
 */
export function AssistantStrip({ enabled }: { enabled: boolean }) {
  const t = useT();
  const status = useAssistant(enabled).data;
  const live = status?.requests.filter((r) => r.status === 'queued' || r.status === 'running') ?? [];
  const failed = status?.requests.filter((r) => r.status === 'failed') ?? [];
  if (!live.length && !failed.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {live.map((r) => (
        <div key={r.id} role="status" className="flex items-center gap-2.5 rounded-lg bg-accent-soft px-3 py-1.5 text-[13.5px]">
          <span aria-hidden className={r.status === 'running' ? 'size-2 animate-pulse rounded-full bg-accent' : 'size-2 rounded-full border border-accent'} />
          <span className="min-w-0 flex-1 truncate">
            <b className="font-medium">{t.reqKinds[r.kind]}</b> <span className="text-ink-3">{r.status === 'running' ? t.reqReading : status?.connected ? t.reqWaiting : t.reqWaitingNoHelper}</span>
          </span>
          <button type="button" onClick={() => void assistantAction(r.id, 'cancel')} className="text-[13px] text-accent hover:underline">
            {t.reqCancel}
          </button>
        </div>
      ))}
      {failed.map((r) => (
        <div key={r.id} role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13.5px]">
          <p className="font-medium text-danger">{t.reqFailed(t.reqKinds[r.kind] ?? r.kind)}</p>
          <p className="mt-0.5 break-words text-[12.5px] text-ink-2">{r.logTail.split('\n').find((l) => l.trim()) ?? t.reqFailedNoLog}</p>
          <div className="mt-1.5 flex gap-2">
            <Button size="sm" onClick={() => void assistantAction(r.id, 'retry')}>
              {t.reqRetry}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void assistantAction(r.id, 'dismiss')}>
              {t.reqDismiss}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
