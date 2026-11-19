import type { ReactNode } from 'react';
import type { WorkState } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { TagPicker } from './TagPicker';
import { Segmented } from './ui';

/** A label with its field, the layout of the add dialog's shared section. */
export function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-3 py-1.5 text-[13px]">
      <span className="pt-1.5 text-ink-2">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** "New" is the unsorted tray (no state). */
export function StateRow({ value, onChange }: { value: WorkState | null; onChange: (v: WorkState | null) => void }) {
  const t = useT();
  return (
    <Kv label={t.addState}>
      <Segmented<string>
        value={value ?? ''}
        options={[
          ['', t.addStateNew],
          ['later', t.workStateLater],
          ['read', t.workStateRead],
          ['know', t.workStateKnow],
        ]}
        onChange={(v) => onChange(v === '' ? null : (v as WorkState))}
      />
    </Kv>
  );
}

export function TagsRow({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  return (
    <Kv label={t.addTags}>
      <TagPicker value={value} onChange={onChange} size="sm" />
    </Kv>
  );
}
