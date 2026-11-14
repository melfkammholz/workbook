import { useState } from 'react';
import { api, assistantKey, keys, useAssistant, useSaveSettings, useSettings } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { useT } from '@/lib/i18n';
import { Button, Dialog, clsx } from './ui';

/** One command with a copy button. */
function Command({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <pre className="wb-field overflow-x-auto px-3 py-2 text-xs">{text}</pre>
      <Button
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? t.bridgeCopied : t.skillsCopy}
      </Button>
    </div>
  );
}

/**
 * Connecting Claude Code from the questions page: turns the assistant requests on, makes the helper key, and shows what
 * to run on this computer, with a live "connected" dot. The same controls live in the settings.
 */
export function ConnectAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const settings = useSettings().data;
  const save = useSaveSettings();
  const on = !!(settings?.assistantBridge && settings.assistantRequests);
  const helper = useAssistant(open && on).data;
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = window.location.origin;
  const newKey = async () => {
    setBusy(true);
    try {
      setKey((await api.post<{ key: string }>('/api/assistant/key', {})).key);
      await queryClient.invalidateQueries({ queryKey: assistantKey });
    } finally {
      setBusy(false);
    }
  };
  const setUp = async () => {
    setBusy(true);
    try {
      await save.mutateAsync({ assistantBridge: true, assistantRequests: true });
      if (!settings?.bridgeToken) queryClient.setQueryData(keys.settings, await api.post('/api/bridge/token', {}));
      setKey((await api.post<{ key: string }>('/api/assistant/key', {})).key);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.connectTitle} width="max-w-xl">
      <p className="text-[13.5px] text-ink-2">{t.connectIntro}</p>
      {on ? (
        <div className="mt-4 space-y-4 text-[13.5px]">
          <p role="status" className="flex items-center gap-2">
            <span aria-hidden className={clsx('inline-block size-2 rounded-full', helper?.connected ? 'bg-done' : 'border border-ink-3')} />
            <b className="font-medium">{helper?.connected ? t.helperConnected : t.helperNotConnected}</b>
          </p>
          {key ? (
            <>
              <div className="space-y-1.5">
                <p className="font-medium">{t.connectStepSkills}</p>
                <Command text={`curl -fsS ${origin}/skills/install.sh | sh`} />
              </div>
              <div className="space-y-1.5">
                <p className="font-medium">{t.connectStepHelper}</p>
                <p className="text-[13px] text-ink-2">{t.helperRun}</p>
                <Command text={`curl -fsS ${origin}/helper/workbook-helper.mjs -o workbook-helper.mjs && WORKBOOK_HELPER_KEY=${key} node workbook-helper.mjs`} />
                <p className="text-[12.5px] text-ink-3">{t.connectKeyOnce}</p>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void newKey()} disabled={busy}>
                {t.helperKeyNewer}
              </Button>
              <span className="text-xs text-ink-3">{t.helperKeyBody}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <Button variant="primary" onClick={() => void setUp()} disabled={busy}>
            {t.connectSetUp}
          </Button>
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </div>
    </Dialog>
  );
}
