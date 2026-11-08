import { Pause, Play } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { arg, foldSetup, isAtomic, parseValue, planFold, show, simplify, type FoldPlan, type Term } from '@/lib/foldSignature';
import { useT } from '@/lib/i18n';
import { clsx } from '../ui';
import { kClass } from './FoldSignature';
import { nodeOf, postOrder, TreePicture, type Node } from './FoldTree';
import { Choice, Code, Frame, Message, Row, StepBar, shake } from './index';
import { useEvaluate } from './useEvaluate';

interface Fold {
  name: string;
  /** For each constructor, the function passed for it. */
  functions: Record<string, string>;
  note?: string | null;
}

interface Config {
  value: string;
  type: string | null;
  fold: string | null;
  folds: Fold[];
  /** Answers to offer before folding. The right one is whatever the interpreter computes. */
  predict: string[] | null;
}

/**
 * A fold, computed step by step on a tree: first every constructor is replaced by its function, then the
 * tree folds together from the leaves. Before a node is applied, what can be worked out of its function is
 * (`(\_ -> sum) "y"` is `sum`). Results come from the interpreter, and so does which parts are never needed.
 */
export function FoldSteps({ decl, config }: { decl: string; config: string }) {
  const t = useT().widget;
  const cfg = useMemo(() => JSON.parse(config) as Config, [config]);
  const plan = useMemo(() => planFold(decl, cfg.fold ?? undefined), [decl, cfg.fold]);
  const term = useMemo(() => ('error' in plan ? plan : parseValue(cfg.value, plan)), [plan, cfg.value]);
  if ('error' in plan || 'error' in term || !cfg.folds?.length) {
    return (
      <Frame>
        <p className="text-sm text-danger">{t.badDecl('error' in plan ? plan.error : 'error' in term ? term.error : 'folds are needed')}</p>
      </Frame>
    );
  }
  return <Steps plan={plan} decl={decl} cfg={cfg} root={term} />;
}

type Step = { kind: 'value' } | { kind: 'rename' } | { kind: 'replace' } | { kind: 'simplify'; n: Node; to: string } | { kind: 'apply'; n: Node };

/** A term with one subterm replaced by `undefined`: does the result still come out without it? */
function without(t: Term, target: Term): Term {
  if (t === target) return { ci: null, text: 'undefined', children: [] };
  return { ...t, children: t.children.map((c) => without(c, target)) };
}

const same = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

