import clsx from 'clsx';
import { useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** The student's labels as toggle chips; `value` holds label ids. */
export function LabelPicker({ value, onChange, size = 'md' }: { value: string[]; onChange: (v: string[]) => void; size?: 'sm' | 'md' }) {
  const t = useT();
  const labels = useSettings().data?.highlightLabels ?? [];
  if (!labels.length) return <p className="text-[13px] text-ink-2">{t.resourceLabelsNone}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((l) => {
        const on = value.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}
            className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5', size === 'sm' ? 'py-0 text-[12px]' : 'py-0.5 text-[13px]', on ? 'border-accent bg-accent-soft font-medium text-ink' : 'border-line text-ink-2 hover:bg-sunk')}
          >
            <span className="size-2 rounded-full" style={{ background: l.color }} />
            {l.name}
          </button>
        );
      })}
    </div>
  );
}
