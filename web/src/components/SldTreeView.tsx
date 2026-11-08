import { Download, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { layoutSld, sldAtLine, type Diagnostic, type SldBox, type SldEdge, type SldMetrics, type SldTree } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { IconButton, clsx } from './ui';

const FONT_SIZE = 12.5;
const LINE = 18;
const PAD_X = 10;
const PAD_Y = 6;
const LABEL_PAD = 4;
const MARGIN = 24;
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
/** A tree that does not fit is shown at least this large, so that its text stays readable, and the rest is a pan away. */
const LEAST_FIT = 0.5;

interface Props {
  /** Undefined: sldcheck cannot print trees. Null: there is none to show. */
  tree: SldTree | null | undefined;
  /** The text has a syntax error, so this is the last tree that could be read. */
  stale: boolean;
  /** What the tests found, for the text as it is now. */
  problems: Diagnostic[];
  /** The line of the editor's cursor. */
  cursorLine: number;
  onSelectLine: (line: number) => void;
}

interface View {
  x: number;
  y: number;
  k: number;
}

/**
 * An SLD tree, drawn from what sldcheck read: goals as boxes, steps as edges with the renamed rule and the
 * substitution, pruned alternatives and failures as dashed stubs. It shows what is written, wrong or not. Drag to
 * pan, scroll to pan, Ctrl+scroll or the buttons to zoom. What the cursor is at is marked, a click goes to the line,
 * and what the tests found is marked red or amber.
 */
export function SldTreeView({ tree, stale, problems, cursorLine, onSelectLine }: Props) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const probe = useRef<SVGTextElement>(null);
  const [measure, setMeasure] = useState<((text: string) => number) | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  // Until the person moves the picture, it follows the window and the tree.
  const following = useRef(true);

  // The width of text as the browser draws it, once the fonts are there.
  useEffect(() => {
    const make = () => {
      const el = probe.current;
      const ctx = document.createElement('canvas').getContext('2d');
      if (!el || !ctx) return;
      const cs = getComputedStyle(el);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      setMeasure(() => (text: string) => ctx.measureText(text).width);
    };
    make();
    void document.fonts?.ready.then(make);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!tree || !measure || (!tree.tree && tree.negations.length === 0)) return null;
    const metrics: SldMetrics = { measure, lineHeight: LINE, padX: PAD_X, padY: PAD_Y, gapX: 26, minGapY: 44, labelPad: LABEL_PAD, maxChars: 46, labelChars: 32 };
    return layoutSld(tree, metrics);
  }, [tree, measure]);

  const fit = useCallback(() => {
    if (!layout || size.w === 0 || size.h === 0) return;
    const k = Math.max(LEAST_FIT, Math.min(1, (size.w - 2 * MARGIN) / Math.max(1, layout.width), (size.h - 2 * MARGIN) / Math.max(1, layout.height)));
    setView({ k, x: (size.w - layout.width * k) / 2, y: Math.max(MARGIN, (size.h - layout.height * k) / 2) });
  }, [layout, size]);
  useEffect(() => {
    if (following.current) fit();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    following.current = false;
    setView((v) => {
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  }, []);

  // Not React's own onWheel, which cannot keep the page from scrolling along.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      else {
        following.current = false;
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Dragging pans; a press that does not move is a click, which goes to the line of what is under it.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; target: Element } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    // What was pressed: once the pointer is captured, it is no longer the target of its release.
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target as Element };
    host.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    following.current = false;
    setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const line = Number(d.target.closest('[data-line]')?.getAttribute('data-line'));
    if (line > 0) onSelectLine(line);
  };

  const worst = useMemo(() => {
    const m = new Map<number, 'error' | 'warning'>();
    for (const p of problems) if (m.get(p.line) !== 'error') m.set(p.line, p.severity);
    return m;
  }, [problems]);
  const active = useMemo(() => (layout ? sldAtLine(layout, cursorLine) : new Set<string>()), [layout, cursorLine]);

  const save = () => {
    const content = svg.current?.querySelector<SVGGElement>('g[data-content]');
    if (!content || !layout) return;
    // The colours come from the page's styles, which a file on its own does not have: write them into the drawing.
    const copy = content.cloneNode(true) as SVGGElement;
    const from = [content, ...content.querySelectorAll('*')];
    const to = [copy, ...copy.querySelectorAll('*')];
    from.forEach((el, i) => {
      const css = getComputedStyle(el);
      const target = to[i] as SVGElement;
      target.removeAttribute('class');
      target.removeAttribute('style');
      for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'white-space']) target.style.setProperty(p, css.getPropertyValue(p));
    });
    const w = layout.width + 2 * MARGIN;
    const h = layout.height + 2 * MARGIN;
    const background = getComputedStyle(document.documentElement).getPropertyValue('--sheet') || '#ffffff';
    const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-MARGIN} ${-MARGIN} ${w} ${h}" width="${w}" height="${h}"><rect x="${-MARGIN}" y="${-MARGIN}" width="${w}" height="${h}" fill="${background}"/>${copy.outerHTML}</svg>`;
    const url = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sld-tree.svg';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const centre = () => [size.w / 2, size.h / 2] as const;
  const message = tree === undefined ? t.sldNeedsNewer : !layout ? (stale ? t.sldFixSyntax : t.sldNoTree) : null;

  return (
    <div
      ref={host}
      className="relative h-full touch-none select-none overflow-hidden bg-sunk/40"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      style={{ cursor: 'grab' }}
    >
      <svg ref={svg} role="img" aria-label={t.sldPreviewLabel} className="size-full">
        <text ref={probe} className="font-mono" style={{ fontSize: FONT_SIZE }} opacity={0} aria-hidden>
          M
        </text>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g data-content className={clsx(stale && 'opacity-45')}>
            {layout?.titles.map((title) => (
              <text key={title.tree} x={title.x} y={title.y} dominantBaseline="central" className="fill-ink-3 font-sans" style={{ fontSize: 12 }}>
                {title.text}
              </text>
            ))}
            {layout?.edges.map((e) => <Edge key={e.id} e={e} state={worst.get(e.line) ?? (active.has(e.id) ? 'active' : null)} />)}
            {layout?.boxes.map((b) => <Box key={b.id} b={b} state={worst.get(b.line) ?? (active.has(b.id) ? 'active' : null)} />)}
          </g>
        </g>
      </svg>

      {message ? <p className="absolute inset-0 grid place-items-center px-8 text-center text-[13px] text-ink-3">{message}</p> : null}
      {stale && layout ? <p className="absolute left-3 top-3 rounded-md bg-sheet/90 px-2.5 py-1 text-xs text-danger shadow-sm">{t.sldStale}</p> : null}

      {layout ? (
        <div className="absolute right-2 top-2 flex gap-0.5 rounded-lg border border-line bg-sheet/90 p-0.5 shadow-sm">
          <IconButton label={t.zoomIn} onClick={() => zoomAt(1.25, ...centre())} className="size-7">
            <ZoomIn size={15} />
          </IconButton>
          <IconButton label={t.zoomOut} onClick={() => zoomAt(0.8, ...centre())} className="size-7">
            <ZoomOut size={15} />
          </IconButton>
          <IconButton
            label={t.zoomFit}
            onClick={() => {
              following.current = true;
              fit();
            }}
            className="size-7"
          >
            <Maximize2 size={15} />
          </IconButton>
          <IconButton label={t.saveSvg} onClick={save} className="size-7">
            <Download size={15} />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

type State = 'error' | 'warning' | 'active' | null;

const strokeOf = (state: State, normal: string) => (state === 'error' ? 'stroke-danger' : state === 'warning' ? 'stroke-warn' : state === 'active' ? 'stroke-accent' : normal);
const widthOf = (state: State) => (state ? 2.5 : 1.5);

function Edge({ e, state }: { e: SldEdge; state: State }) {
  return (
    <g data-line={e.line} className="cursor-pointer">
      <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="transparent" strokeWidth={12} />
      <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className={strokeOf(state, 'stroke-line-strong')} strokeWidth={widthOf(state)} strokeDasharray={e.dashed ? '5 4' : undefined} />
      {e.lw > 0 ? (
        <>
          <rect x={e.lx - e.lw / 2} y={e.ly - e.lh / 2} width={e.lw} height={e.lh} rx={4} className={clsx('fill-sheet', strokeOf(state, 'stroke-transparent'))} strokeWidth={state ? 1.5 : 0} />
          {e.label.map((line, i) => (
            <text
              key={i}
              x={e.lx}
              y={e.ly - e.lh / 2 + LABEL_PAD + LINE * (i + 0.5)}
              textAnchor="middle"
              dominantBaseline="central"
              className={clsx('font-mono', line.startsWith('{') || line.startsWith(' ') ? 'fill-ink-3' : 'fill-ink')}
              style={{ fontSize: FONT_SIZE, whiteSpace: 'pre' }}
            >
              {line}
            </text>
          ))}
        </>
      ) : null}
    </g>
  );
}

const KINDS: Record<SldBox['kind'], { fill: string; stroke: string; dashed: boolean }> = {
  goal: { fill: 'fill-sheet', stroke: 'stroke-line-strong', dashed: false },
  success: { fill: 'fill-done-soft', stroke: 'stroke-done', dashed: false },
  failure: { fill: 'fill-danger-soft', stroke: 'stroke-danger/50', dashed: false },
  pruned: { fill: 'fill-sunk', stroke: 'stroke-ink-3', dashed: true },
  missing: { fill: 'fill-review-soft', stroke: 'stroke-review', dashed: true },
};

function Box({ b, state }: { b: SldBox; state: State }) {
  const kind = KINDS[b.kind];
  return (
    <g data-line={b.line} className="cursor-pointer">
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={7} className={clsx(kind.fill, strokeOf(state, kind.stroke))} strokeWidth={widthOf(state)} strokeDasharray={kind.dashed ? '5 4' : undefined} />
      {b.lines.map((l, i) => (
        <text
          key={i}
          x={b.x + PAD_X}
          y={b.y + PAD_Y + LINE * (i + 0.5)}
          dominantBaseline="central"
          className={clsx('font-mono', l.role === 'answer' ? 'fill-done' : l.role === 'note' ? 'fill-ink-2' : 'fill-ink')}
          style={{ fontSize: FONT_SIZE, whiteSpace: 'pre' }}
        >
          {l.text}
        </text>
      ))}
      {b.name ? (
        <text x={b.x + b.w - 4} y={b.y - 6} textAnchor="end" className="fill-accent font-mono" style={{ fontSize: 11 }}>
          @{b.name}
        </text>
      ) : null}
    </g>
  );
}
