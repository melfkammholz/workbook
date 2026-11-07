/**
 * Everything the fold-signature widget needs, worked out from a data declaration such as
 * `data Maybe a = Nothing | Just a`: the type of each constructor, the parameter that
 * replaces it in the fold, and the fold's signature. Authors write only the declaration.
 */

export interface Constructor {
  name: string;
  /** Field types as they read in a signature (outer parentheses only where needed). */
  fields: string[];
  /** The same fields with the declared type replaced by `r`. */
  folded: string[];
  /** Which fields mention the declared type. */
  recursive: boolean[];
  /** Type of the fold's parameter for this constructor, e.g. `(a -> r)` or `r`. */
  param: string;
  /** Name of that parameter: `f` + the constructor's name in lower case (`fcons`, `fnil` for lists). */
  paramName: string;
  /** Written between its two fields, like `x : xs`. Its `name` is then the operator in parentheses: `(:)`. */
  infix: boolean;
}

export interface FoldPlan {
  /** The declared type applied to its variables, e.g. `Maybe a`. */
  self: string;
  fold: string;
  constructors: Constructor[];
  /** Parts of the signature in order: one parameter per constructor, the value, the result. */
  signature: string[];
}

/** Splits at top level only: nothing inside parentheses or brackets. */
function splitTop(src: string, at: (c: string, i: number) => number): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0) {
      const n = at(c, i);
      if (n > 0) {
        out.push(src.slice(start, i));
        start = i + n;
        i += n - 1;
      }
    }
  }
  out.push(src.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** The atoms of a constructor: `Node (Tree a) a [Tree a]` → `Node`, `(Tree a)`, `a`, `[Tree a]`. */
function atoms(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === '[') {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '(' || src[j] === '[') depth++;
        else if (src[j] === ')' || src[j] === ']') depth--;
        if (depth === 0) break;
      }
      out.push(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < src.length && !/[\s([]/.test(src[j]!)) j++;
    out.push(src.slice(i, j));
    i = j;
  }
  return out;
}

const hasTopArrow = (t: string) => splitTop(t, (c, i) => (c === '-' && t[i + 1] === '>' ? 2 : 0)).length > 1;

/** Drops parentheses around a whole type unless it is a function type. */
function unwrap(t: string): string {
  t = t.trim();
  while (t.startsWith('(') && t.endsWith(')') && atoms(t).length === 1) {
    const inner = t.slice(1, -1).trim();
    if (hasTopArrow(inner)) break;
    t = inner;
  }
  return t;
}

/** A type as an argument of `->`: function types need parentheses. */
export const asArgument = (t: string) => (hasTopArrow(t) ? `(${t})` : t);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lists have no declaration of their own; `data [a] = a : [a] | []` stands in for it. */
const LIST_PARAMS: Record<string, string> = { '(:)': 'fcons', '[]': 'fnil' };

