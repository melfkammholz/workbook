import { useId, useMemo } from 'react';

type Kind = 'start' | 'decision' | 'good' | 'bad' | null;
interface NodeIn {
  id: string;
  label: string;
  at: [number, number];
  kind?: Kind;
  note?: string | null;
}
interface EdgeIn {
  from: string;
  to: string;
  label?: string | null;
}
interface Box extends NodeIn {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fill, border, the drop under it and the text, per kind: the same language as the trees in the lessons. */
const LOOK: Record<string, [string, string, string, string]> = {
  start: ['var(--sunk)', 'var(--line-strong)', 'var(--line)', 'var(--ink)'],
  good: ['var(--done-soft)', 'color-mix(in srgb, var(--done) 45%, transparent)', 'color-mix(in srgb, var(--done) 22%, var(--sheet))', 'var(--done)'],
  bad: ['var(--danger-soft)', 'color-mix(in srgb, var(--danger) 35%, transparent)', 'color-mix(in srgb, var(--danger) 16%, var(--sheet))', 'var(--danger)'],
  decision: ['var(--accent-soft)', 'color-mix(in srgb, var(--accent) 35%, transparent)', 'color-mix(in srgb, var(--accent) 22%, var(--sheet))', 'var(--accent)'],
  none: ['var(--sheet)', 'var(--line-strong)', 'var(--line)', 'var(--ink)'],
};

const ROW = 80;
const COL_GAP = 110;
const PAD = 24;
/** A rough width of a character at 13px of the UI font; boxes have room to spare. */
const CH = 7.3;

/**
 * A flowchart from `#flow`: boxes on a grid the author gives, arrows routed along the grid. Straight down within a
 * column, straight across within a row, up and around for a loop back, and a small loop for a box to itself.
 */
export function Flow({ config }: { config: string }) {
  const marker = useId().replace(/:/g, '');
  const graph = useMemo(() => {
    try {
      const c = JSON.parse(config) as { nodes?: NodeIn[]; edges?: EdgeIn[] };
      return layout(c.nodes ?? [], c.edges ?? []);
    } catch {
      return null;
    }
  }, [config]);
  if (!graph) return null;
  const { boxes, edges, width, height } = graph;
  return (
    <figure className="wb-flow !my-[18px] overflow-x-auto rounded-xl border border-line bg-sheet p-3">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={boxes.map((b) => b.label).join(', ')} className="mx-auto block h-auto w-full" style={{ maxWidth: width }}>
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M1.5 1.5 L7.5 5 L1.5 8.5" fill="none" stroke="var(--line-strong)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {edges.map((e, i) => (
          <path key={i} d={e.d} fill="none" stroke="var(--line-strong)" strokeWidth={1.25} strokeLinecap="round" markerEnd={`url(#${marker})`} />
        ))}
        {edges.map((e, i) =>
          e.label ? (
            <text key={i} x={e.lx} y={e.ly} textAnchor={e.anchor} dominantBaseline="central" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, fill: 'var(--accent)' }}>
              {e.label}
            </text>
          ) : null,
        )}
        {boxes.map((b) => {
          const [fill, stroke, under, ink] = LOOK[b.kind ?? 'none'] ?? LOOK.none!;
          const x = b.x - b.w / 2;
          const y = b.y - b.h / 2;
          return (
            <g key={b.id}>
              <rect x={x} y={y + 1.5} width={b.w} height={b.h} rx={9} fill={under} />
              <rect x={x} y={y} width={b.w} height={b.h} rx={9} fill={fill} stroke={stroke} strokeWidth={1} />
              <text x={b.x} y={b.note ? b.y - 8 : b.y} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 13, fontWeight: b.kind && b.kind !== 'start' ? 600 : 500, fill: ink }}>
                {b.label}
              </text>
              {b.note ? (
                <text x={b.x} y={b.y + 10} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 12, fill: 'var(--ink-2)' }}>
                  {b.note}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

interface Routed {
  d: string;
  label: string | null;
  lx: number;
  ly: number;
  anchor: 'start' | 'middle' | 'end';
}

function layout(nodes: NodeIn[], edgesIn: EdgeIn[]) {
  const size = (n: NodeIn) => ({ w: Math.max(n.label.length, n.note ? n.note.length * 0.92 : 0) * CH + 36, h: n.note ? 48 : 34 });
  const cols = Math.max(0, ...nodes.map((n) => n.at[0])) + 1;
  // Each column as wide as its widest box; a self-loop needs room on the left of the first column.
  const colW = Array.from({ length: cols }, (_, c) => Math.max(60, ...nodes.filter((n) => n.at[0] === c).map((n) => size(n).w)));
  const loopRoom = edgesIn.some((e) => e.from === e.to) ? 56 : 0;
  const colX: number[] = [];
  let x = PAD + loopRoom;
  for (let c = 0; c < cols; c++) {
    colX.push(x + colW[c]! / 2);
    x += colW[c]! + COL_GAP;
  }
  const width = x - COL_GAP + PAD;
  const boxes = new Map<string, Box>(nodes.map((n) => [n.id, { ...n, ...size(n), x: colX[n.at[0]]!, y: PAD + 10 + n.at[1] * ROW }]));
  const height = Math.max(0, ...[...boxes.values()].map((b) => b.y + b.h / 2)) + PAD;

  const top = (b: Box) => b.y - b.h / 2;
  const bottom = (b: Box) => b.y + b.h / 2;
  const left = (b: Box) => b.x - b.w / 2;
  const right = (b: Box) => b.x + b.w / 2;
  const R = 14;
  const edges: Routed[] = [];
  for (const e of edgesIn) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;
    const label = e.label ?? null;
    if (a === b) {
      // A small loop on the box's left side.
      const sx = left(a);
      edges.push({ d: `M${sx + 10} ${top(a)} C ${sx - 10} ${a.y - 46}, ${sx - 52} ${a.y - 10}, ${sx - 3} ${a.y + 4}`, label, lx: sx - 34, ly: a.y - 30, anchor: 'end' });
    } else if (a.at[0] === b.at[0] && b.at[1] > a.at[1]) {
      // Straight down within a column.
      edges.push({ d: `M${a.x} ${bottom(a)} V${top(b) - 3}`, label, lx: a.x + 10, ly: (bottom(a) + top(b)) / 2, anchor: 'start' });
    } else if (a.at[1] === b.at[1]) {
      // Straight across within a row.
      const ltr = b.x > a.x;
      const x1 = ltr ? right(a) : left(a);
      const x2 = ltr ? left(b) - 3 : right(b) + 3;
      edges.push({ d: `M${x1} ${a.y} H${x2}`, label, lx: (x1 + x2) / 2, ly: a.y - 12, anchor: 'middle' });
    } else if (b.at[1] < a.at[1] && a.at[0] !== b.at[0]) {
      // A loop back: up from the box, then across into the side of the box it returns to.
      const ltr = b.x > a.x;
      const x2 = ltr ? left(b) - 3 : right(b) + 3;
      const turn = ltr ? R : -R;
      edges.push({ d: `M${a.x} ${top(a)} V${b.y + R} Q${a.x} ${b.y} ${a.x + turn} ${b.y} H${x2}`, label, lx: a.x + 10, ly: (top(a) + b.y) / 2, anchor: 'start' });
    } else if (a.at[0] === b.at[0]) {
      // Up within a column: around the right side.
      const out = Math.max(right(a), right(b)) + 24;
      edges.push({ d: `M${right(a)} ${a.y} H${out - R} Q${out} ${a.y} ${out} ${a.y - R} V${b.y + R} Q${out} ${b.y} ${out - R} ${b.y} H${right(b) + 3}`, label, lx: out + 8, ly: (a.y + b.y) / 2, anchor: 'start' });
    } else {
      // Down and across: out of the side, then down into the top.
      const ltr = b.x > a.x;
      const x1 = ltr ? right(a) : left(a);
      const turn = ltr ? -R : R;
      edges.push({ d: `M${x1} ${a.y} H${b.x + turn} Q${b.x} ${a.y} ${b.x} ${a.y + R} V${top(b) - 3}`, label, lx: (x1 + b.x) / 2, ly: a.y - 12, anchor: 'middle' });
    }
  }
  return { boxes: [...boxes.values()], edges, width, height };
}
