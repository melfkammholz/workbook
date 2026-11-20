// Reduction of mini-language terms: redexes, single steps, strategies and the map of all paths.
// A term with sharing is a `State`: let-bindings floated to the top (unique names) plus a let-free body.

import { EvalPathError, isAtom, parseProgram, parseTerm, printTerm, checkTerm, type Op, type Program, type Term } from './term';

export interface Binding {
  name: string;
  term: Term;
}
export interface State {
  binds: Binding[];
  body: Term;
}

/** Where a subterm is: in the body (`bind` null) or in a binding, then child indices (call argument i, operator left 0 / right 1). */
export interface Pos {
  bind: number | null;
  path: number[];
}

/** `copy`: arguments are substituted as they are (and so evaluated once per use). `share`: non-atomic arguments become bindings. */
export type Model = 'copy' | 'share';
export type StrategyId = 'innermost' | 'outermost' | 'outermostShared';
export const STRATEGY_IDS: readonly StrategyId[] = ['innermost', 'outermost', 'outermostShared'];

export interface Redex {
  pos: Pos;
  kind: 'call' | 'arith';
  /** Nesting depth; a binding counts one deeper than the term that uses it. */
  depth: number;
  /** Position in reading order (body first, then bindings, left to right). */
  order: number;
}

// ───────────────────────── state helpers ─────────────────────────

const clone = <T,>(x: T): T => structuredClone(x);

/** Floats `let`s to the top, renaming them to unique names. */
function inst(t: Term, env: Map<string, Term>, used: Set<string>, binds: Binding[]): Term {
  switch (t.k) {
    case 'num':
      return t;
    case 'var':
      return env.get(t.name) ?? t;
    case 'app':
      return { k: 'app', f: t.f, args: t.args.map((a) => inst(a, env, used, binds)) };
    case 'op':
      return { k: 'op', op: t.op, l: inst(t.l, env, used, binds), r: inst(t.r, env, used, binds) };
    case 'let': {
      const b = inst(t.bound, env, used, binds);
      const inner = new Map(env);
      if (isAtom(b)) inner.set(t.name, b);
      else {
        const name = fresh(t.name, used);
        binds.push({ name, term: b });
        inner.set(t.name, { k: 'var', name });
      }
      return inst(t.body, inner, used, binds);
    }
  }
}

function fresh(base: string, used: Set<string>): string {
  let name = base;
  for (let i = 1; used.has(name); i++) name = `${base}${i}`;
  used.add(name);
  return name;
}

export function startState(prog: Program, src: string): State {
  const t = parseTerm(src);
  checkTerm(prog, t, new Set(), `in "${src}"`);
  const binds: Binding[] = [];
  const body = inst(t, new Map(), new Set(), binds);
  return gc({ binds, body });
}

function varsOf(t: Term, out: Set<string>): void {
  if (t.k === 'var') out.add(t.name);
  else if (t.k === 'app') t.args.forEach((a) => varsOf(a, out));
  else if (t.k === 'op') {
    varsOf(t.l, out);
    varsOf(t.r, out);
  }
}

/** Drops bindings nothing refers to any more (they would never be evaluated). */
function gc(s: State): State {
  const live = new Set<string>();
  varsOf(s.body, live);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of s.binds) {
      if (live.has(b.name)) {
        const before = live.size;
        varsOf(b.term, live);
        if (live.size > before) grew = true;
      }
    }
  }
  return { binds: s.binds.filter((b) => live.has(b.name)), body: s.body };
}

export function stateParts(s: State): { main: string; bindings: { name: string; text: string }[] } {
  return { main: printTerm(s.body), bindings: s.binds.map((b) => ({ name: b.name, text: printTerm(b.term) })) };
}

/** Text form like `x + x, x = inc 3`. */
export function printState(s: State): string {
  const p = stateParts(s);
  return [p.main, ...p.bindings.map((b) => `${b.name} = ${b.text}`)].join(', ');
}

export const stateKey = (s: State): string => `${printTerm(s.body)} | ${[...s.binds].sort((a, b) => (a.name < b.name ? -1 : 1)).map((b) => `${b.name}=${printTerm(b.term)}`).join(';')}`;

export function termAt(s: State, pos: Pos): Term {
  let t = pos.bind === null ? s.body : s.binds[pos.bind]!.term;
  for (const i of pos.path) t = t.k === 'app' ? t.args[i]! : t.k === 'op' ? (i === 0 ? t.l : t.r) : t;
  return t;
}

