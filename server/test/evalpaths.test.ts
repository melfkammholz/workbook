import { describe, expect, it } from 'vitest';
import { buildMap, EvalPathError, loadSpec, parseTerm, printState, printTerm, runStrategy, type StrategyId } from '@wb/shared';

const DEFS = 'inc n = n + 1\ndouble x = x + x';
const { prog, start } = loadSpec(DEFS, 'double (inc 3)');
const texts = (strategy: StrategyId) => [start, ...runStrategy(prog, start, strategy).map((s) => s.to)].map(printState);

describe('eval paths: language', () => {
  it('prints with parentheses around nested operations and round-trips', () => {
    for (const s of ['1 + (2 * 3)', '(1 + 2) * 3', '1 - (2 - 3)', 'f (g 1) 2 + 4', 'a * (b * c)', 'f (-1)', 'let x = inc 3 in x + x']) {
      expect(printTerm(parseTerm(s))).toBe(s);
    }
    expect(printTerm(parseTerm('1 + 2 * 3'))).toBe('1 + (2 * 3)');
  });
  it('rejects bad specs with a message', () => {
    expect(() => loadSpec('f x = y', 'f 1')).toThrow(/Unknown name "y"/);
    expect(() => loadSpec(DEFS, 'inc 1 2')).toThrow(/takes 1 argument/);
    expect(() => loadSpec(DEFS, 'nope 1')).toThrow(/Unknown function/);
    expect(() => loadSpec('f x = x\nf y = y', 'f 1')).toThrow(EvalPathError);
    expect(() => loadSpec(DEFS, '1 +')).toThrow(EvalPathError);
  });
});

describe('eval paths: double (inc 3)', () => {
  it('innermost', () => {
    expect(texts('innermost')).toEqual(['double (inc 3)', 'double (3 + 1)', 'double 4', '4 + 4', '8']);
  });
  it('outermost without sharing', () => {
    expect(texts('outermost')).toEqual(['double (inc 3)', 'inc 3 + inc 3', '(3 + 1) + inc 3', '4 + inc 3', '4 + (3 + 1)', '4 + 4', '8']);
  });
  it('outermost with sharing', () => {
    expect(texts('outermostShared')).toEqual(['double (inc 3)', 'x + x, x = inc 3', 'x + x, x = 3 + 1', 'x + x, x = 4', '8']);
  });
  it('builds the map of the prototype', () => {
    const m = buildMap(prog, start);
    const label = (id: string) => printState(m.nodes.find((n) => n.id === id)!.state);
    expect(m.nodes.map((n) => printState(n.state)).sort()).toEqual(
      ['double (inc 3)', 'double (3 + 1)', 'double 4', '4 + 4', '8', 'inc 3 + inc 3', '(3 + 1) + inc 3', '4 + inc 3', '4 + (3 + 1)', '(3 + 1) + (3 + 1)', 'x + x, x = inc 3', 'x + x, x = 3 + 1', 'x + x, x = 4'].sort(),
    );
    expect(m.normalForms.map(label)).toEqual(['8']);
    // the leftmost restriction: the right `inc 3` is never reduced first
    expect(m.nodes.map((n) => printState(n.state))).not.toContain('inc 3 + (3 + 1)');
    const path = (id: StrategyId) => m.strategies[id].map((e) => `${label(m.edges[e].from)} => ${label(m.edges[e].to)}`);
    expect(path('innermost')).toHaveLength(4);
    expect(path('outermost')).toHaveLength(6);
    expect(path('outermostShared')).toHaveLength(4);
    expect(path('outermostShared')[3]).toBe('x + x, x = 4 => 8');
  });
  it('layers by distance from the start', () => {
    const m = buildMap(prog, start);
    expect(m.nodes[0].layer).toBe(0);
    const layer = (t: string) => m.nodes.find((n) => printState(n.state) === t)!.layer;
    expect(layer('double (3 + 1)')).toBe(1);
    expect(layer('8')).toBe(4);
  });
  it('gives the same value under every strategy', () => {
    for (const s of ['innermost', 'outermost', 'outermostShared'] as const) expect(texts(s).at(-1)).toBe('8');
  });
});

describe('eval paths: limits and variants', () => {
  it('stops a blowing-up map with a message', () => {
    const l = loadSpec('f x = f x + f x', 'f 1');
    expect(() => buildMap(l.prog, l.start, { maxNodes: 10 })).toThrow(/more than 10 terms/);
  });
  it('supports let in the start term and in definitions', () => {
    const l = loadSpec('sq x = let y = x * x in y + y', 'sq (1 + 2)');
    const m = buildMap(l.prog, l.start);
    expect(m.normalForms.map((id) => printState(m.nodes.find((n) => n.id === id)!.state))).toEqual(['18']);
    expect(printState(startStateOf('let a = 2 * 3 in a + a'))).toBe('a + a, a = 2 * 3');
  });
  it('lets numbers be negative', () => {
    const l = loadSpec('neg x = 0 - x', 'neg 5 * 2');
    expect(runStrategy(l.prog, l.start, 'innermost').at(-1)!.to.body).toEqual({ k: 'num', n: -10 });
  });
});

function startStateOf(src: string) {
  return loadSpec('', src).start;
}