function Steps({ plan, decl, cfg, root }: { plan: FoldPlan; decl: string; cfg: Config; root: Term }) {
  const t = useT().widget.foldSteps;
  const cons = plan.constructors;
  const tree = useMemo(() => nodeOf(root), [root]);
  const order = useMemo(() => postOrder(tree), [tree]);
  const nodeOfTerm = useMemo(() => {
    const m = new Map<Term, Node>();
    const walk = (n: Node) => {
      m.set(n.term, n);
      n.children.forEach(walk);
    };
    walk(tree);
    return m;
  }, [tree]);

  const [fi, setFi] = useState(0);
  const fold = cfg.folds[fi]!;
  const fnOf = (n: Node) => fold.functions[cons[n.term.ci!]!.name] ?? 'undefined';
  const fns = cons.map((c) => arg(fold.functions[c.name] ?? 'undefined')).join(' ');
  const typed = (src: string) => (cfg.type ? `(${src} :: ${cfg.type})` : arg(src));

  // Every subtree's value, and for every subtree whether the whole still comes out without it.
  const setup = useMemo(() => foldSetup(plan, decl), [plan, decl]);
  const others = order.filter((n) => n !== tree);
  const exprs = useMemo(
    () => [...order.map((n) => `${plan.fold} ${fns} ${typed(show(n.term))}`), ...others.map((n) => `${plan.fold} ${fns} ${typed(show(without(root, n.term)))}`)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, fns],
  );
  const evaluated = useEvaluate(setup, exprs);
  const valueOf = (n: Node) => {
    const r = evaluated.data?.[order.indexOf(n)];
    return r?.ok ? r.value : r ? '⚠' : '…';
  };
  const rootValue = evaluated.data?.[order.indexOf(tree)];
  /** Subtrees the result does not depend on, and everything inside them. */
  const unused = useMemo(() => {
    const out = new Set<Node>();
    if (!evaluated.data || !rootValue?.ok) return out;
    const mark = (n: Node) => {
      out.add(n);
      n.children.forEach(mark);
    };
    others.forEach((n, i) => {
      const r = evaluated.data![order.length + i];
      if (r?.ok && same(r.value, rootValue.value)) mark(n);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluated.data, fi]);

  /** The fields a function can take before its first recursive one: what simplifying works with. */
  const leading = (n: Node) => {
    const c = cons[n.term.ci!]!;
    const first = c.recursive.indexOf(true);
    return first > 0 ? n.term.children.slice(0, first) : [];
  };
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [{ kind: 'value' }, { kind: 'rename' }, { kind: 'replace' }];
    for (const n of order) {
      if (unused.has(n)) continue;
      const args = leading(n);
      const to = args.length ? simplify(fnOf(n), args.map((a) => show(a))) : null;
      if (to !== null) out.push({ kind: 'simplify', n, to });
      // A step that changes nothing is no step: `fempty = 0` is already its value.
      if (n.term.children.length === 0 && evaluated.data && same(valueOf(n), fnOf(n))) continue;
      out.push({ kind: 'apply', n });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, unused, fi, evaluated.data]);

  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = steps.length - 1;
  const k = Math.min(at, last);
  useEffect(() => {
    if (!playing) return;
    if (k >= last) return setPlaying(false);
    const id = setTimeout(() => setAt(k + 1), 1100);
    return () => clearTimeout(id);
  }, [playing, k, last]);

  const past = steps.slice(0, k + 1);
  const renamed = k >= 1;
  const replaced = k >= 2;
  const simplified = new Map(past.flatMap((s) => (s.kind === 'simplify' ? [[s.n, s.to] as const] : [])));
  const done = new Set(past.flatMap((s) => (s.kind === 'apply' ? [s.n] : [])));
  const current = steps[k]!;
  const now = current.kind === 'apply' || current.kind === 'simplify' ? current.n : null;
  /** Fields a simplified function has taken: they are part of it now. */
  const gone = new Set<Node>();
  for (const n of simplified.keys()) leading(n).forEach((a) => gone.add(nodeOfTerm.get(a)!));

  const head = (n: Node) => simplified.get(n) ?? fnOf(n);
  /** All labels a node goes through in this fold: the tree is laid out for the widest from the start. */
  const widest = (n: Node) => {
    if (n.term.ci === null) return n.term.text;
    const to = steps.find((x): x is Extract<Step, { kind: 'simplify' }> => x.kind === 'simplify' && x.n === n)?.to ?? '';
    const labels = [n.term.text, cons[n.term.ci]!.paramName, fnOf(n), to, evaluated.data ? valueOf(n) : ''];
    return labels.reduce((a, b) => (b.length > a.length ? b : a), '');
  };
  const label = (n: Node) => {
    if (n.term.ci === null) return n.term.text;
    if (!renamed) return n.term.text;
    if (!replaced) return cons[n.term.ci]!.paramName;
    return head(n);
  };

  /** The expression at a step: what has been computed shows as its value. */
  const expressionAt = (upto: number): ReactNode => {
    const ps = steps.slice(0, upto + 1);
    const simp = new Map(ps.flatMap((s) => (s.kind === 'simplify' ? [[s.n, s.to] as const] : [])));
    const fin = new Set(ps.flatMap((s) => (s.kind === 'apply' ? [s.n] : [])));
    const fresh = steps[upto]?.kind === 'apply' ? (steps[upto] as { n: Node }).n : null;
    if (upto === 0) return <Code>{show(root)}</Code>;
    const ex = (term: Term): { node: ReactNode; text: string } => {
      const n = nodeOfTerm.get(term);
      if (n && fin.has(n)) {
        const v = valueOf(n);
        return { node: <b className={clsx('font-semibold text-accent', n === fresh && 'rounded bg-accent-soft px-0.5')}>{v}</b>, text: v };
      }
      if (term.list) {
        const items = term.children.map(ex);
        return { node: <>[{items.map((x, i) => <Fragment key={i}>{i ? ', ' : ''}{x.node}</Fragment>)}]</>, text: `[${items.map((x) => x.text).join(', ')}]` };
      }
      if (term.ci === null) return { node: <Code>{term.text}</Code>, text: term.text };
      const s = n ? simp.get(n) : undefined;
      const fields = s !== undefined && n ? term.children.slice(leading(n).length) : term.children;
      const h = s ?? (n ? (upto === 1 ? cons[term.ci]!.paramName : fnOf(n)) : term.text);
      const args = fields.map(ex);
      const headText = args.length ? arg(h) : h;
      const parts: ReactNode[] = [
        <span key="h" className={clsx(kClass(term.ci), 'font-semibold')} style={{ color: 'var(--k)' }}>
          {headText}
        </span>,
      ];
      args.forEach((a, i) => {
        const wrap = !isAtomic(a.text);
        parts.push(
          <Fragment key={i}>
            {' '}
            {wrap ? '(' : ''}
            {a.node}
            {wrap ? ')' : ''}
          </Fragment>,
        );
      });
      return { node: <>{parts}</>, text: [headText, ...args.map((a) => (isAtomic(a.text) ? a.text : `(${a.text})`))].join(' ') };
    };
    return ex(root).node;
  };

  /** The one application a step computes: the function and the values of its fields. */
  const callOf = (n: Node) => {
    const s = simplified.get(n);
    const fields = s !== undefined ? n.term.children.slice(leading(n).length) : n.term.children;
    const args = fields.map((f) => {
      if (f.list) return `[${f.children.map((c) => valueOf(nodeOfTerm.get(c)!)).join(', ')}]`;
      const child = nodeOfTerm.get(f);
      return child && child.term.ci !== null ? valueOf(child) : f.text;
    });
    const h = s ?? fnOf(n);
    return args.length ? [arg(h), ...args.map(arg)].join(' ') : h;
  };

  const say =
    current.kind === 'value' ? t.value
    : current.kind === 'rename' ? t.renamed
    : current.kind === 'replace' ? t.replaced
    : current.kind === 'simplify' ? t.simplified([arg(fnOf(current.n)), ...leading(current.n).map((a) => arg(show(a)))].join(' '), current.to)
    : `${k === last ? `${t.done} ` : ''}${t.applied(callOf(current.n), valueOf(current.n))}`;

  // Guess first: the right answer is what the interpreter says.
  const call = `${plan.fold} ${fns} ${arg(cfg.value)}`;
  const answer = rootValue?.ok ? rootValue.value : null;
  const options = cfg.predict && answer !== null && cfg.predict.some((o) => same(o, answer)) ? cfg.predict : null;
  const [guess, setGuess] = useState<{ i: number; right: boolean } | null>(null);
  const [tried, setTried] = useState<number[]>([]);

  const pick = (i: number) => {
    setFi(i);
    setAt(0);
    setPlaying(false);
    setGuess(null);
    setTried([]);
  };

  return (
    <Frame>
      {cfg.folds.length > 1 ? (
        <Row label={t.fold}>
          <Choice options={cfg.folds.map((f) => f.name)} at={fi} onPick={pick} label={t.fold} />
        </Row>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13.5px] font-medium">
        {cons.map((c, i) => (
          <span key={c.name} className={kClass(i)} style={{ color: 'var(--k)' }}>
            {c.paramName} = {fold.functions[c.name]}
          </span>
        ))}
      </p>

      {options ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3">
          <p className="text-[14.5px] font-semibold">
            <Message text={t.ask(call)} />
          </p>
          <div className="flex flex-wrap gap-1.5">
            {options.map((o, i) => {
              const right = same(o, answer!);
              const solved = guess?.right;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!!solved}
                  onClick={(e) => {
                    setGuess({ i, right });
                    if (right) setPlaying(true);
                    else {
                      setTried((x) => [...x, i]);
                      shake(e.currentTarget);
                    }
                  }}
                  className={clsx(
                    'rounded-md border px-3 py-1 font-mono text-[13.5px]',
                    solved && right ? 'border-done bg-done-soft font-semibold' : tried.includes(i) ? 'border-danger bg-danger-soft' : 'border-line-strong bg-sheet hover:border-accent',
                    solved && !right && 'opacity-60',
                  )}
                >
                  {o}
                </button>
              );
            })}
          </div>
          {guess ? <p className="text-[14px] text-ink-2">{guess.right ? t.right : t.wrong}</p> : null}
        </div>
      ) : null}

      <div className="rounded-md border border-line bg-paper p-2">
        <TreePicture tree={tree} label={label} done={done} valueOf={valueOf} aria={show(root)} dim={unused} now={now} gone={gone} widest={widest} />
      </div>

      <StepBar
        at={k}
        count={steps.length}
        label={k === 0 ? t.rowValue : k === 1 ? t.rowReplaced : k === 2 ? t.rowInserted : undefined}
        onGo={(i) => {
          setPlaying(false);
          setAt(i);
        }}
        extra={
          <button
            type="button"
            aria-label={playing ? t.pause : t.play}
            title={playing ? t.pause : t.play}
            onClick={() => {
              if (playing) return setPlaying(false);
              if (k >= last) setAt(0);
              setPlaying(true);
            }}
            className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink"
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
        }
      />

      <p className="min-h-[1.5em] text-[14.5px]" aria-live="polite">
        <Message text={say} />
        {k === last && fold.note ? <span className="text-ink-2"> {fold.note}</span> : null}
      </p>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 overflow-x-auto rounded-md border border-line bg-sunk px-4 py-2.5 font-mono text-[13.5px] leading-relaxed">
        {steps.map((s, i) => (
          <Fragment key={i}>
            <span className={clsx('text-right font-sans text-[12.5px] leading-[1.9] text-ink-3', i > k && 'invisible')}>{i === 0 ? t.rowValue : i === 1 ? t.rowReplaced : i === 2 ? t.rowInserted : '='}</span>
            <span className={clsx('whitespace-nowrap', i > k ? 'invisible' : i < k ? 'opacity-55' : '')}>{expressionAt(i)}</span>
          </Fragment>
        ))}
      </div>
      {k === last && unused.size ? <p className="text-[13.5px] text-ink-3">{t.unused}</p> : null}
    </Frame>
  );
}
