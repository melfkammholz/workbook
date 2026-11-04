/**
 * A tiny conditional-compilation pass for exercise source files.
 *
 * Authors keep the starter and the reference solution in one file:
 *
 *     instance Num a => Num (D a) where
 *     #ifdef TEMPLATE
 *     #else
 *       D x1 d1 + D x2 d2 = ...
 *     #endif
 *
 * `preprocess(src, {TEMPLATE: true})` yields what the student starts from,
 * `preprocess(src, {})` yields the solution. Only `#ifdef`, `#ifndef`,
 * `#else` and `#endif` are understood — anything else is reported, because
 * silently passing through a stray `#if` would produce confusing Haskell errors.
 *
 * In a file several exercises share, `#ifdef TEMPLATE some-exercise` also says
 * which exercise may reveal that part (see `solutionBlocks`).
 */
export class PreprocessError extends Error {
  constructor(message: string, readonly line: number) {
    super(message);
  }
}

export function preprocess(source: string, defines: Record<string, boolean>): string {
  const out: string[] = [];
  // Stack of { active: branch currently emitted, parentActive, seenElse }.
  const stack: { active: boolean; parentActive: boolean; seenElse: boolean }[] = [];
  const emitting = () => stack.every((s) => s.active);

  source.split('\n').forEach((raw, i) => {
    const lineNo = i + 1;
    const m = /^\s*#\s*(ifdef|ifndef|else|endif|if|elif|define|undef|include)\b\s*(\S*)/.exec(raw);
    if (!m) {
      if (emitting()) out.push(raw);
      return;
    }
    const [, directive, arg] = m as unknown as [string, string, string];
    switch (directive) {
      case 'ifdef':
      case 'ifndef': {
        if (!arg) throw new PreprocessError(`#${directive} needs a name`, lineNo);
        const defined = !!defines[arg];
        const parentActive = emitting();
        stack.push({
          active: directive === 'ifdef' ? defined : !defined,
          parentActive,
          seenElse: false,
        });
        break;
      }
      case 'else': {
        const top = stack[stack.length - 1];
        if (!top) throw new PreprocessError('#else without #ifdef', lineNo);
        if (top.seenElse) throw new PreprocessError('duplicate #else', lineNo);
        top.seenElse = true;
        top.active = !top.active;
        break;
      }
      case 'endif':
        if (!stack.pop()) throw new PreprocessError('#endif without #ifdef', lineNo);
        break;
      default:
        throw new PreprocessError(
          `unsupported directive #${directive}; only #ifdef/#ifndef/#else/#endif are supported`,
          lineNo,
        );
    }
  });
  if (stack.length > 0) throw new PreprocessError('unterminated #ifdef', source.split('\n').length);
  return out.join('\n');
}

/** True if the file contains any conditional that depends on TEMPLATE. */
export function usesTemplateConditionals(source: string): boolean {
  return /^\s*#\s*if(n?def)?\s+TEMPLATE\b/m.test(source);
}

export interface SolutionBlock {
  /** The exercises this part of the solution belongs to, from `#ifdef TEMPLATE id1 id2`. */
  exercises: string[];
  text: string;
}

/**
 * The parts of a file shared by several exercises that an author assigned to an
 * exercise. A part nobody is named on is never shown to a student.
 */
export function solutionBlocks(source: string): SolutionBlock[] {
  const blocks: SolutionBlock[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*#\s*(ifdef|ifndef)\s+TEMPLATE\b(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const exercises = m[2]!.trim().split(/\s+/).filter(Boolean);
    const startsWithSolution = m[1] === 'ifndef';
    let depth = 0;
    let inSolution = startsWithSolution;
    const picked: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const d = /^\s*#\s*(ifdef|ifndef|else|endif)\b/.exec(lines[j]!)?.[1];
      if (d === 'ifdef' || d === 'ifndef') depth++;
      else if (d === 'endif' && depth === 0) break;
      else if (d === 'endif') depth--;
      else if (d === 'else' && depth === 0) {
        inSolution = !inSolution;
        continue;
      }
      if (inSolution) picked.push(lines[j]!);
    }
    i = j;
    if (exercises.length) blocks.push({ exercises, text: picked.join('\n') });
  }
  return blocks;
}
