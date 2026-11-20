import { RotateCcw } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  buildMap,
  EvalPathError,
  findRedexes,
  loadSpec,
  modelMatters,
  pickRedex,
  printTerm,
  reduce,
  termLevel,
  type EvalMap,
  type Model,
  type Pos,
  type Program,
  type Redex,
  type State,
  type StrategyId,
  type Term,
} from '@wb/shared';
import { useT } from '@/lib/i18n';
import { clsx } from '../ui';
import { EvalMapView } from './EvalMap';
import { Choice, Frame, Message, shake } from './index';

interface Config {
  rule: StrategyId | 'free' | 'show';
  map?: boolean;
  explain?: { inner?: string; outer?: string; left?: string; done?: string };
}

const posKey = (p: Pos) => `${p.bind ?? 'b'}:${p.path.join('.')}`;

/**
 * The evaluation of a small program, one reduction at a time. The current term shows its redexes as buttons;
 * for a rule the student clicks the one the rule picks. A wrong click costs nothing and is not counted.
 */
export function EvalPath({ defs, start, config }: { defs: string; start: string; config: string }) {
  const t = useT().widget.evalPath;
  const cfg = useMemo(() => JSON.parse(config) as Config, [config]);
  const spec = useMemo(() => {
    try {
      return loadSpec(defs, start);
    } catch (e) {
      if (e instanceof EvalPathError) return e.message;
      throw e;
    }
  }, [defs, start]);
  if (typeof spec === 'string')
    return (
      <Frame>
        <p className="text-sm text-danger">{t.bad(spec)}</p>
      </Frame>
    );
  if (cfg.rule === 'show' || cfg.map) return <WithMap prog={spec.prog} first={spec.start} cfg={cfg} />;
  return <Walk prog={spec.prog} first={spec.start} cfg={cfg} />;
}

function WithMap({ prog, first, cfg }: { prog: Program; first: State; cfg: Config }) {
  const t = useT().widget.evalPath;
  const map = useMemo(() => {
    try {
      return buildMap(prog, first);
    } catch (e) {
      if (e instanceof EvalPathError) return e.message;
      throw e;
    }
  }, [prog, first]);
  const [walked, setWalked] = useState<State[]>([first]);
  if (typeof map === 'string')
    return (
      <Frame>
        <p className="text-sm text-danger">{t.bad(map)}</p>
      </Frame>
    );
  if (cfg.rule === 'show')
    return (
      <Frame>
        <p className="font-mono text-[17px]">{printTerm(first.body)}</p>
        <p className="text-[13px] text-ink-3">{t.showLead}</p>
        <EvalMapView map={map} walked={[]} />
      </Frame>
    );
  return <Walk prog={prog} first={first} cfg={cfg} map={map} onWalk={setWalked} walked={walked} />;
}

function Walk({ prog, first, cfg, map, walked, onWalk }: { prog: Program; first: State; cfg: Config; map?: EvalMap; walked?: State[]; onWalk?: (w: State[]) => void }) {
  const t = useT().widget.evalPath;
  const [cur, setCur] = useState(first);
  const [history, setHistory] = useState<State[]>([]);
  const [share, setShare] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const free = cfg.rule === 'free';
  const redexes = useMemo(() => findRedexes(cur), [cur]);
  const byKey = useMemo(() => new Map(redexes.map((r) => [posKey(r.pos), r])), [redexes]);
  const finished = redexes.length === 0;
  const model: Model = cfg.rule === 'outermostShared' || (free && share) ? 'share' : 'copy';

  const click = (r: Redex, el: Element | null) => {
    if (finished) return;
    if (!free) {
      const want = pickRedex(cfg.rule as StrategyId, cur)!;
      const wantR = byKey.get(posKey(want.pos))!;
      if (posKey(want.pos) !== posKey(r.pos)) {
        const text =
          cfg.rule === 'innermost'
            ? r.depth < wantR.depth
              ? (cfg.explain?.inner ?? t.inner)
              : (cfg.explain?.left ?? t.left)
            : r.depth > wantR.depth
              ? (cfg.explain?.outer ?? t.outer)
              : (cfg.explain?.left ?? t.left);
        setMsg(text);
        shake(el);
        return;
      }
    }
    const next = reduce(prog, cur, r.pos, model);
    setHistory([...history, cur]);
    setCur(next);
    onWalk?.([...history, cur, next]);
    setMsg(null);
    setHover(null);
  };

  const reset = () => {
    setCur(first);
    setHistory([]);
    setMsg(null);
    onWalk?.([first]);
  };

  const view = (term: Term, bind: number | null, path: number[], need: number): ReactNode => {
    const pos: Pos = { bind, path };
    const r = byKey.get(posKey(pos));
    const inner = ((): ReactNode => {
      switch (term.k) {
        case 'num':
        case 'var':
          return printTerm(term);
        case 'app':
          return (
            <>
              {term.f}
              {term.args.map((a, i) => (
                <span key={i}> {view(a, bind, [...path, i], 4)}</span>
              ))}
            </>
          );
        case 'op':
          return (
            <>
              {view(term.l, bind, [...path, 0], 3)} {term.op} {view(term.r, bind, [...path, 1], 3)}
            </>
          );
        default:
          return null;
      }
    })();
    const wrapped = termLevel(term) < need ? <>({inner})</> : inner;
    if (!r || finished) return wrapped;
    const k = posKey(pos);
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={printTerm(term)}
        onMouseOver={(e) => {
          e.stopPropagation();
          setHover(k);
        }}
        onMouseOut={() => setHover(null)}
        onFocus={(e) => {
          e.stopPropagation();
          setHover(k);
        }}
        onBlur={() => setHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          click(r, e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            click(r, e.currentTarget);
          }
        }}
        className={clsx(
          'cursor-pointer rounded px-0.5 outline-none ring-1 ring-line-strong focus-visible:ring-2 focus-visible:ring-accent',
          hover === k ? 'bg-accent-soft ring-accent' : 'bg-sheet',
        )}
      >
        {wrapped}
      </span>
    );
  };

  const canShareChoice = free && redexes.some((r) => r.kind === 'call' && modelMatters(cur, r.pos));
  const value = printTerm(cur.body);

  return (
    <Frame>
      <p className="text-[13px] text-ink-3">{t.rules[cfg.rule as Exclude<Config["rule"], "show">]}</p>
      <div className="font-mono text-[17px] leading-9" aria-live="polite">
        <div>{view(cur.body, null, [], 0)}</div>
        {cur.binds.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5 text-[15px] text-ink-2">
            {cur.binds.map((b, i) => (
              <div key={b.name}>
                <span className="mr-2 font-sans text-[12px] text-ink-3">{t.shared}</span>
                {b.name} = {view(b.term, i, [], 0)}
              </div>
            ))}
          </div>
        )}
      </div>
      {finished ? (
        <p className="rounded-md bg-done-soft px-3 py-2 text-sm">
          <Message text={cfg.explain?.done ?? t.done(value)} /> {free && t.doneFree}
        </p>
      ) : (
        <p className={clsx('min-h-5 text-sm', msg ? 'text-danger' : 'text-ink-3')}>{msg ?? (free ? t.leadFree : t.lead)}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {canShareChoice && !finished && <Choice options={[t.copy, t.share]} at={share ? 1 : 0} onPick={(i) => setShare(i === 1)} />}
        <button type="button" onClick={reset} disabled={history.length === 0} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-ink-2 hover:text-ink disabled:opacity-40">
          <RotateCcw size={14} /> {t.reset}
        </button>
      </div>
      {map && <EvalMapView map={map} walked={walked ?? []} />}
    </Frame>
  );
}
