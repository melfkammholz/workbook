/**
 * Math in titles: `$x^2 + 1$`, written as in Typst, shown as MathML. Titles are plain strings (YAML, outline, window
 * titles), so this is a small reader for the part of Typst math that titles use: numbers, letters, Greek names,
 * `^` and `_`, `a/b`, `sqrt(x)`, groups, and common symbols. Anything it cannot read is shown as typed.
 */

export type MathNode = { tag: string; text?: string; attrs?: Record<string, string>; kids?: MathNode[] };

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ',
  Psi: 'Ψ', Omega: 'Ω', infinity: '∞', oo: '∞', forall: '∀', exists: '∃', in: '∈', 'in.not': '∉', subset: '⊂',
  'subset.eq': '⊆', supset: '⊃', union: '∪', sect: '∩', emptyset: '∅', nothing: '∅', times: '×', dot: '⋅', plus: '+',
  minus: '−', not: '¬', and: '∧', or: '∨', dots: '…', 'dots.h': '…', arrow: '→', 'arrow.r': '→', 'arrow.l': '←',
  'arrow.l.r': '↔', 'arrow.r.double': '⇒', 'arrow.l.r.double': '⇔', approx: '≈', equiv: '≡', prime: '′', angle: '∠',
  sum: '∑', product: '∏', integral: '∫', 'plus.minus': '±', ell: 'ℓ', NN: 'ℕ', ZZ: 'ℤ', QQ: 'ℚ', RR: 'ℝ', CC: 'ℂ',
  top: '⊤', bot: '⊥', compose: '∘', 'dot.c': '⋅', 'lt.eq': '≤', 'gt.eq': '≥', 'eq.not': '≠',
};
const OPS: Record<string, string> = {
  '->': '→', '<-': '←', '<->': '↔', '=>': '⇒', '<=>': '⇔', '|->': '↦', '<=': '≤', '>=': '≥', '!=': '≠', '==': '=', '...': '…',
  '*': '⋅', '-': '−', '<<': '≪', '>>': '≫', '~': '∼', '|': '|',
};
const OPERATOR_NAMES = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'max', 'min', 'lim', 'det', 'gcd', 'lcm', 'mod', 'arg', 'sup', 'inf', 'dim', 'ker', 'deg']);
const BIG = new Set(['∑', '∏', '∫', '∪', '∩']);

class Fail extends Error {}

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z]+)*)|"([^"]*)"|(<->|<=>|\|->|\.\.\.|->|<-|=>|<=|>=|!=|==|<<|>>)|(.))/y;
type Tok = { k: 'num' | 'id' | 'str' | 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    const m = TOKEN.exec(src);
    if (!m) break; // only trailing whitespace is left
    if (m[1] !== undefined) out.push({ k: 'num', v: m[1] });
    else if (m[2] !== undefined) out.push({ k: 'id', v: m[2] });
    else if (m[3] !== undefined) out.push({ k: 'str', v: m[3] });
    else out.push({ k: 'op', v: m[4] ?? m[5]! });
  }
  return out;
}

const leaf = (tag: string, text: string, attrs?: Record<string, string>): MathNode => ({ tag, text, ...(attrs ? { attrs } : {}) });
const row = (kids: MathNode[]): MathNode => (kids.length === 1 ? kids[0]! : { tag: 'mrow', kids });

class Reader {
  private i = 0;
  constructor(private readonly t: Tok[]) {}
  private peek = () => this.t[this.i];
  private isOp = (v: string) => this.peek()?.k === 'op' && this.peek()!.v === v;

  done() {
    return this.i >= this.t.length;
  }

  /** A run of items up to a closing bracket or comma. */
  seq(): MathNode[] {
    const items: MathNode[] = [];
    while (!this.done() && !this.isOp(')') && !this.isOp(',')) {
      let item = this.attached();
      while (this.isOp('/')) {
        this.i++;
        const den = this.attached();
        item = { tag: 'mfrac', kids: [unparen(item), unparen(den)] };
      }
      items.push(item);
    }
    return items;
  }

  /** An atom with its subscript and superscript. */
  private attached(): MathNode {
    const base = this.atom();
    let sub: MathNode | undefined;
    let sup: MathNode | undefined;
    for (;;) {
      if (this.isOp('_') && !sub) {
        this.i++;
        sub = unparen(this.atom());
      } else if (this.isOp('^') && !sup) {
        this.i++;
        sup = unparen(this.atom());
      } else break;
    }
    if (sub && sup) return { tag: base.tag === 'mo' && BIG.has(base.text ?? '') ? 'munderover' : 'msubsup', kids: [base, sub, sup] };
    if (sub) return { tag: base.tag === 'mo' && BIG.has(base.text ?? '') ? 'munder' : 'msub', kids: [base, sub] };
    if (sup) return { tag: base.tag === 'mo' && BIG.has(base.text ?? '') ? 'mover' : 'msup', kids: [base, sup] };
    return base;
  }

