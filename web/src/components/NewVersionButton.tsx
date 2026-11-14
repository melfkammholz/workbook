import { useQueryClient } from '@tanstack/react-query';
import type { Resource } from '@wb/shared';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { placeStale, uploadVersion } from '@/lib/pdfVersions';
import { MAX_FILE_BYTES, refreshResources } from '@/lib/resources';
import { Button, IconButton } from './ui';

/**
 * Replaces a resource's file with a new version; highlights and page notes are placed on it right after.
 * `node` (the hidden file field and an error line) must stay mounted while the student chooses, so it cannot live in a menu.
 */
export function useNewVersion(resource: Resource) {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (file: File) => {
    setError('');
    if (file.size > MAX_FILE_BYTES) return setError(t.resourceTooLarge);
    setBusy(true);
    try {
      const next = await uploadVersion(resource.id, file);
      await refreshResources(qc);
      await placeStale(qc, next).catch(() => undefined);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t.resourceNewVersionSame : t.resourceNewVersionFailed);
    } finally {
      setBusy(false);
    }
  };

  const node = (
    <>
      <input ref={input} type="file" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) void pick(f);
      }} />
      {error ? <span role="alert" className="mt-1 block text-[12px] text-review">{error}</span> : null}
    </>
  );
  return { node, busy, choose: () => input.current?.click() };
}

/** The same as a button, for places outside a menu. */
export function NewVersionButton({ resource, icon, className }: { resource: Resource; icon?: boolean; className?: string }) {
  const t = useT();
  const { node, busy, choose } = useNewVersion(resource);
  return (
    <span className={className}>
      {node}
      {icon ? (
        <IconButton label={t.resourceNewVersion} disabled={busy} onClick={choose}>
          <Upload size={16} />
        </IconButton>
      ) : (
        <Button size="sm" disabled={busy} onClick={choose} title={t.resourceNewVersionTip}>
          <Upload size={14} />
          {busy ? t.resourceNewVersionBusy : t.resourceNewVersion}
        </Button>
      )}
    </span>
  );
}
