import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { arg, foldSetup, parseValue, planFold, show, type FoldPlan, type Term } from '@/lib/foldSignature';
import { useT } from '@/lib/i18n';
import { clsx } from '../ui';
import { kClass } from './FoldSignature';
import { Choice, Code, Frame, Row } from './index';
import { useEvaluate } from './useEvaluate';

interface Config {
  value: string;
  /** For each constructor, the function passed to the fold, e.g. the constructor itself. */
  functions: Record<string, string>;
  type: string | null;
  fold: string | null;
}

/**
 * A value as a tree of constructors next to what a fold makes of it: every constructor becomes a function,
 * the functions are filled in, and (unless they are the constructors themselves) the tree folds together
 * from the leaves. The values come from the interpreter.
 */
export function FoldTree({ decl, config }: { decl: string; config: string }) {
  const t = useT().widget;
  const cfg = useMemo(() => JSON.parse(config) as Config, [config]);
  const plan = useMemo(() => planFold(decl, cfg.fold ?? undefined), [decl, cfg.fold]);
  const term = useMemo(() => ('error' in plan ? plan : parseValue(cfg.value, plan)), [plan, cfg.value]);
  if ('error' in plan || 'error' in term) {
    return (
      <Frame>
        <p className="text-sm text-danger">{t.badDecl('error' in plan ? plan.error : 'error' in term ? term.error : '')}</p>
      </Frame>
    );
  }
  return <Fold plan={plan} decl={decl} cfg={cfg} root={term} />;
}

/** A node of the picture. Lists of subtrees are drawn as the subtrees themselves. */
export interface Node {
  term: Term;
  children: Node[];
}
export const nodeOf = (t: Term): Node => ({ term: t, children: t.children.flatMap((c) => (c.list ? c.children : [c])).map(nodeOf) });
export const postOrder = (n: Node): Node[] => [...n.children.flatMap(postOrder), ...(n.term.ci !== null ? [n] : [])];
const within = (n: Node, of: Node): boolean => n === of || of.children.some((c) => within(n, c));

