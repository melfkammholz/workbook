export interface DiffLines {
  /** For each line of `a`: does it also appear, in order, in `b`? */
  a: boolean[];
  b: boolean[];
}

const squeeze = (line: string) => line.replace(/\s+/g, ' ').trim();

/** Beyond this, working it out would freeze the page, and nobody reads a diff that long anyway. */
const MAX_CELLS = 4_000_000;

/** Which lines two texts have in common, by longest common subsequence. Spacing does not count: lining things up differently is not a difference. */
export function commonLines(left: string, right: string): DiffLines | null {
  const a = left.split('\n').map(squeeze);
  const b = right.split('\n').map(squeeze);
  if (a.length * b.length > MAX_CELLS) return null;
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  const out: DiffLines = { a: a.map(() => false), b: b.map(() => false) };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.a[i++] = true;
      out.b[j++] = true;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
  return out;
}