  private atom(): MathNode {
    const t = this.t[this.i++];
    if (!t) throw new Fail();
    if (t.k === 'num') return leaf('mn', t.v);
    if (t.k === 'str') return leaf('mtext', t.v);
    if (t.k === 'id') return this.word(t.v);
    if (t.v === '(') {
      const inner = this.seq();
      if (!this.isOp(')')) throw new Fail();
      this.i++;
      return { tag: 'mrow', attrs: { 'data-group': '1' }, kids: [leaf('mo', '('), ...inner, leaf('mo', ')')] };
    }
    if (t.v === ')' || t.v === ',') throw new Fail();
    return leaf('mo', OPS[t.v] ?? t.v);
  }

  private word(name: string): MathNode {
    if (this.isOp('(') && ['sqrt', 'abs', 'norm', 'floor', 'ceil', 'cancel'].includes(name)) {
      this.i++;
      const inner = this.seq();
      if (!this.isOp(')')) throw new Fail();
      this.i++;
      const body = row(inner);
      if (name === 'sqrt') return { tag: 'msqrt', kids: [body] };
      const [open = '', close = ''] = ({ abs: ['|', '|'], norm: ['‖', '‖'], floor: ['⌊', '⌋'], ceil: ['⌈', '⌉'], cancel: ['', ''] } as Record<string, string[]>)[name]!;
      return { tag: 'mrow', kids: [leaf('mo', open), body, leaf('mo', close)] };
    }
    if (OPERATOR_NAMES.has(name)) return leaf('mi', name, { mathvariant: 'normal' });
    const sym = SYMBOLS[name];
    if (sym) return BIG.has(sym) ? leaf('mo', sym) : /^[A-Za-zΑ-ωℓ]$/.test(sym) ? leaf('mi', sym) : leaf('mo', sym);
    if (name.length === 1) return leaf('mi', name);
    // Several letters in a row are one name in Typst, shown upright.
    return leaf('mi', name, { mathvariant: 'normal' });
  }
}

/** `(a+b)` as an operand of `/`, `^` or `_` is just `a+b`. */
function unparen(n: MathNode): MathNode {
  if (n.attrs?.['data-group'] && n.kids) return row(n.kids.slice(1, -1));
  return n;
}

/** The math of a title, or null when it cannot be read (the title then shows it as typed). */
export function readMath(src: string): MathNode | null {
  try {
    const r = new Reader(tokenize(src));
    const kids = r.seq();
    if (!r.done() || kids.length === 0) return null;
    return { tag: 'math', kids };
  } catch {
    return null;
  }
}

/** Pieces of a title outside backticks: text and math, where `$…$` is math and `\$` a dollar sign. */
export function splitMath(text: string): { math: boolean; v: string }[] {
  const out: { math: boolean; v: string }[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) out.push({ math: false, v: buf });
    buf = '';
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\\' && text[i + 1] === '$') {
      buf += '$';
      i += 2;
    } else if (c === '$') {
      let j = i + 1;
      while (j < text.length && text[j] !== '$') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) {
        buf += c;
        i++;
      } else {
        flush();
        out.push({ math: true, v: text.slice(i + 1, j) });
        i = j + 1;
      }
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return out;
}

/** MathML of rendered Typst back to the source of a title (`x^2`, `(a)/(b)`), for headings that become titles. */
export function mathElementToSource(el: Element): string {
  const wrap = (s: string) => (/^[\w.]+$/.test(s) ? s : `(${s})`);
  const walk = (n: Element): string => {
    const kids = [...n.children];
    const inner = () => kids.map(walk).join(' ');
    switch (n.tagName.toLowerCase()) {
      case 'msup': return `${wrap(walk(kids[0]!))}^${wrap(walk(kids[1]!))}`;
      case 'msub': return `${wrap(walk(kids[0]!))}_${wrap(walk(kids[1]!))}`;
      case 'msubsup': return `${wrap(walk(kids[0]!))}_${wrap(walk(kids[1]!))}^${wrap(walk(kids[2]!))}`;
      case 'mfrac': return `${wrap(walk(kids[0]!))}/${wrap(walk(kids[1]!))}`;
      case 'msqrt': return `sqrt(${inner()})`;
      case 'mtext': return `"${n.textContent ?? ''}"`;
      case 'mi': case 'mn': case 'mo': return n.textContent ?? '';
      default: return kids.length ? inner() : (n.textContent ?? '');
    }
  };
  return walk(el);
}