function Fold({ plan, decl, cfg, root }: { plan: FoldPlan; decl: string; cfg: Config; root: Term }) {
  const t = useT().widget.tree;
  const cons = plan.constructors;
  const tree = useMemo(() => nodeOf(root), [root]);
  const order = useMemo(() => postOrder(tree), [tree]);
  const hasFunctions = cons.every((c) => cfg.functions[c.name]);
  const identity = hasFunctions && cons.every((c) => cfg.functions[c.name]!.trim() === c.name);
  const stages = t.stages.slice(0, !hasFunctions ? 2 : identity ? 3 : 4);
  const [stage, setStage] = useState(0);
  const [computed, setComputed] = useState(0);

  const setup = useMemo(() => foldSetup(plan, decl), [plan, decl]);
  const fns = cons.map((c) => arg(cfg.functions[c.name] ?? 'undefined')).join(' ');
  const exprs = useMemo(
    () => (hasFunctions ? order.map((n) => `${plan.fold} ${fns} (${show(n.term)}${cfg.type ? ` :: ${cfg.type}` : ''})`) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, fns],
  );
  const values = useEvaluate(setup, exprs, hasFunctions);
  const valueOf = (n: Node) => {
    const r = values.data?.[order.indexOf(n)];
    return r?.ok ? r.value : r ? '⚠' : '…';
  };

  const value = show(root);
  const call = (params: string) => `${plan.fold} ${params} ${arg(value)}`;
  const result = valueOf(tree);
  const short = (f: string) => (f.length <= 10 ? f : null);
  const fnLabel = (n: Node) => {
    const c = cons[n.term.ci!]!;
    return stage === 1 ? c.paramName : (short(cfg.functions[c.name] ?? '') ?? c.paramName);
  };
  const done = stage === 3 ? new Set(order.slice(0, computed)) : new Set<Node>();
  /** Every label a node can have here, so both pictures are laid out for the widest from the start. */
  const widest = (n: Node) => {
    if (n.term.ci === null) return n.term.text;
    const c = cons[n.term.ci]!;
    const labels = [n.term.text, c.paramName, short(cfg.functions[c.name] ?? '') ?? '', values.data ? valueOf(n) : ''];
    return labels.reduce((a, b) => (b.length > a.length ? b : a), '');
  };

  const explain = stage === 0 ? t.value : stage === 1 ? t.replace : stage === 2 ? (identity ? t.identity : t.insert) : t.compute(computed, order.length);
  const pick = (s: number) => {
    setStage(s);
    setComputed(s === 3 ? 0 : computed);
  };

  return (
    <Frame>
      <Row label={t.step}>
        <Choice options={stages} at={stage} onPick={pick} label={t.step} />
      </Row>
      <div className="grid gap-3 sm:grid-cols-2">
        <Column caption={<Code>{value}</Code>}>
          <TreePicture tree={tree} label={(n) => n.term.text} done={new Set()} valueOf={valueOf} aria={value} widest={widest} />
        </Column>
        {stage === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-md border border-dashed border-line-strong bg-paper p-3 text-center font-mono text-[13px] text-ink-3">{t.hold}</div>
        ) : (
          <Column
            caption={
              stage === 1 ? (
                <Code>{call(cons.map((c) => c.paramName).join(' '))}</Code>
              ) : stage === 2 ? (
                <>
                  <Code>{call(cons.map((c) => arg(cfg.functions[c.name]!)).join(' '))}</Code>
                  {identity ? <span className="text-ink-2"> = {result}</span> : null}
                </>
              ) : (
                <Expression tree={tree} done={done} head={fnLabel} valueOf={valueOf} />
              )
            }
          >
            <TreePicture tree={tree} label={(n) => (n.term.ci === null ? n.term.text : fnLabel(n))} done={done} valueOf={valueOf} aria={value} widest={widest} />
          </Column>
        )}
      </div>

      {stage === 3 ? (
        <div className="flex items-center gap-2 self-center">
          <button type="button" aria-label={t.node(computed, order.length)} disabled={computed === 0} onClick={() => setComputed(computed - 1)} className="grid size-8 place-items-center rounded-md border border-line-strong bg-sheet text-ink-2 hover:bg-sunk disabled:opacity-35">
            <ChevronLeft size={17} />
          </button>
          <span className="min-w-[8.5rem] text-center text-[13px] text-ink-3">{t.node(computed, order.length)}</span>
          <button type="button" aria-label={t.node(computed + 1, order.length)} disabled={computed === order.length} onClick={() => setComputed(computed + 1)} className="grid size-8 place-items-center rounded-md bg-accent text-accent-ink hover:brightness-110 disabled:opacity-35">
            <ChevronRight size={17} />
          </button>
        </div>
      ) : null}

      {stage >= 2 ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13.5px] font-medium">
          {cons.map((c, i) => (
            <span key={c.name} className={kClass(i)} style={{ color: 'var(--k)' }}>
              {c.paramName} = {cfg.functions[c.name]}
            </span>
          ))}
        </p>
      ) : null}
      <p className="text-[14.5px] leading-normal" aria-live="polite">
        {explain}
      </p>
      {stage === 3 && order.length > 1 ? <p className="text-[13.5px] text-ink-3">{t.lazy}</p> : null}
    </Frame>
  );
}

function Column({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line bg-paper p-2">
      {children}
      <p className="min-h-[3em] text-center font-mono text-[13px] font-medium text-ink-2 [overflow-wrap:anywhere]">{caption}</p>
    </div>
  );
}

/** What the tree stands for, with computed subtrees replaced by their values. */
function Expression({ tree, done, head, valueOf }: { tree: Node; done: Set<Node>; head: (n: Node) => string; valueOf: (n: Node) => string }) {
  /** Computed, and not inside something computed: then it is shown as its value. */
  const collapsed = (n: Node) => done.has(n);
  const expr = (n: Node, nested: boolean): ReactNode => {
    if (collapsed(n)) {
      const v = valueOf(n);
      return <b className="rounded bg-accent-soft px-0.5 font-semibold text-accent">{nested && /\s/.test(v) ? `(${v})` : v}</b>;
    }
    if (n.term.ci === null) return <Code>{n.term.text}</Code>;
    const k = kClass(n.term.ci);
    const parts: ReactNode[] = [
      <span key="h" className={clsx(k, 'font-semibold')} style={{ color: 'var(--k)' }}>
        {head(n)}
      </span>,
    ];
    let c = 0;
    n.term.children.forEach((f, i) => {
      parts.push(' ');
      if (f.list) {
        const items = f.children.map(() => n.children[c++]!);
        parts.push(<Fragment key={i}>[{items.map((x, j) => <Fragment key={j}>{j ? ', ' : ''}{expr(x, false)}</Fragment>)}]</Fragment>);
        return;
      }
      const child = n.children[c++]!;
      const compound = !collapsed(child) && child.term.ci !== null && child.term.children.length > 0;
      parts.push(<Fragment key={i}>{compound ? '(' : ''}{expr(child, true)}{compound ? ')' : ''}</Fragment>);
    });
    return <>{parts}</>;
  };
  const all = done.has(tree);
  return all ? <>= {expr(tree, false)}</> : <>{expr(tree, false)}</>;
}

