// SLD trees: what `sldcheck --tree` prints, and where to draw it. Pure, so that the server tests can run it, and
// text is measured by a function the caller gives (the browser measures real text, the tests count characters).

// ───────────────────────── the tree, as sldcheck prints it ─────────────────────────

export type SldStepKind = 'resolve' | 'builtin' | 'cut' | 'negation' | 'negation-fails' | 'pruned' | 'no-rule' | 'builtin-fails' | 'fails';

export interface SldBinding {
  var: string;
  term: string;
}

export interface SldNode {
  line: number;
  column: number;
  /** The goal as Prolog, without `?-` and the dot. `true` is the empty goal. */
  goal: string;
  name: string | null;
  answer: SldBinding[] | null;
  steps: SldStep[];
}

export interface SldStep {
  line: number;
  column: number;
  kind: SldStepKind;
  /** `resolve`: the renamed clause, without the end dot. */
  rule?: string;
  subst?: SldBinding[];
  /** `negation`, `negation-fails`: the name of the tree of the negated goal. */
  tree?: string;
  /** `pruned`: `member/2`, the number of the clause, and the name of the cut node. */
  predicate?: string;
  clause?: number;
  by?: string;
  /** The name of a tree that does not exist. */
  ref?: string;
  child: SldNode | null;
}

/** The query's tree, and the trees of its negations. */
export interface SldTree {
  tree: SldNode | null;
  negations: SldNode[];
}

// ───────────────────────── the layout ─────────────────────────

export interface SldMetrics {
  /** The width of a text, in the unit of the drawing. */
  measure: (text: string) => number;
  lineHeight: number;
  /** Space between the text of a box and its border. */
  padX: number;
  padY: number;
  /** Space between neighbours. */
  gapX: number;
  /** The least space between a box and the boxes below it. */
  minGapY: number;
  /** Space around the text of an edge. */
  labelPad: number;
  /** Where long goals are broken, in characters. */
  maxChars: number;
  /** Where the rule and the substitution on an edge are broken; they take room from the neighbours. Default: `maxChars`. */
  labelChars?: number;
}

export type SldBoxKind = 'goal' | 'success' | 'failure' | 'pruned' | 'missing';

export interface SldBox {
  id: string;
  kind: SldBoxKind;
  /** The top left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  lines: { text: string; role: 'goal' | 'answer' | 'note' }[];
  name: string | null;
  /** Where it is written. */
  line: number;
  column: number;
}

export interface SldEdge {
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: SldStepKind | 'missing';
  /** The renamed rule and the substitution, or what the step is. */
  label: string[];
  /** The middle of the label's box, and its size; zero wide without a label. */
  lx: number;
  ly: number;
  lw: number;
  lh: number;
  dashed: boolean;
  line: number;
  column: number;
  /** The negation tree a step refers to. */
  tree: string | null;
}

export interface SldTitle {
  text: string;
  tree: string;
  x: number;
  y: number;
}

export interface SldLayout {
  boxes: SldBox[];
  edges: SldEdge[];
  /** The headings of the negation trees. */
  titles: SldTitle[];
  width: number;
  height: number;
}

/** `X ↦ 1, Y ↦ 2`, in braces. */
export function substText(bindings: SldBinding[]): string {
  return `{${bindings.map((b) => `${b.var} ↦ ${b.term}`).join(', ')}}`;
}

