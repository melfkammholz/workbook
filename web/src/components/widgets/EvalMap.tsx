import { useMemo, useState } from 'react';
import { printState, stateKey, STRATEGY_IDS, type EvalMap, type State, type StrategyId } from '@wb/shared';
import { useT } from '@/lib/i18n';
import { clsx } from '../ui';

const COLORS: Record<StrategyId, string> = { innermost: 'var(--k1)', outermost: 'var(--k3)', outermostShared: 'var(--k4)' };
const CHAR = 8.4;
const ROW = 74;
const NODE_H = 26;
const GAP = 22;

interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  label: string;
  normal: boolean;
}

/** Layers by distance from the start; order inside a layer by the mean position of the parents (two sweeps). */
function layout(map: EvalMap): { placed: Map<string, Placed>; width: number; height: number } {
  const layers: string[][] = [];
  for (const n of map.nodes) (layers[n.layer] ??= []).push(n.id);
  const parents = new Map<string, string[]>();
  for (const e of map.edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  const order = new Map<string, number>();
  layers.forEach((l) => l.forEach((id, i) => order.set(id, i)));
  for (let pass = 0; pass < 2; pass++)
    for (let i = 1; i < layers.length; i++) {
      const bary = (id: string) => {
        const ps = (parents.get(id) ?? []).filter((p) => map.nodes.find((n) => n.id === p)!.layer < i);
        return ps.length ? ps.reduce((s, p) => s + order.get(p)!, 0) / ps.length : order.get(id)!;
      };
      layers[i]!.sort((a, b) => bary(a) - bary(b));
      layers[i]!.forEach((id, k) => order.set(id, k));
    }
  const label = new Map(map.nodes.map((n) => [n.id, printState(n.state)]));
  const widthOf = (l: string[]) => l.reduce((s, id) => s + label.get(id)!.length * CHAR + 20 + GAP, -GAP);
  const width = Math.max(...layers.map(widthOf)) + 8;
  const placed = new Map<string, Placed>();
  layers.forEach((l, i) => {
    let x = (width - widthOf(l)) / 2;
    for (const id of l) {
      const w = label.get(id)!.length * CHAR + 20;
      placed.set(id, { id, x, y: i * ROW + 4, w, label: label.get(id)!, normal: map.nodes.find((n) => n.id === id)!.normal });
      x += w + GAP;
    }
  });
  return { placed, width, height: layers.length * ROW - ROW + NODE_H + 8 };
}

/**
 * The map of all paths: every term reachable from the start, every reduction an arrow. Strategy paths can be shown
 * per chip; the student's own path is drawn as they walk (`walked` are the states they passed, in order).
 */
export function EvalMapView({ map, walked, chips = true }: { map: EvalMap; walked: State[]; chips?: boolean }) {
  const t = useT().widget.evalPath;
  const [on, setOn] = useState<Set<StrategyId>>(new Set());
  const { placed, width, height } = useMemo(() => layout(map), [map]);
  const idOf = useMemo(() => new Map(map.nodes.map((n) => [stateKey(n.state), n.id])), [map]);
  const walkedIds = walked.map((s) => idOf.get(stateKey(s))).filter((x): x is string => !!x);
  const walkedEdges = new Set<number>();
  for (let i = 0; i + 1 < walkedIds.length; i++) {
    const e = map.edges.find((e) => e.from === walkedIds[i] && e.to === walkedIds[i + 1]);
    if (e) walkedEdges.add(e.id);
  }
  const toggle = (s: StrategyId) =>
    setOn((p) => {
      const n = new Set(p);
      if (!n.delete(s)) n.add(s);
      return n;
    });
  const active = STRATEGY_IDS.filter((s) => on.has(s));
  const curve = (a: Placed, b: Placed, dx: number) => {
    const x1 = a.x + a.w / 2 + dx;
    const y1 = a.y + NODE_H;
    const x2 = b.x + b.w / 2 + dx;
    const y2 = b.y - 2;
    const my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  };
  return (
    <div className="flex flex-col gap-2">
      {chips && (
        <div className="flex flex-wrap items-center gap-2">
          {STRATEGY_IDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={on.has(s)}
              onClick={() => toggle(s)}
              className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ring-1', on.has(s) ? 'bg-sunk text-ink ring-line-strong' : 'text-ink-2 ring-line hover:text-ink')}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[s], opacity: on.has(s) ? 1 : 0.4 }} />
              {t.strategies[s]}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-md bg-sunk p-2">
        <svg width={width} height={height} role="img" aria-label={t.mapLabel} className="mx-auto block max-w-none font-mono text-[13px]">
          <defs>
            <marker id="evm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
            </marker>
          </defs>
          {map.edges.map((e) => (
            <path key={e.id} d={curve(placed.get(e.from)!, placed.get(e.to)!, 0)} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} markerEnd="url(#evm-arrow)">
              <title>{e.redex}</title>
            </path>
          ))}
          {map.edges.map((e) => walkedEdges.has(e.id) && (
            <path key={`w${e.id}`} d={curve(placed.get(e.from)!, placed.get(e.to)!, 0)} fill="none" stroke="var(--accent)" strokeWidth={3.5} markerEnd="url(#evm-arrow)" className="transition-[stroke-width] motion-reduce:transition-none" />
          ))}
          {active.map((s, si) =>
            map.strategies[s].map((id) => {
              const e = map.edges[id]!;
              const dx = (si - (active.length - 1) / 2) * 5;
              return <path key={`${s}${id}`} d={curve(placed.get(e.from)!, placed.get(e.to)!, dx)} fill="none" stroke={COLORS[s]} strokeWidth={2.5} strokeDasharray={s === 'outermostShared' ? '6 3' : undefined} markerEnd="url(#evm-arrow)" />;
            }),
          )}
          {[...placed.values()].map((p) => {
            const seen = walkedIds.includes(p.id);
            return (
              <g key={p.id}>
                <rect x={p.x} y={p.y} width={p.w} height={NODE_H} rx={6} fill="var(--sheet)" stroke={seen ? 'var(--accent)' : p.normal ? 'var(--done)' : 'var(--line-strong)'} strokeWidth={seen || p.normal ? 2 : 1} />
                <text x={p.x + p.w / 2} y={p.y + NODE_H / 2 + 4.5} textAnchor="middle" fill="var(--ink)">
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-[12px] text-ink-3">{t.mapNote}</p>
    </div>
  );
}