export function planFold(decl: string, fold?: string): FoldPlan | { error: string } {
  const m = /^\s*data\s+(\[\s*[a-z][\w']*\s*\]|[A-Z][\w']*(?:\s+[a-z][\w']*)*)\s*=(.*)$/s.exec(decl);
  if (!m) return { error: 'expected "data Name vars = Constructor fields | …"' };
  const head = m[1]!.trim().replace(/\s+/g, ' ').replace(/\[\s*(\S+)\s*\]/, '[$1]');
  const list = head.startsWith('[');
  const name = list ? '[]' : head.split(' ')[0]!;
  const self = head;
  const selfRe = new RegExp(`(?<![\\w'])${escapeRe(self).replace(/ /g, '\\s+')}(?![\\w'])`, 'g');
  const fold_ = (t: string) => unwrap(t.replace(selfRe, 'r').replace(/\(\s*r\s*\)/g, 'r'));

  const constructors: Constructor[] = [];
  for (const alt of splitTop(m[2]!, (c) => (c === '|' ? 1 : 0))) {
    const parts = atoms(alt);
    // An operator between two fields, like `a : [a]`.
    const infix = parts.length === 3 && /^:[^\w\s]*$/.test(parts[1]!);
    const cname = infix ? `(${parts[1]})` : parts[0];
    const raw = infix ? [parts[0]!, parts[2]!] : parts.slice(1);
    if (!cname || !(/^[A-Z]/.test(cname) || /^\(:[^)]*\)$/.test(cname) || cname === '[]')) return { error: `not a constructor: "${alt}"` };
    const fields = raw.map(unwrap);
    const folded = fields.map(fold_);
    const recursive = fields.map((f) => new RegExp(selfRe.source).test(f));
    const param = folded.length ? `(${[...folded, 'r'].map(asArgument).join(' -> ')})` : 'r';
    const paramName = LIST_PARAMS[cname] ?? `f${cname.replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'op'}`;
    constructors.push({ name: cname, fields, folded, recursive, param, paramName, infix });
  }
  if (!constructors.length) return { error: 'no constructors' };
  return { self, fold: fold ?? (list ? 'foldr' : `fold${name}`), constructors, signature: [...constructors.map((c) => c.param), self, 'r'] };
}

/** Type of a constructor, from its fields and the declared type: `a -> Maybe a`. */
export const constructorType = (c: Constructor, self: string) => [...c.fields.map(asArgument), self].join(' -> ');

/** Wrong pieces for the signature that teach something: a reversed function, the result wrapped in the type. */
export function distractors(plan: FoldPlan): string[] {
  const out: string[] = [];
  const withField = plan.constructors.find((c) => c.fields.length && !c.recursive[0]);
  if (withField) out.push(`(r -> ${asArgument(withField.folded[0]!)})`);
  const [name, ...vars] = plan.self.split(' ');
  if (vars.length) out.push([name, ...vars.slice(0, -1), 'r'].join(' '));
  if (plan.self.startsWith('[')) out.push('[r]');
  return out.filter((d) => !plan.signature.includes(d));
}

/** A fixed mix, so the pieces are never in the order they belong in, and the same on every visit. */
export function mix<T>(items: T[]): T[] {
  const out: T[] = [];
  for (let a = 0, b = items.length - 1; a <= b; a++, b--) {
    out.push(items[b]!);
    if (a !== b) out.push(items[a]!);
  }
  return out;
}

// ───────────────────────── code and values ─────────────────────────

/** Types the Prelude already has: their declaration must not be repeated. */
const PRELUDE_TYPES = new Set(['Maybe', 'Either', 'Bool', 'Ordering', '[]']);
/** Folds the Prelude already has, with the parameters in the order of the constructors. */
const PRELUDE_FOLDS = new Set(['foldr', 'maybe', 'either']);

/** Names of a constructor's fields in the fold's code: x, y, z, … */
export const fieldVars = (n: number) => Array.from({ length: n }, (_, i) => (i < 3 ? 'xyz'[i]! : `x${i + 1}`));

/** How a field reaches its function: as it is, folded, or folded inside (`fmap`, e.g. a list of subtrees). */
function fieldArg(plan: FoldPlan, c: Constructor, k: number, v: string): string {
  if (!c.recursive[k]) return v;
  const again = `${plan.fold} ${plan.constructors.map((x) => x.paramName).join(' ')}`;
  return c.fields[k] === plan.self ? `(${again} ${v})` : `(fmap (${again}) ${v})`;
}

/** The fold as Haskell: the `case` with one line per constructor, as the recipe writes it. */
export function foldCode(plan: FoldPlan): string {
  const params = plan.constructors.map((c) => c.paramName);
  const lines = plan.constructors.map((c) => {
    const vars = fieldVars(c.fields.length);
    const lhs = c.infix ? `${vars[0]} ${c.name.slice(1, -1)} ${vars[1]}` : [c.name, ...vars].join(' ');
    const rhs = [c.paramName, ...vars.map((v, k) => fieldArg(plan, c, k, v))].join(' ');
    return { lhs, rhs };
  });
  const width = Math.max(...lines.map((l) => l.lhs.length));
  return [
    `${plan.fold} :: ${plan.signature.join(' -> ')}`,
    `${plan.fold} ${params.join(' ')} value =`,
    '  case value of',
    ...lines.map((l) => `    ${l.lhs.padEnd(width)} -> ${l.rhs}`),
  ].join('\n');
}

/** What ghci needs for the fold: the declaration unless the Prelude has it, then the fold. */
export function foldSetup(plan: FoldPlan, decl: string): string {
  if (PRELUDE_FOLDS.has(plan.fold)) return '';
  const name = plan.self.startsWith('[') ? '[]' : plan.self.split(' ')[0]!;
  const data = PRELUDE_TYPES.has(name) ? '' : `${decl.trim()}${/\bderiving\b/.test(decl) ? '' : ' deriving Show'}\n\n`;
  return data + foldCode(plan);
}

/** A value as a tree: constructors inside, everything else is a leaf with its text. */
export interface Term {
  /** Index of the constructor in the plan, or null for a leaf or a list. */
  ci: number | null;
  /** The constructor's name, or a leaf's text. */
  text: string;
  children: Term[];
  list?: boolean;
  /** A constructor written between its fields, like `3 : xs`. */
  infix?: boolean;
}

function tokenize(src: string): string[] {
  const re = /\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)'|-?\d+(?:\.\d+)?|[A-Za-z_][\w']*|[()[\],]|[^\s\w()[\],"']+)/gy;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]!);
  return out;
}

/** Reads a value such as `Node (Node Leaf 1 Leaf) 2 Leaf` against the declaration. */
export function parseValue(src: string, plan: FoldPlan): Term | { error: string } {
  const toks = tokenize(src);
  let i = 0;
  const byName = new Map(plan.constructors.map((c, ci) => [c.name, ci]));
  /** Infix constructors by their operator: `:` → the index of `(:)`. */
  const infixOps = new Map(plan.constructors.flatMap((c, ci) => (c.infix ? [[c.name.slice(1, -1), ci] as const] : [])));
  const isList = plan.self.startsWith('[');
  const nil = plan.constructors.findIndex((c) => c.name === '[]');
  const cons = [...infixOps.values()][0];
  const atom = (): Term | null => {
    const t = toks[i];
    if (t === undefined || t === ')' || t === ']' || t === ',' || infixOps.has(t)) return null;
    i++;
    if (t === '(') {
      const inner = app();
      if (toks[i++] !== ')') throw new Error('missing )');
      return inner;
    }
    if (t === '[') {
      const items: Term[] = [];
      while (toks[i] !== ']') {
        items.push(app());
        if (toks[i] === ',') i++;
        else if (toks[i] !== ']') throw new Error('missing ]');
      }
      i++;
      // A list literal of the list type is its constructors: [3, 7] = 3 : (7 : []).
      if (isList && nil >= 0 && cons !== undefined)
        return items.reduceRight<Term>((rest, x) => ({ ci: cons, text: plan.constructors[cons]!.name, children: [x, rest], infix: true }), { ci: nil, text: '[]', children: [] });
      return { ci: null, text: '', children: items, list: true };
    }
    const ci = byName.get(t);
    return ci === undefined ? { ci: null, text: t, children: [] } : { ci, text: t, children: [] };
  };
  /** An application, then possibly an infix constructor and the rest, to the right: 3 : 7 : []. */
  const app = (): Term => {
    const left = prefix();
    const op = toks[i];
    if (op === undefined || !infixOps.has(op)) return left;
    i++;
    const ci = infixOps.get(op)!;
    return { ci, text: plan.constructors[ci]!.name, children: [left, app()], infix: true };
  };
  const prefix = (): Term => {
    const head = atom();
    if (!head) throw new Error(`unexpected "${toks[i] ?? 'end'}"`);
    if (head.ci === null || head.children.length) {
      // A function applied to something, e.g. `negate 3`: one leaf.
      const rest: Term[] = [];
      for (let a = atom(); a; a = atom()) rest.push(a);
      return rest.length ? { ci: null, text: [head, ...rest].map((x) => show(x)).join(' '), children: [] } : head;
    }
    const c = plan.constructors[head.ci]!;
    for (let k = 0; k < c.fields.length; k++) {
      const a = atom();
      if (!a) throw new Error(`${c.name} needs ${c.fields.length} fields`);
      head.children.push(a);
    }
    return head;
  };
  try {
    const t = app();
    if (i < toks.length) return { error: `unexpected "${toks[i]}"` };
    return t;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A term written out, with the head of each constructor node given by `name`. */
export function show(t: Term, name: (t: Term) => string = (x) => x.text): string {
  if (t.list) return `[${t.children.map((c) => show(c, name)).join(', ')}]`;
  if (t.ci === null) return t.text;
  if (t.infix && name(t) === t.text) {
    // Written as it was: 3 : (7 : []), the operator without its parentheses.
    const [l, r] = t.children.map((c) => show(c, name));
    const wrap = (c: Term, x: string) => ((c.ci !== null && c.children.length) || (c.ci === null && !isAtomic(x) && !c.list) ? `(${x})` : x);
    return `${wrap(t.children[0]!, l!)} ${t.text.slice(1, -1)} ${wrap(t.children[1]!, r!)}`;
  }
  const args = t.children.map((c) => {
    const s = show(c, name);
    return c.ci !== null && c.children.length ? `(${s})` : /\s/.test(s) && !c.list && !/^["']/.test(s) ? `(${s})` : s;
  });
  return [name(t), ...args].join(' ');
}

/** Needs no parentheses as an argument: a name, a number, a string or character, or something already in brackets. */
export function isAtomic(src: string): boolean {
  const s = src.trim();
  if (/^[A-Za-z_][\w'.]*$/.test(s) || /^\d+(\.\d+)?$/.test(s) || /^"(?:[^"\\]|\\.)*"$/.test(s) || /^'(?:[^'\\]|\\.)'$/.test(s)) return true;
  // One bracket that closes at the very end: (…), […]
  if (!/^[([]/.test(s)) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if ('(['.includes(s[i]!)) depth++;
    else if (')]'.includes(s[i]!)) depth--;
    if (depth === 0 && i < s.length - 1) return false;
  }
  return depth === 0;
}

/** As an argument: in parentheses only when needed. */
export const arg = (src: string) => (isAtomic(src) ? src.trim() : `(${src.trim()})`);

// ───────────────────────── simplifying before applying ─────────────────────────

/** Splits `f x (g y) "s"` into its function and arguments, at the top level. */
function applicationParts(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (const ch of src.trim()) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"') quote = ch;
    if ('(['.includes(ch)) depth++;
    if (')]'.includes(ch)) depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const stripParens = (src: string): string => {
  const s = src.trim();
  return s.startsWith('(') && isAtomic(s) ? stripParens(s.slice(1, -1)) : s;
};

/**
 * A function applied to some arguments, worked out as far as it goes without running anything:
 * a lambda takes its arguments (`(\_ -> sum) "y"` is `sum`), `const e x` is `e`. Null when nothing
 * can be done, e.g. `(+) 3`, which stays as it is.
 */
export function simplify(fn: string, args: string[]): string | null {
  if (!args.length) return null;
  const f = stripParens(fn);
  const lambda = /^\\\s*((?:[a-z_][\w']*\s*)+)->\s*([\s\S]+)$/.exec(f);
  if (lambda) {
    const params = lambda[1]!.trim().split(/\s+/);
    let body = lambda[2]!.trim();
    const n = Math.min(params.length, args.length);
    for (let i = 0; i < n; i++) {
      const p = params[i]!;
      if (p === '_') continue;
      body = body.replace(new RegExp(`(?<![\\w'"])${p}(?![\\w'])`, 'g'), arg(args[i]!));
    }
    const rest = params.slice(n);
    const out = rest.length ? `\\${rest.join(' ')} -> ${body}` : body;
    return args.length > n ? `${arg(out)} ${args.slice(n).map(arg).join(' ')}` : out;
  }
  const parts = applicationParts(f);
  if (parts[0] === 'const' && parts.length === 2) return simplify(`\\_ -> ${parts[1]}`, args) ?? null;
  return null;
}