function replaceIn(t: Term, path: number[], by: Term): Term {
  if (!path.length) return by;
  const [i, ...rest] = path;
  if (t.k === 'app') return { ...t, args: t.args.map((a, j) => (j === i ? replaceIn(a, rest, by) : a)) };
  if (t.k === 'op') return i === 0 ? { ...t, l: replaceIn(t.l, rest, by) } : { ...t, r: replaceIn(t.r, rest, by) };
  throw new EvalPathError('Invalid position');
}

/** Numeric value of a literal, or of a variable bound to one. */
function valueOf(s: State, t: Term): number | undefined {
  if (t.k === 'num') return t.n;
  if (t.k === 'var') {
    const b = s.binds.find((x) => x.name === t.name)?.term;
    return b?.k === 'num' ? b.n : undefined;
  }
  return undefined;
}

// ───────────────────────── redexes and steps ─────────────────────────

export function findRedexes(s: State): Redex[] {
  const out: Redex[] = [];
  const walk = (t: Term, pos: Pos) => {
    const depth = pos.path.length + (pos.bind === null ? 0 : 1);
    if (t.k === 'app') out.push({ pos, kind: 'call', depth, order: out.length });
    else if (t.k === 'op' && valueOf(s, t.l) !== undefined && valueOf(s, t.r) !== undefined) out.push({ pos, kind: 'arith', depth, order: out.length });
    if (t.k === 'app') t.args.forEach((a, i) => walk(a, { bind: pos.bind, path: [...pos.path, i] }));
    else if (t.k === 'op') {
      walk(t.l, { bind: pos.bind, path: [...pos.path, 0] });
      walk(t.r, { bind: pos.bind, path: [...pos.path, 1] });
    }
  };
  walk(s.body, { bind: null, path: [] });
  s.binds.forEach((b, i) => walk(b.term, { bind: i, path: [] }));
  return out;
}

const apply = (op: Op, a: number, b: number) => (op === '+' ? a + b : op === '-' ? a - b : a * b);

/** True when the call's arguments are not all atoms, i.e. when `copy` and `share` give different results. */
export function modelMatters(s: State, pos: Pos): boolean {
  const t = termAt(s, pos);
  return t.k === 'app' && t.args.some((a) => !isAtom(a));
}

export function reduce(prog: Program, s: State, pos: Pos, model: Model): State {
  const t = termAt(s, pos);
  let repl: Term;
  const binds = [...s.binds];
  if (t.k === 'op') {
    const a = valueOf(s, t.l);
    const b = valueOf(s, t.r);
    if (a === undefined || b === undefined) throw new EvalPathError(`No redex at this position: ${printTerm(t)}`);
    repl = { k: 'num', n: apply(t.op, a, b) };
  } else if (t.k === 'app') {
    const def = prog[t.f]!;
    const used = new Set(binds.map((b) => b.name));
    const env = new Map<string, Term>();
    def.params.forEach((p, i) => {
      const a = t.args[i]!;
      if (model === 'share' && !isAtom(a)) {
        const name = fresh(p, used);
        binds.push({ name, term: a });
        env.set(p, { k: 'var', name });
      } else env.set(p, a);
    });
    repl = inst(def.rhs, env, used, binds);
  } else throw new EvalPathError('No redex at this position');
  const next = clone({ binds, body: s.body });
  if (pos.bind === null) next.body = replaceIn(next.body, pos.path, repl);
  else {
    const b = next.binds[pos.bind]!;
    next.binds[pos.bind] = { name: b.name, term: replaceIn(b.term, pos.path, repl) };
  }
  return gc(next);
}

export const isNormal = (s: State): boolean => findRedexes(s).length === 0;

// ───────────────────────── strategies ─────────────────────────

/** Picks the redex for a strategy: innermost = deepest, outermost = shallowest, ties go to the leftmost. */
export function pickRedex(strategy: StrategyId, s: State): { pos: Pos; model: Model } | null {
  const rs = findRedexes(s);
  if (!rs.length) return null;
  const outer = strategy !== 'innermost';
  let best = rs[0]!;
  for (const r of rs) if (outer ? r.depth < best.depth : r.depth > best.depth) best = r;
  return { pos: best.pos, model: strategy === 'outermostShared' ? 'share' : 'copy' };
}

export interface Step {
  from: State;
  to: State;
  pos: Pos;
  model: Model;
}

