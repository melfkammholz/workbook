import { Separator } from 'react-resizable-panels';
import { clsx } from './ui';

// Not in `ui.tsx`: react-resizable-panels is only needed by the pages that split into panels.
/**
 * Between two panels: a line, or with `gutter` the gap between two cards on warm paper (a line without it), which shows
 * a grip only while hovered or dragged.
 */
export function ResizeHandle({ direction, disabled, gutter }: { direction: 'row' | 'column'; disabled?: boolean; gutter?: boolean }) {
  return (
    <Separator
      disabled={disabled}
      className={clsx('relative shrink-0 bg-line transition-colors', !disabled && 'hover:bg-accent data-[separator=active]:bg-accent', direction === 'row' ? 'w-px' : 'h-px', gutter && 'wb-gutter', gutter && direction === 'column' && 'wb-gutter-col', gutter && disabled && 'wb-gutter-off')}
    >
      <span className={clsx('absolute', direction === 'row' ? 'inset-y-0 -inset-x-1.5' : 'inset-x-0 -inset-y-1.5')} />
    </Separator>
  );
}
