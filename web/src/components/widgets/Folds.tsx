import { useMemo, useState, type ReactNode } from 'react';
import { arg, type Term } from '@/lib/foldSignature';
import { useT } from '@/lib/i18n';
import { clsx } from '../ui';
import { kClass } from './FoldSignature';
import { nodeOf, TreePicture } from './FoldTree';
import { Choice, Code, Frame, Message, Row, StepBar } from './index';
import { useEvaluate } from './useEvaluate';

// ───────────────────────── expression trees ─────────────────────────

/** Splits an application into its pieces at the top level: `f 1 (g 2) "s"` → f, 1, (g 2), "s". */
function pieces(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote = false;
  for (const ch of src.trim()) {
    if (ch === '"') quote = !quote;
    if (!quote && '(['.includes(ch)) depth++;
    if (!quote && ')]'.includes(ch)) depth--;
    if (!quote && depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Any application as a tree: the function above, its arguments below. */
function treeOf(src: string, colors: Record<string, number>): Term {
  let s = src.trim();
  while (s.startsWith('(') && s.endsWith(')') && pieces(s).length === 1 && s.length > 2) s = s.slice(1, -1).trim();
  const ps = pieces(s);
  const color = (name: string) => (colors[name] ? colors[name]! - 1 : null);
  if (ps.length <= 1) return { ci: color(s), text: s, children: [] };
  const [head, ...args] = ps;
  return { ci: color(head!) ?? 2, text: head!, children: args.map((a) => treeOf(a, colors)) };
}

/** A few expressions drawn as trees side by side, each with a caption. */
export function ExprTrees({ config }: { config: string }) {
  const cfg = useMemo(() => JSON.parse(config) as { trees: { expr: string; caption?: string }[]; colors: Record<string, number> }, [config]);
  return (
    <Frame>
      <div className="grid gap-3 sm:grid-cols-2">
        {cfg.trees.map((t, i) => {
          const tree = nodeOf(treeOf(t.expr, cfg.colors ?? {}));
          return (
            <div key={i} className="flex min-w-0 flex-col gap-1.5 rounded-[10px] border border-line bg-stage p-2">
              <TreePicture tree={tree} label={(n) => n.term.text} done={new Set()} valueOf={() => ''} aria={t.expr} />
              <p className="text-center font-mono text-[13px] font-medium text-ink-2 [overflow-wrap:anywhere]">
                <Code>{t.caption ?? t.expr}</Code>
              </p>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

// ───────────────────────── a list, folded element by element ─────────────────────────

interface ListFold {
  name: string;
  dir: 'left' | 'right';
  fn: string;
  start: string;
}

/** The elements of a list as ghci shows it, `[3,2,1]`, or null for anything else. */
function listItems(value: string): string[] | null {
  const v = value.trim();
  if (!v.startsWith('[') || !v.endsWith(']')) return null;
  const inner = v.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((x) => x.trim());
}

function Card({ text, k, next, fresh }: { text: string; k: string | null; next?: boolean; fresh?: boolean }) {
  return (
    <span
      className={clsx(k, 'inline-grid h-9 min-w-9 place-items-center rounded-md border-[1.5px] px-2 font-mono text-[14px] font-semibold transition-all', fresh && 'wb-land', next && 'ring-3 ring-accent-soft')}
      style={k ? { background: 'var(--ks)', borderColor: 'var(--k)', color: 'var(--ink)' } : { background: 'var(--sheet)', borderColor: 'var(--line-strong)' }}
    >
      {text}
    </span>
  );
}

/** Input and accumulator as cards: which element goes where, step by step. The interpreter computes every step. */
export function FoldList({ config }: { config: string }) {
  const t = useT().widget.foldList;
  const cfg = useMemo(() => JSON.parse(config) as { xs: string[]; folds: ListFold[] }, [config]);
  const [fi, setFi] = useState(0);
  const [k, setK] = useState(0);
  const fold = cfg.folds[fi]!;
  const n = cfg.xs.length;
  const left = fold.dir === 'left';
  const list = (xs: string[]) => `[${xs.join(', ')}]`;
  /** The elements already in the accumulator after i steps. */
  const taken = (i: number) => (left ? cfg.xs.slice(0, i) : cfg.xs.slice(n - i));
  const exprs = useMemo(
    () => Array.from({ length: n + 1 }, (_, i) => `${left ? 'foldl' : 'foldr'} ${arg(fold.fn)} ${arg(fold.start)} ${list(taken(i))}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fi, config],
  );
  const values = useEvaluate('', exprs);
  const acc = (i: number) => {
    const r = values.data?.[i];
    return r?.ok ? r.value : r ? '⚠' : '…';
  };
  /** An element's colour: the same card from the input to the accumulator. */
  const colourOf = (x: string) => {
    const i = cfg.xs.indexOf(x);
    return i < 0 ? null : kClass(i);
  };
  const rest = left ? cfg.xs.slice(k) : cfg.xs.slice(0, n - k);
  const nextIndex = k === n ? -1 : left ? 0 : rest.length - 1;
  const moved = k === 0 ? null : left ? cfg.xs[k - 1]! : cfg.xs[n - k]!;
  const now = acc(k);
  const items = listItems(now);
  const say =
    k === 0 ? t.start(fold.start) : t.step(left ? `${arg(fold.fn)} ${arg(acc(k - 1))} ${moved}` : `${arg(fold.fn)} ${moved} ${arg(acc(k - 1))}`, now);

  return (
    <Frame>
      {cfg.folds.length > 1 ? (
        <Row label={t.fold}>
          <Choice
            code
            options={cfg.folds.map((f) => f.name)}
            at={fi}
            onPick={(i) => {
              setFi(i);
              setK(0);
            }}
            label={t.fold}
          />
        </Row>
      ) : null}
      <StepBar at={k} count={n + 1} onGo={setK} />
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-[10px] border border-line bg-stage p-3">
        <span className="text-[13px] text-ink-3">{t.input}</span>
        <span className="flex min-h-9 flex-wrap items-center gap-1.5 font-mono">
          <span className="text-ink-3">[</span>
          {rest.map((x, i) => (
            <Card key={x} text={x} k={colourOf(x)} next={i === nextIndex} />
          ))}
          <span className="text-ink-3">]</span>
        </span>
        <span className="text-[13px] text-ink-3">{t.accumulator}</span>
        <span className="flex min-h-9 flex-wrap items-center gap-1.5 font-mono">
          {items ? (
            <>
              <span className="text-ink-3">[</span>
              {items.map((x) => (
                <Card key={x} text={x} k={colourOf(x)} fresh={x === moved} />
              ))}
              <span className="text-ink-3">]</span>
            </>
          ) : (
            <Card key={now} text={now} k={null} fresh />
          )}
        </span>
      </div>
      <p className="min-h-[1.5em] text-center text-[14.5px]" aria-live="polite">
        <Message text={say} />
      </p>
      <p className="text-[14px] text-ink-2">{left ? t.left : t.right}</p>
    </Frame>
  );
}

// ───────────────────────── where the brackets go ─────────────────────────

interface Op {
  op: string;
  list: string[];
  assoc: boolean;
  starts: { value: string; neutral: boolean }[];
}

/** foldr and foldl on the same list, bracketed, with the results and what decides whether they agree. */
export function Bracketing({ config }: { config: string }) {
  const t = useT().widget.bracketing;
  const cfg = useMemo(() => JSON.parse(config) as { ops: Op[] }, [config]);
  const [oi, setOi] = useState(0);
  const [si, setSi] = useState(0);
  const op = cfg.ops[oi]!;
  const start = op.starts[si] ?? op.starts[0]!;
  const list = `[${op.list.join(', ')}]`;
  const exprs = useMemo(() => cfg.ops.flatMap((o) => o.starts.flatMap((s) => [`foldr (${o.op}) ${arg(s.value)} [${o.list.join(', ')}]`, `foldl (${o.op}) ${arg(s.value)} [${o.list.join(', ')}]`])), [cfg]);
  const values = useEvaluate('', exprs);
  const at = cfg.ops.slice(0, oi).reduce((sum, o) => sum + o.starts.length * 2, 0) + si * 2;
  const shown = (i: number) => {
    const r = values.data?.[i];
    return r?.ok ? r.value : r ? '⚠' : '…';
  };
  const vr = shown(at);
  const vl = shown(at + 1);
  const equal = values.data ? vr === vl : null;

  // foldr: x1 op (x2 op (x3 op e)); foldl: ((e op x1) op x2) op x3
  let r = start.value;
  op.list.slice().reverse().forEach((x, i) => (r = `${x} ${op.op} ${i ? `(${r})` : r}`));
  let l = start.value;
  op.list.forEach((x, i) => (l = `${i ? `(${l})` : l} ${op.op} ${x}`));

  const chip = (label: string, ok: boolean | null) => (
    <span className={clsx('inline-flex rounded-full border px-2.5 py-0.5 text-[13px] font-medium', ok === null ? 'border-line text-ink-3' : ok ? 'border-done/40 bg-done-soft text-done' : 'border-danger/40 bg-danger-soft text-danger')}>
      {label}: {ok === null ? '…' : ok ? t.yes : t.no}
    </span>
  );
  const message = !op.assoc ? t.notAssociative(op.op) : start.neutral ? t.monoid : equal ? t.commutative(op.op) : t.notNeutral;

  return (
    <Frame>
      <Row label={t.operation}>
        <Choice
          code
          options={cfg.ops.map((o) => `(${o.op})`)}
          at={oi}
          onPick={(i) => {
            setOi(i);
            setSi(0);
          }}
          label={t.operation}
        />
      </Row>
      <Row label={t.start}>
        <Choice code options={op.starts.map((s) => s.value)} at={si} onPick={setSi} label={t.start} />
      </Row>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 overflow-x-auto rounded-md border border-line bg-sunk px-4 py-2.5 font-mono text-[13.5px] leading-relaxed">
        <Line label="foldr" call={`foldr (${op.op}) ${arg(start.value)} ${list}`} expr={r} value={vr} />
        <Line label="foldl" call={`foldl (${op.op}) ${arg(start.value)} ${list}`} expr={l} value={vl} />
      </div>
      <div className="flex flex-wrap gap-2">
        {chip(t.associative, op.assoc)}
        {chip(t.neutral, start.neutral)}
        {chip(t.equal, equal)}
      </div>
      <p className="text-[14.5px]">
        <Message text={message} />
      </p>
    </Frame>
  );
}

function Line({ label, call, expr, value }: { label: string; call: string; expr: string; value: string }): ReactNode {
  return (
    <>
      <span className="pt-px text-right font-sans text-[12.5px] leading-[1.9] text-ink-3">{label}</span>
      <span className="whitespace-nowrap">
        <Code>{call}</Code>
        <span className="text-ink-3"> = </span>
        <Code>{expr}</Code>
        <span className="text-ink-3"> = </span>
        <b className="font-semibold text-accent">{value}</b>
      </span>
    </>
  );
}
