import { describe, expect, it } from 'vitest';
import { loadSucceeded, parseGhcDiagnostics } from '../src/runners/diagnostics.js';

describe('parseGhcDiagnostics', () => {
  it('parses a single-line span (GHC 9.4)', () => {
    const out = [
      '[1 of 1] Compiling A                ( A.hs, interpreted )',
      '',
      'A.hs:3:11-13: error:',
      "    * Couldn't match type `[Char]' with `Int'",
      '      Expected: Int',
      '  |',
      '3 | f x = x + "a"',
      '  |           ^^^',
      'Failed, no modules loaded.',
    ].join('\n');
    const [d, ...rest] = parseGhcDiagnostics(out);
    expect(rest).toHaveLength(0);
    expect(d).toMatchObject({ severity: 'error', file: 'A.hs', line: 3, column: 11, endLine: 3, endColumn: 14, code: null });
    expect(d!.message).toContain("Couldn't match type");
    expect(d!.message).not.toContain('^^^');
    expect(d!.message).not.toContain('Failed');
  });

  it('parses multi-line spans, warnings with flags and GHC-codes', () => {
    const out = [
      'Foo/Bar.hs:(10,5)-(12,9): warning: [-Wincomplete-patterns]',
      '    Pattern match(es) are non-exhaustive',
      '',
      'Foo/Bar.hs:4:1: error: [GHC-88464]',
      '    Variable not in scope: foo',
    ].join('\n');
    const ds = parseGhcDiagnostics(out);
    expect(ds).toHaveLength(2);
    expect(ds[0]).toMatchObject({ severity: 'warning', line: 10, column: 5, endLine: 12, endColumn: 9, code: '-Wincomplete-patterns' });
    expect(ds[1]).toMatchObject({ severity: 'error', line: 4, code: 'GHC-88464' });
  });

  it('ignores <interactive> diagnostics', () => {
    expect(parseGhcDiagnostics('<interactive>:6:3-5: error:\n    * oops')).toEqual([]);
  });

  it('detects successful loads', () => {
    expect(loadSucceeded('Ok, one module loaded.\n')).toBe(true);
    expect(loadSucceeded('Failed, no modules loaded.\n')).toBe(false);
  });
});

describe('loadSucceeded with several modules', () => {
  it.each(['Ok, one module loaded.', 'Ok, two modules loaded.', 'Ok, twelve modules reloaded.', 'Ok, 21 modules loaded.'])('accepts %s', (line) => {
    expect(loadSucceeded(line)).toBe(true);
  });

  it('does not accept a failed load', () => {
    expect(loadSucceeded('Failed, one module loaded.')).toBe(false);
  });
});
