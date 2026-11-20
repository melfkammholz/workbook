// Mini-language of the evaluation-paths widget: integer literals, variables, saturated calls of declared functions,
// infix + - * and `let`. No pattern matching, no conditionals (the prototype's example needs none).

export type Term =
  | { k: 'num'; n: number }
  | { k: 'var'; name: string }
  | { k: 'app'; f: string; args: Term[] }
  | { k: 'op'; op: Op; l: Term; r: Term }
  | { k: 'let'; name: string; bound: Term; body: Term };

export type Op = '+' | '-' | '*';

export interface Def {
  name: string;
  params: string[];
  rhs: Term;
}
export type Program = Record<string, Def>;

/** Thrown for every problem in a spec (syntax, unknown names, blowup); the message is meant for authors. */
export class EvalPathError extends Error {}

const num = (n: number): Term => ({ k: 'num', n });
export const isAtom = (t: Term): boolean => t.k === 'num' || t.k === 'var';

// ───────────────────────── parser ─────────────────────────

type Tok = { t: 'int' | 'id' | 'sym'; v: string };

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\s+|(\d+)|([a-z_][A-Za-z0-9_']*)|([()=+\-*])/gy;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new EvalPathError(`Unexpected character "${src[i]}" in "${src}"`);
    i = re.lastIndex;
    if (m[1] !== undefined) toks.push({ t: 'int', v: m[1] });
    else if (m[2] !== undefined) toks.push({ t: 'id', v: m[2] });
    else if (m[3] !== undefined) toks.push({ t: 'sym', v: m[3] });
  }
  return toks;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[], private src: string) {}
  private peek = () => this.toks[this.i];
  private fail(msg: string): never {
    throw new EvalPathError(`${msg} in "${this.src}"`);
  }
  private isSym(v: string) {
    const t = this.peek();
    return t?.t === 'sym' && t.v === v;
  }
  private isKw(v: string) {
    const t = this.peek();
    return t?.t === 'id' && t.v === v;
  }
  expectSym(v: string) {
    if (!this.isSym(v)) this.fail(`Expected "${v}"`);
    this.i++;
  }
  atEnd = () => this.i >= this.toks.length;
  ident(): string {
    const t = this.peek();
    if (t?.t !== 'id' || t.v === 'let' || t.v === 'in') this.fail('Expected a name');
    this.i++;
    return t.v;
  }
  expr(): Term {
    if (this.isKw('let')) {
      this.i++;
      const name = this.ident();
      this.expectSym('=');
      const bound = this.expr();
      if (!this.isKw('in')) this.fail('Expected "in"');
      this.i++;
      return { k: 'let', name, bound, body: this.expr() };
    }
    return this.sum();
  }
  private sum(): Term {
    let l = this.prod();
    while (this.isSym('+') || this.isSym('-')) {
      const op = this.toks[this.i++]!.v as Op;
      l = { k: 'op', op, l, r: this.prod() };
    }
    return l;
  }
  private prod(): Term {
    let l = this.app();
    while (this.isSym('*')) {
      this.i++;
      l = { k: 'op', op: '*', l, r: this.app() };
    }
    return l;
  }
  private startsAtom() {
    const t = this.peek();
    return !!t && (t.t === 'int' || (t.t === 'id' && t.v !== 'let' && t.v !== 'in') || (t.t === 'sym' && t.v === '('));
  }
  private app(): Term {
    const head = this.atom();
    if (!this.startsAtom()) return head;
    if (head.k !== 'var') this.fail('Only a function name can be applied to arguments');
    const args: Term[] = [];
    while (this.startsAtom()) args.push(this.atom());
    return { k: 'app', f: head.name, args };
  }
  private atom(): Term {
    const t = this.peek();
    if (!t) this.fail('Unexpected end');
    if (t.t === 'int') {
      this.i++;
      return num(Number(t.v));
    }
    if (t.t === 'id') return { k: 'var', name: this.ident() };
    this.expectSym('(');
    if (this.isSym('-')) {
      this.i++;
      const n = this.peek();
      if (n?.t !== 'int') this.fail('Expected a number after "-"');
      this.i++;
      this.expectSym(')');
      return num(-Number(n.v));
    }
    const e = this.expr();
    this.expectSym(')');
    return e;
  }
}