export function runStrategy(prog: Program, start: State, strategy: StrategyId, maxSteps = 200): Step[] {
  const steps: Step[] = [];
  let cur = start;
  for (;;) {
    const pick = pickRedex(strategy, cur);
    if (!pick) return steps;
    if (steps.length >= maxSteps) throw new EvalPathError(`${strategy} does not reach a normal form within ${maxSteps} steps`);
    const to = reduce(prog, cur, pick.pos, pick.model);
    steps.push({ from: cur, to, pos: pick.pos, model: pick.model });
    cur = to;
  }
}

// ───────────────────────── the map ─────────────────────────

export interface MapNode {
  id: string;
  state: State;
  /** Distance from the start term (shortest path), for layering. */
  layer: number;
  normal: boolean;
}
export interface MapEdge {
  id: number;
  from: string;
  to: string;
  pos: Pos;
  kind: 'call' | 'arith';
  model: Model;
  /** The reduced subterm, printed. */
  redex: string;
}
export interface EvalMap {
  nodes: MapNode[];
  edges: MapEdge[];
  start: string;
  /** Ids of the nodes without redexes. */
  normalForms: string[];
  /** Edge ids per strategy, in order. */
  strategies: Record<StrategyId, number[]>;
}

export interface BuildOptions {
  maxNodes?: number;
  /** Among redexes of equal depth only the leftmost is offered (the prototype's restriction). Default true. */
  leftmostOnly?: boolean;
}

const effModel = (s: State, pos: Pos, m: Model): Model => (m === 'share' && modelMatters(s, pos) ? 'share' : 'copy');

/** All reachable terms and reductions. Throws `EvalPathError` when the map would exceed `maxNodes` (default 60). */
export function buildMap(prog: Program, start: State, opts: BuildOptions = {}): EvalMap {
  const maxNodes = opts.maxNodes ?? 60;
  const leftmostOnly = opts.leftmostOnly ?? true;
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const byKey = new Map<string, MapNode>();
  const edgeKey = new Map<string, number>();
  const add = (state: State, layer: number): MapNode => {
    const key = stateKey(state);
    let n = byKey.get(key);
    if (!n) {
      if (nodes.length >= maxNodes) throw new EvalPathError(`The map has more than ${maxNodes} terms; use a smaller example`);
      n = { id: `n${nodes.length}`, state, layer, normal: isNormal(state) };
      nodes.push(n);
      byKey.set(key, n);
    }
    return n;
  };
  add(start, 0);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const seenDepth = new Set<number>();
    for (const r of findRedexes(n.state)) {
      if (leftmostOnly) {
        if (seenDepth.has(r.depth)) continue;
        seenDepth.add(r.depth);
      }
      const models: Model[] = r.kind === 'call' && modelMatters(n.state, r.pos) ? ['copy', 'share'] : ['copy'];
      for (const model of models) {
        const to = add(reduce(prog, n.state, r.pos, model), n.layer + 1);
        const id = edges.length;
        edgeKey.set(`${n.id}|${JSON.stringify(r.pos)}|${model}`, id);
        edges.push({ id, from: n.id, to: to.id, pos: r.pos, kind: r.kind, model, redex: printTerm(termAt(n.state, r.pos)) });
      }
    }
  }
  const strategies = {} as Record<StrategyId, number[]>;
  for (const sid of STRATEGY_IDS) {
    strategies[sid] = runStrategy(prog, start, sid).map((st) => {
      const id = edgeKey.get(`${byKey.get(stateKey(st.from))!.id}|${JSON.stringify(st.pos)}|${effModel(st.from, st.pos, st.model)}`);
      if (id === undefined) throw new EvalPathError(`The ${sid} path leaves the map (${printState(st.from)})`);
      return id;
    });
  }
  const normalForms = nodes.filter((n) => n.normal).map((n) => n.id);
  const results = new Set(normalForms.map((id) => printTerm(nodes.find((n) => n.id === id)!.state.body)));
  if (results.size > 1) throw new EvalPathError(`The paths end in different values: ${[...results].join(', ')}`);
  return { nodes, edges, start: 'n0', normalForms, strategies };
}

/** Parses and checks a spec in one go: `defs` and a start term. Throws `EvalPathError` with an author-facing message. */
export function loadSpec(defs: string, start: string): { prog: Program; start: State } {
  const prog = parseProgram(defs);
  return { prog, start: startState(prog, start) };
}
