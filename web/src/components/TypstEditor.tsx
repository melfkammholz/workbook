import { Columns2, PanelTop, Square } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Panel } from 'react-resizable-panels';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Diagnostic } from '@wb/shared';
import { previewNote, type NotePreview } from '@/lib/api';
import type { EditorVariant } from '@/lib/editor';
import { useT } from '@/lib/i18n';
import { readPref, writePref } from '@/lib/shell';
import { useMediaQuery } from '@/lib/useActiveTime';
import { CodeEditor } from './CodeEditor';
import { Prose } from './Prose';
import { IconButton, ResizeHandle, clsx } from './ui';

const LAYOUTS = ['stacked', 'side', 'write'] as const;
type Layout = (typeof LAYOUTS)[number];
const KEY = 'wb-typst-layout';

/**
 * A Typst source with a live preview, rendered by the server with the same
 * renderer as the exercises, so math and code look identical. It follows every
 * change (a render takes the server milliseconds) without ever blocking typing.
 * Used for notes and text answers.
 */
export function TypstEditor({
  value,
  onChange,
  label,
  placeholder,
  variant,
  status,
  render = previewNote,
  diagnostics,
  onView,
  previewHeader,
  previewClassName = 'prose-note',
  extensions,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
  variant: EditorVariant;
  /** Shown next to the layout buttons, e.g. "Saved". */
  status?: string;
  /** How the text is rendered. Notes by default. */
  render?: (source: string, width?: number) => Promise<NotePreview>;
  /** Marks in the text, besides Typst's errors (which show in the preview). */
  diagnostics?: Diagnostic[];
  onView?: (view: EditorView | null) => void;
  /** Before the preview, e.g. a summary of warnings. */
  previewHeader?: ReactNode;
  previewClassName?: string;
  /** More editor behaviour, read once when the editor is made. */
  extensions?: Extension;
}) {
  const t = useT();
  const [layout, setLayoutState] = useState<Layout>(() => readPref(KEY, LAYOUTS, 'stacked'));
  // The last render that compiled. It stays up while the text in between does not, like a half-typed `$…$`.
  const [preview, setPreview] = useState<NotePreview | null>(null);
  const [errors, setErrors] = useState<NotePreview['diagnostics']>([]);
  const [showErrors, setShowErrors] = useState(false);
  // Side by side does not fit a phone. The choice is kept for when there is room again.
  const roomy = useMediaQuery('(min-width: 900px)');
  const effective: Layout = layout === 'side' && !roomy ? 'stacked' : layout;

  const setLayout = (l: Layout) => {
    setLayoutState(l);
    writePref(KEY, l);
  };

  // Rendering takes the server a few milliseconds, so every change goes out at once.
  // Only one request is on its way at a time; what is typed meanwhile waits, and only the newest text.
  // The preview's width in Typst points. A picture fallback is laid out at it, so it is never scaled;
  // Typst's pictures are sized in em at 11pt, the preview's text is the em here.
  const paneRef = useRef<HTMLDivElement | null>(null);
  const width = useRef<number | undefined>(undefined);
  const [widthStep, setWidthStep] = useState(0);
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const style = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const em = parseFloat(getComputedStyle(el.querySelector('.prose-task') ?? el).fontSize) || 14.5;
      // In steps of 20pt: dragging a divider should not ask for a new picture at every pixel.
      const pt = Math.max(100, Math.floor(((inner * 11) / em) / 20) * 20);
      if (pt !== width.current) {
        width.current = pt;
        setWidthStep(pt);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // The pane is a new element whenever the layout changes.
  }, [effective]);

  const inFlight = useRef(false);
  const waiting = useRef<string | null>(null);
  const generation = useRef(0);
  const send = (v: string) => {
    inFlight.current = true;
    const mine = generation.current;
    render(v, width.current)
      .then(
        (p) => {
          if (mine !== generation.current) return;
          const errs = p.diagnostics.filter((d) => d.severity === 'error');
          setErrors(errs);
          if (!errs.length) setPreview(p);
        },
        () => undefined,
      )
      .finally(() => {
        inFlight.current = false;
        const next = waiting.current;
        waiting.current = null;
        if (next !== null) send(next);
      });
  };

  useEffect(() => {
    if (value.trim()) {
      if (inFlight.current) waiting.current = value;
      else send(value);
    } else {
      // Nothing to show: drop what is on its way.
      generation.current++;
      waiting.current = null;
      setPreview(null);
      setErrors([]);
    }
    // Also runs when the text is replaced from outside: a restored version, a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // A picture is laid out at the preview's width: a new width needs a new picture. Text reflows by itself.
  useEffect(() => {
    if (!preview?.asPicture || !value.trim()) return;
    if (inFlight.current) waiting.current = value;
    else send(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthStep]);

  // An answer that arrives after the editor is gone has nowhere to go.
  useEffect(
    () => () => {
      generation.current++;
      waiting.current = null;
    },
    [],
  );

  // Errors come and go while typing. They only show once they have stayed for a moment, or when there is nothing else to show.
  useEffect(() => {
    if (!errors.length) return setShowErrors(false);
    if (!preview) return setShowErrors(true);
    const timer = setTimeout(() => setShowErrors(true), 800);
    return () => clearTimeout(timer);
  }, [errors, preview]);

  const editor = (
    <CodeEditor variant={variant} language="typst" value={value} onChange={onChange} label={label} wrap lineNumbers={false} placeholder={placeholder} {...(diagnostics ? { diagnostics } : {})} {...(onView ? { onView } : {})} {...(extensions ? { extensions } : {})} />
  );
  const pane = (
    <div ref={paneRef} className="h-full min-h-0 overflow-y-auto bg-paper/40 p-4" aria-label={t.preview}>
      {showErrors && errors.length ? (
        <ul className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {errors.map((e, i) => (
            <li key={i}>
              {e.line ? t.lineN(e.line) : ''}
              {e.message}
            </li>
          ))}
        </ul>
      ) : null}
      {previewHeader}
      {preview ? (
        <Prose html={preview.html} css={preview.css} className={clsx(previewClassName, 'transition-opacity', showErrors && errors.length > 0 && 'opacity-60')} />
      ) : !errors.length ? (
        <p className="text-sm text-ink-3">{value.trim() ? t.rendering : t.previewHere}</p>
      ) : null}
    </div>
  );

  const OPTIONS: [Layout, typeof PanelTop, string][] = [
    ['stacked', PanelTop, t.layoutStacked],
    ['side', Columns2, t.layoutSide],
    ['write', Square, t.layoutWrite],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-sheet">
      <div className="flex items-center justify-end gap-2 border-b border-line px-2 py-0.5">
        <span className="mr-auto pl-1 text-xs text-ink-3" aria-live="polite">
          {status}
        </span>
        <div className="flex items-center" role="group" aria-label={t.preview}>
          {OPTIONS.filter(([l]) => l !== 'side' || roomy).map(([l, Icon, name]) => (
            <IconButton key={l} label={name} aria-pressed={effective === l} onClick={() => setLayout(l)} className={clsx('size-7', effective === l && 'bg-sunk text-ink')}>
              <Icon size={15} />
            </IconButton>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {effective === 'write' ? (
          editor
        ) : (
          <Group key={effective} orientation={effective === 'side' ? 'horizontal' : 'vertical'} className="h-full">
            <Panel defaultSize="50" minSize="15">
              {editor}
            </Panel>
            <ResizeHandle direction={effective === 'side' ? 'row' : 'column'} />
            <Panel defaultSize="50" minSize="15">
              {pane}
            </Panel>
          </Group>
        )}
      </div>
    </div>
  );
}