/** Breaks a text after its commas, as late as it can before `max` characters. The following lines are indented. */
export function wrapText(text: string, max: number, indent = '  '): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let line = '';
  for (const piece of text.split(/(?<=,) /)) {
    const next = line === '' ? piece : `${line} ${piece}`;
    if (line !== '' && next.length > max) {
      out.push(line);
      line = indent + piece;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** A clause: the head, ` :-`, and the body below it, if it is too long for one line. */
export function wrapRule(rule: string, max: number): string[] {
  if (rule.length <= max) return [rule];
  const at = rule.indexOf(' :- ');
  if (at < 0) return wrapText(rule, max);
  return [`${rule.slice(0, at)} :-`, ...wrapText(`  ${rule.slice(at + 4)}`, max, '    ')];
}

/** A list of bindings in braces, broken after a comma if it is too long. */
export function wrapSubst(bindings: SldBinding[], max: number): string[] {
  return wrapText(substText(bindings), max, ' ');
}

interface Stub {
  kind: SldBoxKind;
  lines: string[];
  line: number;
  column: number;
}

interface Kid {
  step: SldStep;
  label: string[];
  labelW: number;
  labelH: number;
  sub: Measured | null;
  stub: (Stub & { w: number; h: number }) | null;
  /** The room it takes next to its neighbours. */
  slot: number;
}

interface Measured {
  node: SldNode;
  lines: SldBox['lines'];
  w: number;
  h: number;
  kids: Kid[];
  kidsWidth: number;
  /** The width of the node and everything below it. */
  width: number;
  gapY: number;
}

/** Draws every tree of an SLD tree: the query's, and below it the trees of its negations. */
export function layoutSld(t: SldTree, m: SldMetrics): SldLayout {
  const out: SldLayout = { boxes: [], edges: [], titles: [], width: 0, height: 0 };
  let y = 0;
  const trees: [string, SldNode, string | null][] = [];
  if (t.tree) trees.push(['tree', t.tree, null]);
  for (const n of t.negations) trees.push([`negation:${n.name ?? `${n.line}`}`, n, n.name ?? '']);
  trees.forEach(([key, root, title], i) => {
    if (title !== null) {
      out.titles.push({ text: `negation tree @${title}`, tree: title, x: 0, y: y + m.lineHeight / 2 });
      y += m.lineHeight * 1.8;
    }
    const measured = measure(root, m);
    y = place(measured, measured.width / 2, y, key, m, out);
    out.width = Math.max(out.width, measured.width);
    if (i < trees.length - 1) y += m.minGapY * 1.5;
  });
  out.height = y;
  return out;
}

function boxSize(lines: string[], m: SldMetrics): { w: number; h: number } {
  return { w: Math.max(0, ...lines.map((l) => m.measure(l))) + 2 * m.padX, h: lines.length * m.lineHeight + 2 * m.padY };
}

function measure(node: SldNode, m: SldMetrics): Measured {
  const lines: SldBox['lines'] = wrapText(`?- ${node.goal}.`, m.maxChars).map((text) => ({ text, role: 'goal' as const }));
  if (node.answer) lines.push(...wrapSubst(node.answer, m.maxChars).map((text) => ({ text, role: 'answer' as const })));
  const { w, h } = boxSize(lines.map((l) => l.text), m);

  const kids: Kid[] = node.steps.map((step) => {
    const label = edgeLabel(step, m);
    const labelW = label.length ? Math.max(...label.map((l) => m.measure(l))) + 2 * m.labelPad : 0;
    const labelH = label.length ? label.length * m.lineHeight + 2 * m.labelPad : 0;
    if (step.child) {
      const sub = measure(step.child, m);
      return { step, label, labelW, labelH, sub, stub: null, slot: Math.max(sub.width, labelW) };
    }
    const stub = stubOf(step);
    const size = boxSize(stub.lines, m);
    return { step, label, labelW, labelH, sub: null, stub: { ...stub, ...size }, slot: Math.max(size.w, labelW) };
  });
  const kidsWidth = kids.reduce((sum, k) => sum + k.slot, 0) + m.gapX * Math.max(0, kids.length - 1);
  const tallestLabel = Math.max(0, ...kids.map((k) => k.labelH));
  return { node, lines, w, h, kids, kidsWidth, width: Math.max(w, kidsWidth), gapY: kids.length ? Math.max(m.minGapY, tallestLabel + 16) : 0 };
}

/** What is written on the edge of a step. */
function edgeLabel(step: SldStep, m: SldMetrics): string[] {
  const max = m.labelChars ?? m.maxChars;
  const subst = step.subst ? wrapSubst(step.subst, max) : [];
  /** `(2) {X ↦ 1}`: which clause (or `builtin`), then the substitution, on one line where it fits. */
  const tagged = (tag: string) => {
    const rest = step.subst ? wrapSubst(step.subst, Math.max(8, max - tag.length - 1)) : [];
    return rest.length ? [`${tag} ${rest[0]}`, ...rest.slice(1).map((l) => ' '.repeat(tag.length + 1) + l)] : [tag];
  };
  switch (step.kind) {
    case 'resolve':
      // Where sldcheck says which clause was used, its number stands for the renamed clause, which is in the code.
      return step.clause !== undefined ? tagged(`(${step.clause})`) : [...wrapRule(`${step.rule ?? ''}.`, max), ...subst];
    case 'builtin':
      return tagged('builtin');
    case 'cut':
      return ['!'];
    case 'negation':
      return [`\\+ @${step.tree ?? ''}`];
    default:
      return [];
  }
}

/** The box a step without a child ends in. */
function stubOf(step: SldStep): Stub {
  const at = { line: step.line, column: step.column };
  if (step.ref !== undefined) return { kind: 'missing', lines: [`? @${step.ref}`], ...at };
  switch (step.kind) {
    case 'pruned':
      return { kind: 'pruned', lines: [`✂ ${step.predicate ?? ''} #${step.clause ?? 0}`, `by @${step.by ?? ''}`], ...at };
    case 'no-rule':
      return { kind: 'failure', lines: ['✗ no rule'], ...at };
    case 'builtin-fails':
      return { kind: 'failure', lines: ['✗ built-in fails'], ...at };
    case 'negation-fails':
      return { kind: 'failure', lines: [`✗ \\+ @${step.tree ?? ''} fails`], ...at };
    case 'fails':
      return { kind: 'failure', lines: ['✗ fails'], ...at };
    default:
      // A step that leads somewhere, written without what it leads to.
      return { kind: 'missing', lines: ['?'], ...at };
  }
}

/** Puts the node with its centre at `cx` and its top at `y`. Returns the bottom of everything below it. */
function place(n: Measured, cx: number, y: number, key: string, m: SldMetrics, out: SldLayout): number {
  const id = `${key}:${n.node.line}:${n.node.column}`;
  const success = n.node.goal === 'true' && n.node.steps.length === 0;
  out.boxes.push({ id, kind: success ? 'success' : 'goal', x: cx - n.w / 2, y, w: n.w, h: n.h, lines: n.lines, name: n.node.name, line: n.node.line, column: n.node.column });
  let bottom = y + n.h;
  const childTop = y + n.h + n.gapY;
  let x = cx - n.kidsWidth / 2;
  for (const k of n.kids) {
    const kcx = x + k.slot / 2;
    x += k.slot + m.gapX;
    let childId: string;
    if (k.sub) {
      childId = `${key}:${k.sub.node.line}:${k.sub.node.column}`;
      bottom = Math.max(bottom, place(k.sub, kcx, childTop, key, m, out));
    } else {
      const stub = k.stub!;
      childId = `${id}>${stub.line}:${stub.column}`;
      out.boxes.push({
        id: childId,
        kind: stub.kind,
        x: kcx - stub.w / 2,
        y: childTop,
        w: stub.w,
        h: stub.h,
        lines: stub.lines.map((text) => ({ text, role: 'note' as const })),
        name: null,
        line: stub.line,
        column: stub.column,
      });
      bottom = Math.max(bottom, childTop + stub.h);
    }
    out.edges.push({
      id: `${id}>${childId}`,
      from: id,
      to: childId,
      x1: cx,
      y1: y + n.h,
      x2: kcx,
      y2: childTop,
      kind: k.stub?.kind === 'missing' ? 'missing' : k.step.kind,
      label: k.label,
      lx: kcx,
      ly: childTop - k.labelH / 2 - 6,
      lw: k.labelW,
      lh: k.labelH,
      dashed: k.stub !== null,
      line: k.step.line,
      column: k.step.column,
      tree: k.step.tree ?? null,
    });
  }
  return bottom;
}

/**
 * What the cursor is at: every box and edge written at the last line that starts something at or above the cursor
 * (a step's rule and its substitution are two lines of one step). Empty before the first.
 */
export function sldAtLine(layout: SldLayout, cursorLine: number): Set<string> {
  let best = 0;
  for (const e of [...layout.boxes, ...layout.edges]) if (e.line <= cursorLine && e.line > best) best = e.line;
  const ids = new Set<string>();
  if (best === 0) return ids;
  for (const e of [...layout.boxes, ...layout.edges]) if (e.line === best) ids.add(e.id);
  return ids;
}