const CHAR = 8.2;
const LEVEL = 58;
const GAP = 16;

/** The tree, laid out like the prototype's: leaves side by side, each node above its children. */
export function TreePicture({
  tree,
  label,
  done,
  valueOf,
  aria,
  dim,
  now,
  gone,
  widest,
}: {
  tree: Node;
  label: (n: Node) => string;
  done: Set<Node>;
  valueOf: (n: Node) => string;
  aria: string;
  /** Never needed: shown faintly. */
  dim?: Set<Node>;
  /** What the last step changed. */
  now?: Node | null;
  /** Taken into another node, e.g. a field a function has been applied to: no longer drawn. */
  gone?: Set<Node>;
  /** The widest label a node will ever have. The layout is made for that once, so nothing moves while labels change. */
  widest?: (n: Node) => string;
}) {
  const shown = (n: Node) => (done.has(n) ? valueOf(n) : label(n));
  const width = (n: Node) => Math.max(38, shown(n).length * CHAR + 20);
  /** The highest computed node above (or at) n stands for it: in post-order, the last one that contains n. */
  const collapsedAt = (n: Node): Node | null => {
    let best: Node | null = null;
    for (const c of done) if (within(n, c)) best = c;
    return best;
  };
  // Laid out once for the whole tree and the widest labels: folding moves nodes into their parent, nothing else.
  const room = (n: Node) => Math.max(width(n), widest ? Math.max(38, widest(n).length * CHAR + 20) : 0);
  const pos = new Map<Node, { x: number; y: number }>();
  const span = (n: Node): number => {
    const sum = n.children.reduce((s, c) => s + span(c), 0) + GAP * Math.max(0, n.children.length - 1);
    return Math.max(room(n) + 8, sum);
  };
  const place = (n: Node, left: number, depth: number) => {
    const s = span(n);
    pos.set(n, { x: left + s / 2, y: 24 + depth * LEVEL });
    const sum = n.children.reduce((acc, c) => acc + span(c), 0) + GAP * Math.max(0, n.children.length - 1);
    let x = left + (s - sum) / 2;
    for (const c of n.children) {
      place(c, x, depth + 1);
      x += span(c) + GAP;
    }
  };
  place(tree, 0, 0);
  const home = new Map(pos);
  // What is folded sits where it was folded into.
  for (const n of pos.keys()) {
    const c = collapsedAt(n);
    if (c && c !== n) pos.set(n, home.get(c)!);
  }
  const W = Math.max(220, span(tree));
  const H = Math.max(...[...home.values()].map((p) => p.y)) + 26;
  const offset = (W - span(tree)) / 2;
  const nodes: Node[] = [];
  const walk = (n: Node) => {
    nodes.push(n);
    n.children.forEach(walk);
  };
  walk(tree);
  const hidden = (n: Node) => {
    const c = collapsedAt(n);
    return (c !== null && c !== n) || !!gone?.has(n);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} className="mx-auto block h-auto w-full" style={{ maxWidth: Math.max(W, 260) }}>
      <g transform={`translate(${offset} 0)`}>
        {nodes.flatMap((n, ni) =>
          n.children.map((c, i) => {
            const a = home.get(n)!;
            const b = home.get(c)!;
            return <line key={`${ni}-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="transition-opacity duration-300" style={{ stroke: 'var(--line-strong)', strokeWidth: 2, opacity: hidden(c) ? 0 : 1 }} />;
          }),
        )}
        {nodes.map((n, i) => {
          const p = pos.get(n)!;
          const value = done.has(n) && collapsedAt(n) === n;
          const k = n.term.ci === null ? null : kClass(n.term.ci);
          const w = width(n);
          return (
            <g key={i} className={clsx(k, 'transition-[transform,opacity] duration-500')} style={{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: hidden(n) ? 0 : dim?.has(n) ? 0.35 : 1 }}>
              <rect
                x={-w / 2}
                y={-15}
                width={w}
                height={30}
                rx={7}
                style={{
                  fill: value ? 'var(--accent)' : k ? 'var(--ks)' : 'var(--sunk)',
                  stroke: value ? 'var(--accent)' : k ? 'var(--k)' : 'var(--line-strong)',
                  strokeWidth: n === now ? 3 : 1.5,
                  strokeDasharray: dim?.has(n) ? '4 4' : undefined,
                }}
              />
              <text textAnchor="middle" dominantBaseline="central" className="font-mono text-[14px]" style={{ fill: value ? 'var(--accent-ink)' : 'var(--ink)', fontWeight: value ? 650 : 500 }}>
                {shown(n)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