function parseWith<T>(src: string, f: (p: Parser) => T): T {
  const p = new Parser(lex(src), src);
  const r = f(p);
  if (!p.atEnd()) throw new EvalPathError(`Unexpected input at the end of "${src}"`);
  return r;
}

/** Applications of non-variables are parsed as plain vars first; calls to unknown functions are errors in `check`. */
export function parseTerm(src: string): Term {
  return parseWith(src, (p) => p.expr());
}

/** One equation per line: `f x y = rhs`. Blank lines and `--` comments are skipped. */
export function parseProgram(src: string): Program {
  const prog: Program = {};
  for (const raw of src.split('\n')) {
    const line = raw.replace(/--.*$/, '').trim();
    if (!line) continue;
    const def = parseWith(line, (p) => {
      const name = p.ident();
      const params: string[] = [];
      while (!p['isSym']('=')) params.push(p.ident());
      p.expectSym('=');
      return { name, params, rhs: p.expr() } as Def;
    });
    if (prog[def.name]) throw new EvalPathError(`"${def.name}" is defined twice (no pattern matching: one equation per function)`);
    if (new Set(def.params).size !== def.params.length) throw new EvalPathError(`"${def.name}" repeats a parameter name`);
    prog[def.name] = def;
  }
  for (const d of Object.values(prog)) checkTerm(prog, d.rhs, new Set(d.params), `in the definition of ${d.name}`);
  return prog;
}

/** Validates names and arities; `bound` are the variables in scope. */
export function checkTerm(prog: Program, t: Term, bound: Set<string>, where: string): void {
  switch (t.k) {
    case 'num':
      return;
    case 'var':
      if (prog[t.name]) throw new EvalPathError(`"${t.name}" is a function and needs ${prog[t.name]!.params.length} argument(s) ${where}`);
      if (!bound.has(t.name)) throw new EvalPathError(`Unknown name "${t.name}" ${where}`);
      return;
    case 'app': {
      const d = prog[t.f];
      if (!d) throw new EvalPathError(`Unknown function "${t.f}" ${where}`);
      if (d.params.length !== t.args.length) throw new EvalPathError(`"${t.f}" takes ${d.params.length} argument(s), got ${t.args.length} ${where}`);
      t.args.forEach((a) => checkTerm(prog, a, bound, where));
      return;
    }
    case 'op':
      checkTerm(prog, t.l, bound, where);
      checkTerm(prog, t.r, bound, where);
      return;
    case 'let':
      checkTerm(prog, t.bound, bound, where);
      checkTerm(prog, t.body, new Set([...bound, t.name]), where);
  }
}

// ───────────────────────── printing ─────────────────────────

/** Precedence levels: let and negative numbers 0, + and - 1, * 2, application 3, atoms 4. */
export const termLevel = (t: Term): number => (t.k === 'let' || (t.k === 'num' && t.n < 0) ? 0 : t.k === 'op' ? (t.op === '*' ? 2 : 1) : t.k === 'app' ? 3 : 4);

/** Parentheses around every nested operation (the structure is the point when reducing); `need` is the lowest level the surrounding position accepts without them. */
export function printTerm(t: Term, need = 0): string {
  const s = ((): string => {
    switch (t.k) {
      case 'num':
        return String(t.n);
      case 'var':
        return t.name;
      case 'app':
        return `${t.f} ${t.args.map((a) => printTerm(a, 4)).join(' ')}`;
      case 'op':
        return `${printTerm(t.l, 3)} ${t.op} ${printTerm(t.r, 3)}`;
      case 'let':
        return `let ${t.name} = ${printTerm(t.bound)} in ${printTerm(t.body)}`;
    }
  })();
  return termLevel(t) < need ? `(${s})` : s;
}
