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
  /** At its real size, so that the text reads as in the editor: all of it if it fits, otherwise its root at the top centre. */
  const start = useCallback(() => {
    if (!layout || size.w === 0 || size.h === 0) return;
    if (layout.width <= size.w - 2 * MARGIN) return setView({ k: 1, x: (size.w - layout.width) / 2, y: MARGIN });
    const root = layout.boxes.find((b) => !layout.edges.some((e) => e.to === b.id)) ?? layout.boxes[0];
    setView({ k: 1, x: root ? size.w / 2 - (root.x + root.w / 2) : MARGIN, y: MARGIN });
  }, [layout, size]);
  useEffect(() => {
    if (following.current) start();
  }, [start]);

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
  // Hovering a box traces its path from the root: the boxes and edges that led to it.
  const [hovered, setHovered] = useState<string | null>(null);
  const path = useMemo(() => {
    const ids = new Set<string>();
    if (!layout || !hovered) return ids;
    const into = new Map(layout.edges.map((e) => [e.to, e]));
    for (let at: string | undefined = hovered; at; at = into.get(at)?.from) {
      ids.add(at);
      const e = into.get(at);
      if (e) ids.add(e.id);
    }
    return ids;
  }, [layout, hovered]);

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
            {layout?.edges.map((e) => <Edge key={e.id} e={e} state={worst.get(e.line) ?? (active.has(e.id) ? 'active' : null)} onPath={path.has(e.id)} />)}
            {layout?.boxes.map((b) => (
              <Box key={b.id} b={b} state={worst.get(b.line) ?? (active.has(b.id) ? 'active' : null)} onPath={path.has(b.id)} measure={measure} onHover={(on) => setHovered(on ? b.id : null)} />
            ))}
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

// The same language as the lesson's trees: thin borders in a soft tint, a small drop under each box, curved edges.
const strokeOf = (state: State, normal: string) => (state === 'error' ? 'stroke-danger' : state === 'warning' ? 'stroke-warn' : state === 'active' ? 'stroke-accent' : normal);
const widthOf = (state: State) => (state ? 1.75 : 1);

/** ↦ sits low in most monospace fonts: lifted a little, so a substitution reads on one line. */
function Lifted({ text }: { text: string }) {
  const parts = text.split('↦');
  return (
    <>
      {parts.map((part, i) => (
        <tspan key={i}>
          {i > 0 ? (
            <>
              <tspan dy={-1.6}>↦</tspan>
              <tspan dy={1.6}>{part}</tspan>
            </>
          ) : (
            part
          )}
        </tspan>
      ))}
    </>
  );
}

