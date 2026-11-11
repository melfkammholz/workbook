import { describe, expect, it } from 'vitest';
import { layoutSld, sldAtLine, substText, wrapRule, wrapSubst, wrapText, type SldMetrics, type SldNode, type SldStep, type SldTree } from '@wb/shared';

/** Every character is 8 wide. */
const m: SldMetrics = { measure: (t) => t.length * 8, lineHeight: 16, padX: 8, padY: 6, gapX: 20, minGapY: 28, labelPad: 3, maxChars: 40 };

const node = (line: number, goal: string, steps: SldStep[] = [], extra: Partial<SldNode> = {}): SldNode => ({ line, column: 1, goal, name: null, answer: null, steps, ...extra });
const step = (line: number, kind: SldStep['kind'], child: SldNode | null, extra: Partial<SldStep> = {}): SldStep => ({ line, column: 3, kind, child, ...extra });

describe('wrapping', () => {
  it('breaks after commas, as late as it can, and indents what follows', () => {
    expect(wrapText('a, b, c', 40)).toEqual(['a, b, c']);
    const lines = wrapText('first(X, Y), second(Y, Z), third(Z, W)', 24);
    expect(lines.every((l) => l.length <= 24 + 12)).toBe(true);
    expect(lines.join(' ').replace(/\s+/g, ' ')).toBe('first(X, Y), second(Y, Z), third(Z, W)');
  });

  it('puts the body of a long rule below its head', () => {
    expect(wrapRule('p(X) :- q(X)', 40)).toEqual(['p(X) :- q(X)']);
    const lines = wrapRule('ancestor(X2, Y2) :- parent(X2, Z2), ancestor(Z2, Y2), more(Y2)', 40);
    expect(lines[0]).toBe('ancestor(X2, Y2) :-');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('writes a substitution with the arrow, in braces', () => {
    expect(substText([{ var: 'X', term: '1' }, { var: 'Y', term: '[2]' }])).toBe('{X ↦ 1, Y ↦ [2]}');
    expect(substText([])).toBe('{}');
    expect(wrapSubst([{ var: 'X', term: 'a' }], 40)).toEqual(['{X ↦ a}']);
  });
});

describe('the layout of a tree', () => {
  // ?- p.  with two steps, the first leads on, the second ends in a failure.
  const tree: SldTree = {
    tree: node(1, 'p(X)', [
      step(2, 'resolve', node(4, 'q(X)', [step(5, 'resolve', node(7, 'true', [], { answer: [{ var: 'X', term: 'a' }] }), { rule: 'q(a)', subst: [{ var: 'X', term: 'a' }] })]), { rule: 'p(X1) :- q(X1)', subst: [{ var: 'X1', term: 'X' }] }),
      step(8, 'resolve', node(10, 'r(X)', [step(11, 'no-rule', null)]), { rule: 'p(b)', subst: [{ var: 'X', term: 'b' }] }),
      step(12, 'pruned', null, { predicate: 'p/1', clause: 3, by: 'c' }),
    ]),
    negations: [],
  };
  const layout = layoutSld(tree, m);
  const box = (line: number) => layout.boxes.find((b) => b.line === line)!;

  it('has a box for every node and one for each step that ends without a node', () => {
    expect(layout.boxes.map((b) => [b.line, b.kind])).toEqual([[1, 'goal'], [4, 'goal'], [7, 'success'], [10, 'goal'], [11, 'failure'], [12, 'pruned']]);
    expect(layout.edges).toHaveLength(5);
    expect(box(11).lines[0]!.text).toBe('✗ no rule');
    expect(box(12).lines.map((l) => l.text)).toEqual(['✂ p/1 #3', 'by @c']);
    expect(box(7).lines.map((l) => l.text)).toEqual(['?- true.', '{X ↦ a}']);
  });

  it('puts every box below its parent, and the children of a node side by side without touching', () => {
    for (const e of layout.edges) {
      const from = layout.boxes.find((b) => b.id === e.from)!;
      const to = layout.boxes.find((b) => b.id === e.to)!;
      expect(to.y).toBeGreaterThan(from.y + from.h);
    }
    const siblings = [box(4), box(10), box(12)];
    for (let i = 1; i < siblings.length; i++) expect(siblings[i]!.x).toBeGreaterThanOrEqual(siblings[i - 1]!.x + siblings[i - 1]!.w + m.gapX - 0.001);
  });

  it('centres a node above its children, and stays inside the drawing', () => {
    const root = box(1);
    const kids = [box(4), box(10), box(12)];
    const left = kids[0]!.x;
    const right = kids[2]!.x + kids[2]!.w;
    // The children are centred as a group (the slots of their labels are wider than their boxes).
    expect(root.x + root.w / 2).toBeCloseTo(layout.width / 2, 5);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(layout.width + 0.001);
    for (const b of layout.boxes) expect(b.y + b.h).toBeLessThanOrEqual(layout.height + 0.001);
  });

  it('makes room for the label of an edge, which sits above the node it leads to', () => {
    const e = layout.edges.find((x) => x.line === 2)!;
    expect(e.label).toEqual(['p(X1) :- q(X1).', '{X1 ↦ X}']);
    expect(e.lw).toBeGreaterThanOrEqual('p(X1) :- q(X1).'.length * 8);
    const to = layout.boxes.find((b) => b.id === e.to)!;
    expect(e.ly + e.lh / 2).toBeLessThanOrEqual(to.y);
    // Neither the line nor the other labels are overlapped by the neighbours' labels.
    const labelled = layout.edges.filter((x) => x.lw > 0 && x.y1 === e.y1);
    for (const a of labelled) for (const b of labelled) if (a !== b) expect(Math.abs(a.lx - b.lx)).toBeGreaterThanOrEqual((a.lw + b.lw) / 2 - 0.001);
  });

  it('draws the trees of negations below the query, each with a heading', () => {
    const t: SldTree = {
      tree: node(1, '\\+ p(c)', [step(2, 'negation', node(4, 'true', []), { tree: 't1' })]),
      negations: [node(6, 'p(c)', [step(7, 'no-rule', null)], { name: 't1' })],
    };
    const l = layoutSld(t, m);
    expect(l.titles).toEqual([expect.objectContaining({ text: 'negation tree @t1', tree: 't1' })]);
    const main = l.boxes.find((b) => b.line === 4)!;
    const side = l.boxes.find((b) => b.line === 6)!;
    expect(side.y).toBeGreaterThan(main.y + main.h);
    expect(l.edges.find((e) => e.tree === 't1')!.label).toEqual(['\\+ @t1']);
  });

  it('shows what is missing: a step to a tree that does not exist, and an empty tree', () => {
    const l = layoutSld({ tree: node(1, 'p', [step(2, 'resolve', null, { rule: 'p', ref: 'nowhere' })]), negations: [] }, m);
    expect(l.boxes[1]).toMatchObject({ kind: 'missing', lines: [{ text: '? @nowhere' }] });
    expect(layoutSld({ tree: null, negations: [] }, m)).toMatchObject({ boxes: [], edges: [], width: 0, height: 0 });
  });

  it('finds what the cursor is at: the last thing written at or above its line', () => {
    expect([...sldAtLine(layout, 1)]).toEqual([box(1).id]);
    // Line 3 is the second line of the first step (its substitution): still that step.
    const atThree = sldAtLine(layout, 3);
    expect(atThree.has(layout.edges.find((e) => e.line === 2)!.id)).toBe(true);
    expect(atThree.size).toBe(1);
    expect([...sldAtLine(layout, 11)].sort()).toEqual([box(11).id, layout.edges.find((e) => e.line === 11)!.id].sort());
    expect(sldAtLine(layout, 0).size).toBe(0);
  });

  it('breaks a long goal into lines, and the box is as wide as the longest', () => {
    const long = layoutSld({ tree: node(1, 'first(X, Y), second(Y, Z), third(Z, W), fourth(W, V), fifth(V, U)'), negations: [] }, m);
    const b = long.boxes[0]!;
    expect(b.lines.length).toBeGreaterThan(1);
    expect(b.w).toBe(Math.max(...b.lines.map((l) => l.text.length * 8)) + 2 * m.padX);
  });
});

describe('labels with the clause number', () => {
  it('shows the number of the clause and the substitution instead of the renamed clause', () => {
    const t = { tree: node(1, 'p(X)', [step(2, 'resolve', node(4, 'true'), { rule: 'p(X1) :- q(X1)', clause: 2, subst: [{ var: 'X1', term: 'X' }] }), step(5, 'builtin', node(7, 'true'), { subst: [{ var: 'Y', term: '2' }] })]), negations: [] };
    const l = layoutSld(t, m);
    expect(l.edges.map((e) => e.label)).toEqual([['(2) {X1 ↦ X}'], ['builtin {Y ↦ 2}']]);
  });
});

describe('long labels', () => {
  it('are broken sooner than goals when asked to, which leaves the neighbours more room', () => {
    const rule = 'ancestor(X2, Y2) :- parent(X2, Z2), ancestor(Z2, Y2)';
    const t: SldTree = { tree: node(1, 'a', [step(2, 'resolve', node(3, 'b'), { rule, subst: [] })]), negations: [] };
    const wide = layoutSld(t, m).edges[0]!;
    const narrow = layoutSld(t, { ...m, labelChars: 24 }).edges[0]!;
    expect(narrow.label.length).toBeGreaterThan(wide.label.length);
    expect(narrow.lw).toBeLessThan(wide.lw);
  });
});
