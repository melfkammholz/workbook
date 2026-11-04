import { describe, expect, it } from 'vitest';
import { preprocess, PreprocessError } from '../src/content/cpp.js';

const src = ['a', '#ifdef TEMPLATE', 'stub', '#else', 'solution', '#endif', 'b'].join('\n');

describe('preprocess', () => {
  it('keeps the TEMPLATE branch for the starter', () => {
    expect(preprocess(src, { TEMPLATE: true })).toBe('a\nstub\nb');
  });
  it('keeps the #else branch for the solution', () => {
    expect(preprocess(src, {})).toBe('a\nsolution\nb');
  });
  it('supports #ifndef and nesting', () => {
    const s = '#ifndef TEMPLATE\nx\n#ifdef OTHER\ny\n#endif\n#endif';
    expect(preprocess(s, {})).toBe('x');
    expect(preprocess(s, { TEMPLATE: true })).toBe('');
  });
  it('leaves ordinary lines starting with other characters alone', () => {
    expect(preprocess('x # not a directive\n  -- #ifdef in a comment', {})).toBe('x # not a directive\n  -- #ifdef in a comment');
  });
  it('rejects unsupported and unbalanced directives', () => {
    expect(() => preprocess('#if FOO\n#endif', {})).toThrow(PreprocessError);
    expect(() => preprocess('#ifdef A', {})).toThrow(/unterminated/);
    expect(() => preprocess('#endif', {})).toThrow(/without/);
  });
});