/** A curve from the parent down into the child; with a label, it stops at the label and goes on below it, so no line runs through text. */
function edgePath(e: SldEdge): string[] {
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const my = (y1 + y2) / 2;
    return `M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
  };
  if (e.lw <= 0) return [curve(e.x1, e.y1, e.x2, e.y2)];
  const top = e.ly - e.lh / 2 - 2;
  const bottom = e.ly + e.lh / 2 + 2;
  return bottom < e.y2 ? [curve(e.x1, e.y1, e.x2, top), `M${e.x2} ${bottom} V${e.y2}`] : [curve(e.x1, e.y1, e.x2, top)];
}

function Edge({ e, state, onPath }: { e: SldEdge; state: State; onPath: boolean }) {
  const d = edgePath(e);
  return (
    <g data-line={e.line} className="cursor-pointer">
      {d.map((p, i) => (
        <path key={`h${i}`} d={p} fill="none" stroke="transparent" strokeWidth={12} />
      ))}
      {d.map((p, i) => (
        <path
          key={i}
          d={p}
          fill="none"
          strokeLinecap="round"
          className={clsx('transition-[stroke,stroke-width]', state ? strokeOf(state, '') : onPath ? 'stroke-accent' : 'stroke-line-strong')}
          strokeWidth={state ? widthOf(state) : onPath ? 1.75 : 1.25}
          strokeDasharray={e.dashed ? '3 4' : undefined}
        />
      ))}
      {e.lw > 0 ? (
        <>
          {state ? <rect x={e.lx - e.lw / 2} y={e.ly - e.lh / 2} width={e.lw} height={e.lh} rx={5} className={clsx('fill-transparent', strokeOf(state, ''))} strokeWidth={1.25} /> : null}
          {e.label.map((line, i) => {
            // `(2)` or `builtin` first, in the accent; the substitution quieter; a renamed clause as written.
            const tag = /^(\(\d+\)|builtin)( |$)/.exec(line)?.[1];
            return (
              <text
                key={i}
                x={e.lx - e.lw / 2 + LABEL_PAD}
                y={e.ly - e.lh / 2 + LABEL_PAD + LINE * (i + 0.5)}
                dominantBaseline="central"
                className={clsx('font-mono', tag || line.startsWith('{') || line.startsWith(' ') ? 'fill-ink-2' : 'fill-ink')}
                style={{ fontSize: FONT_SIZE, whiteSpace: 'pre' }}
              >
                {tag ? (
                  <>
                    <tspan className="fill-accent font-semibold">{tag}</tspan>
                    <Lifted text={line.slice(tag.length)} />
                  </>
                ) : (
                  <Lifted text={line} />
                )}
              </text>
            );
          })}
        </>
      ) : null}
    </g>
  );
}

// Fill, border and the drop under the box, each from the theme.
const KINDS: Record<SldBox['kind'], { fill: string; stroke: string; drop: string; dashed: boolean }> = {
  goal: { fill: 'fill-sheet', stroke: 'stroke-line-strong', drop: 'fill-line', dashed: false },
  success: { fill: 'fill-done-soft', stroke: 'stroke-done/45', drop: 'fill-done/25', dashed: false },
  failure: { fill: 'fill-danger-soft', stroke: 'stroke-danger/35', drop: 'fill-danger/15', dashed: false },
  pruned: { fill: 'fill-sunk', stroke: 'stroke-ink-3/60', drop: 'fill-line', dashed: true },
  missing: { fill: 'fill-review-soft', stroke: 'stroke-review/60', drop: 'fill-review/20', dashed: true },
};

/** The literal the selection function picks next: the leftmost one, up to the first comma outside brackets. */
function selected(goal: string): [string, string] | null {
  if (!goal.startsWith('?- ') || goal === '?- true.') return null;
  const body = goal.slice(3);
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return [body.slice(0, i), body.slice(i)];
  }
  // One literal: all of it but the end dot. A goal broken over lines has no dot on its first line.
  return body.endsWith('.') ? [body.slice(0, -1), '.'] : null;
}

function Box({ b, state, onPath, measure, onHover }: { b: SldBox; state: State; onPath: boolean; measure: ((text: string) => number) | null; onHover: (on: boolean) => void }) {
  const kind = KINDS[b.kind];
  // The answer of a success is written under its box, not in it.
  const inside = b.lines.filter((l) => l.role !== 'answer');
  const answer = b.lines.filter((l) => l.role === 'answer');
  const w = answer.length && measure ? Math.max(...inside.map((l) => measure(l.text))) + 2 * PAD_X : b.w;
  const h = inside.length * LINE + 2 * PAD_Y;
  const x = b.x + (b.w - w) / 2;
  const first = inside[0]?.role === 'goal' ? selected(inside[0].text) : null;
  const stroke = state ? strokeOf(state, '') : onPath ? 'stroke-accent/60' : kind.stroke;
  return (
    <g data-line={b.line} className="cursor-pointer" onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <rect x={x} y={b.y + 1.5} width={w} height={h} rx={9} className={kind.drop} />
      <rect x={x} y={b.y} width={w} height={h} rx={9} className={clsx(kind.fill, stroke, 'transition-[stroke]')} strokeWidth={widthOf(state)} strokeDasharray={kind.dashed ? '4 3' : undefined} />
      {first && measure ? (
        <rect x={x + PAD_X + measure('?- ') - 2.5} y={b.y + PAD_Y + 1} width={measure(first[0]) + 5} height={LINE - 2} rx={4} className="fill-accent/10" />
      ) : null}
      {inside.map((l, i) => (
        <text
          key={i}
          x={x + PAD_X}
          y={b.y + PAD_Y + LINE * (i + 0.5)}
          dominantBaseline="central"
          className={clsx('font-mono', b.kind === 'failure' ? 'fill-danger' : l.role === 'note' ? 'fill-ink-2' : 'fill-ink')}
          style={{ fontSize: FONT_SIZE, whiteSpace: 'pre' }}
        >
          {l.role === 'goal' && l.text.startsWith('?- ') ? (
            <>
              <tspan className="fill-accent">?-</tspan>
              {l.text.slice(2)}
            </>
          ) : (
            l.text
          )}
        </text>
      ))}
      {answer.map((l, i) => (
        <text
          key={`a${i}`}
          x={b.x + b.w / 2}
          y={b.y + h + 6 + LINE * (i + 0.5)}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-done font-mono font-semibold"
          style={{ fontSize: FONT_SIZE, whiteSpace: 'pre' }}
        >
          <Lifted text={l.text} />
        </text>
      ))}
      {b.name ? (
        <text x={x + w - 4} y={b.y - 6} textAnchor="end" className="fill-accent font-mono" style={{ fontSize: 11 }}>
          @{b.name}
        </text>
      ) : null}
    </g>
  );
}
