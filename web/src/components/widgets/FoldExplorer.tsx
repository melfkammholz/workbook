import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { arg, fieldVars, foldSetup, planFold, type FoldPlan } from '@/lib/foldSignature';
import { useT } from '@/lib/i18n';
import { clsx } from '../ui';
import { kClass } from './FoldSignature';
import { Choice, Code, Frame } from './index';
import { useEvaluate } from './useEvaluate';

interface Config {
  values: string[];
  /** Type of the values, e.g. `Maybe Int`, so the interpreter need not guess. */
  type: string | null;
  /** Per result type: for each constructor, bodies of its function to choose from. */
  results: ({ type: string } & Record<string, string[] | string>)[];
  fold: string | null;
}

/**
 * Pick a value and an answer for every constructor: the fold picks the line, the line answers.
 * The fold is written from the declaration, and the interpreter computes the results.
 */
export function FoldExplorer({ decl, config }: { decl: string; config: string }) {
  const t = useT().widget;
  const cfg = useMemo(() => JSON.parse(config) as Config, [config]);
  const plan = useMemo(() => planFold(decl, cfg.fold ?? undefined), [decl, cfg.fold]);
  if ('error' in plan || !cfg.values.length || !cfg.results.length) {
    return (
      <Frame>
        <p className="text-sm text-danger">{t.badDecl('error' in plan ? plan.error : 'values and results are needed')}</p>
      </Frame>
    );
  }
  return <Explorer plan={plan} decl={decl} cfg={cfg} />;
}

const options = (r: Config['results'][number], name: string) => {
  const o = r[name];
  return Array.isArray(o) ? o : typeof o === 'string' ? [o] : [];
};

