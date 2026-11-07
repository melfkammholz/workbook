export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const EMOJI = [
  '🦊', '🐻', '🐝', '🦉', '🦔', '🦦', '🐧', '🐢', '🦒', '🐘', '🦋', '🐙', '🦜', '🐳', '🦎',
  '🐼', '🦘', '🦥', '🐿️', '🦚', '🐺', '🦓', '🐨', '🦁', '🐯', '🦩', '🐞', '🐬', '🦭', '🦫',
];

/** FNV-1a, so the emoji for an exercise stays the same across updates and machines. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function emojiFor(id: string): string {
  return EMOJI[hash(id) % EMOJI.length]!;
}

/** Best-effort one-line title from Typst source, for exercises without an explicit title. */
export function deriveTitle(typstSource: string, max = 64): string {
  const text = typstSource
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/#(?:xref)\(\s*"[^"]*"\s*(?:,[^)]*)?\)/g, '…')
    .replace(/#[a-zA-Z][\w-]*(?:\([^)]*\))?/g, ' ')
    .replace(/\$[^$]*\$/g, '…')
    .replace(/[*_`\[\]#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Untitled';
  const firstSentence = text.split(/(?<=[.?!:])\s/)[0] ?? text;
  const s = firstSentence.length >= 12 ? firstSentence : text;
  if (s.length <= max) return s.replace(/[.:]$/, '');
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).trimEnd() + '…';
}

/** "Deklarative Programmierung" → "deklarative-programmierung". Umlauts become their usual spelling. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'course';
}