/** The constructor a value starts with. */
const headOf = (plan: FoldPlan, value: string) => plan.constructors.findIndex((c) => value.trim().split(/[\s(]/)[0] === c.name);
/** The fields of a value, as written: `Just 3` → `3`, `Left "abc"` → `"abc"`. */
function fieldsOf(value: string): string[] {
  const rest = value.trim().replace(/^\S+\s*/, '');
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote = false;
  for (const ch of rest) {
    if (ch === '"') quote = !quote;
    if (!quote && (ch === '(' || ch === '[')) depth++;
    if (!quote && (ch === ')' || ch === ']')) depth--;
    if (!quote && depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
/** A body with the fields' names replaced by the values: `x + 1` with x = 3 → `3 + 1`. */
const substitute = (body: string, vars: string[], args: string[]) =>
  vars.reduce((b, v, i) => b.replace(new RegExp(`(?<![\\w'])${v}(?![\\w'])`, 'g'), args[i] ?? v), body);
const fnOf = (body: string, vars: string[]) => (vars.length ? `(\\${vars.join(' ')} -> ${body})` : arg(body));

function Explorer({ plan, decl, cfg }: { plan: FoldPlan; decl: string; cfg: Config }) {
  const t = useT().widget.explorer;
  const cons = plan.constructors;
  const [vi, setVi] = useState(Math.min(1, cfg.values.length - 1));
  const [ri, setRi] = useState(0);
  const [picks, setPicks] = useState<number[]>(() => cons.map(() => 0));
  const result = cfg.results[ri]!;
  const value = cfg.values[vi]!;
  const ci = headOf(plan, value);
  const args = fieldsOf(value);

  // Every combination is asked at once: there are few, and choosing then answers at once.
  const setup = useMemo(() => foldSetup(plan, decl), [plan, decl]);
  const expr = (v: string, r: Config['results'][number], ps: number[]) =>
    `${plan.fold} ${cons.map((c, i) => fnOf(options(r, c.name)[ps[i]!] ?? 'undefined', fieldVars(c.fields.length))).join(' ')} (${v}${cfg.type ? ` :: ${cfg.type}` : ''})`;
  const combos = useMemo(() => {
    const out: string[] = [];
    for (const r of cfg.results) {
      const counts = cons.map((c) => Math.max(1, options(r, c.name).length));
      const walk = (i: number, ps: number[]) => {
        if (i === cons.length) for (const v of cfg.values) out.push(expr(v, r, ps));
        else for (let k = 0; k < counts[i]!; k++) walk(i + 1, [...ps, k]);
      };
      walk(0, []);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, cons]);
  const evaluated = useEvaluate(setup, combos);
  const current = expr(value, result, picks);
  const answer = evaluated.data?.[combos.indexOf(current)];

  // Arrows: value → the line that matches → result.
  const board = useRef<HTMLDivElement>(null);
  const valueBox = useRef<HTMLDivElement>(null);
  const resultBox = useRef<HTMLDivElement>(null);
  const lines = useRef<(HTMLDivElement | null)[]>([]);
  const [paths, setPaths] = useState<{ d: string; head: string; color: string }[]>([]);
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = board.current;
    const line = lines.current[ci];
    if (!el || !line || !valueBox.current || !resultBox.current) return setPaths([]);
    const b = el.getBoundingClientRect();
    const side = (from: DOMRect, to: DOMRect, color: string) => {
      const x1 = from.right - b.left;
      const y1 = from.top + from.height / 2 - b.top;
      const x2 = to.left - b.left - 7;
      const y2 = to.top + to.height / 2 - b.top;
      if (x2 < x1 + 10) return null; // stacked: the colours say enough
      const mx = (x1 + x2) / 2;
      return { d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, head: `${x2 + 7},${y2} ${x2},${y2 - 5} ${x2},${y2 + 5}`, color };
    };
    const l = line.getBoundingClientRect();
    setPaths(
      [side(valueBox.current.getBoundingClientRect(), l, 'var(--k)'), side(l, resultBox.current.getBoundingClientRect(), 'var(--accent)')].filter(
        (x): x is NonNullable<typeof x> => x !== null,
      ),
    );
  }, [ci, vi, ri, picks, tick]);

  const k = ci >= 0 ? kClass(ci) : 'wb-kr';
  const shown = answer?.ok ? answer.value : answer ? '⚠' : '…';

  return (
    <Frame>
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
        <span className="text-[13px] text-ink-3">{t.input}</span>
        <Choice options={cfg.values} at={vi} onPick={setVi} code label={t.input} />
        {cfg.results.length > 1 ? (
          <>
            <span className="text-[13px] text-ink-3">{t.resultType}</span>
            <Choice
              code
              label={t.resultType}
              options={cfg.results.map((r) => r.type)}
              at={ri}
              onPick={(i) => {
                setRi(i);
                setPicks(cons.map(() => 0));
              }}
            />
          </>
        ) : null}
        {cons.map((c, i) => {
          const vars = fieldVars(c.fields.length);
          return (
            <ConstructorRow key={c.name} k={kClass(i)} head={[c.paramName, ...vars].join(' ') + ' ='}>
              <Choice code label={c.paramName} options={options(result, c.name)} at={picks[i]!} onPick={(p) => setPicks((ps) => ps.map((x, j) => (j === i ? p : x)))} />
            </ConstructorRow>
          );
        })}
      </div>

      <div className="overflow-x-auto pb-1">
        <div ref={board} className="relative grid min-w-[34rem] grid-cols-[minmax(6rem,1fr)_minmax(13rem,1.7fr)_minmax(6rem,1fr)] items-center gap-12">
          <div ref={valueBox} className={clsx(k, 'relative flex flex-col items-center gap-0.5 rounded-lg border px-2 py-3.5 text-center')} style={{ background: 'var(--ks)', borderColor: 'color-mix(in srgb, var(--k) 35%, transparent)' }}>
            <span className="font-mono text-base font-semibold" style={{ color: 'var(--k)' }}>
              {value}
            </span>
            {cfg.type ? <span className="font-mono text-xs text-ink-3">:: {cfg.type}</span> : null}
          </div>
          <div className="relative flex flex-col gap-2 rounded-xl border-[1.5px] border-line-strong bg-sheet p-2.5">
            <span className="font-mono text-[12.5px] font-semibold text-ink-2">
              {plan.fold} {cons.map((c) => c.paramName).join(' ')}
            </span>
            {cons.map((c, i) => {
              const vars = fieldVars(c.fields.length);
              const on = i === ci;
              const body = options(result, c.name)[picks[i]!] ?? '';
              return (
                <div
                  key={c.name}
                  ref={(el) => {
                    lines.current[i] = el;
                  }}
                  className={clsx(kClass(i), 'flex flex-col gap-px rounded-md border px-3 py-2 transition-[opacity,background-color] duration-300', on ? '' : 'border-line opacity-55')}
                  style={on ? { background: 'var(--ks)', borderColor: 'var(--k)' } : undefined}
                >
                  <span className="font-mono text-[13px] font-semibold" style={{ color: 'var(--k)' }}>
                    {[c.name, ...(on ? args : vars)].join(' ')} -&gt; {[c.paramName, ...(on ? args : vars)].join(' ')}
                  </span>
                  <span className="font-mono text-[14px]">
                    <Code>{on ? substitute(body, vars, args) : body}</Code>
                    {on && answer?.ok ? <span className="text-ink-2"> = {answer.value}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
          <div ref={resultBox} className="relative flex flex-col items-center gap-0.5 rounded-lg bg-accent px-2 py-3.5 text-center text-accent-ink" aria-live="polite">
            <span key={shown} className="wb-flip font-mono text-base font-semibold break-all">
              {shown}
            </span>
            <span className="font-mono text-xs opacity-75">:: {result.type}</span>
          </div>
          <svg aria-hidden className={clsx(k, 'pointer-events-none absolute inset-0 z-10 size-full overflow-visible')}>
            {paths.map((p, i) => (
              <g key={`${i}-${ci}-${vi}`}>
                <path d={p.d} pathLength={1} className="wb-arrow" fill="none" strokeWidth={2} strokeLinecap="round" style={{ stroke: p.color }} />
                <polygon points={p.head} className="wb-arrow-head" style={{ fill: p.color }} />
              </g>
            ))}
          </svg>
        </div>
      </div>

      <p className="text-center font-mono text-[14px] leading-relaxed [overflow-wrap:anywhere]">
        <Code>{current.replace(/ :: [^)]*\)$/, ')')}</Code>
        {answer?.ok ? (
          <>
            {' '}
            = <b className="text-accent">{answer.value}</b>
          </>
        ) : null}
      </p>
      {evaluated.isError || (answer && !answer.ok) ? <p className="text-[13.5px] text-ink-3">{t.failed}</p> : evaluated.isPending ? <p className="text-[13.5px] text-ink-3">{t.computing}</p> : null}
    </Frame>
  );
}

function ConstructorRow({ k, head, children }: { k: string; head: string; children: React.ReactNode }) {
  return (
    <>
      <span className={clsx(k, 'font-mono text-[13px] font-semibold')} style={{ color: 'var(--k)' }}>
        {head}
      </span>
      {children}
    </>
  );
}
