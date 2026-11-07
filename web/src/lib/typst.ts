import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { StreamParser, StringStream } from '@codemirror/language';

/**
 * Typst for the editors: highlighting and completions. Enough of Typst to read
 * a note or a deck at a glance: functions, strings, math, raw text, comments,
 * headings, emphasis and cloze gaps.
 */

type Mode = 'markup' | 'code' | 'math';
interface TypstState {
  /** What each open bracket returns to. The bottom is the document's markup. */
  stack: { mode: Mode; close: string }[];
  /** Inside a ``` block, its fence. */
  fence: string | null;
  blockComment: boolean;
  /** A `#let` or `#set` line is code until its end. */
  codeLine: boolean;
}

const KEYWORDS = new Set(['let', 'set', 'show', 'import', 'include', 'if', 'else', 'for', 'in', 'while', 'return', 'break', 'continue', 'context', 'as', 'and', 'or', 'not']);
const CONSTANTS = new Set(['none', 'auto', 'true', 'false']);

const mode = (s: TypstState): Mode => (s.codeLine ? 'code' : (s.stack[s.stack.length - 1]?.mode ?? 'markup'));

function rawSpan(stream: StringStream, state: TypstState): string {
  let n = 0;
  while (stream.eat('`')) n++;
  if (n === 2) return 'string';
  if (n >= 3) {
    const fence = '`'.repeat(n);
    stream.match(/^[\w-]*/);
    if (stream.skipTo(fence)) stream.match(fence);
    else {
      stream.skipToEnd();
      state.fence = fence;
    }
    return 'string';
  }
  if (stream.skipTo('`')) stream.next();
  else stream.skipToEnd();
  return 'string';
}

export const typstParser: StreamParser<TypstState> = {
  name: 'typst',
  startState: () => ({ stack: [], fence: null, blockComment: false, codeLine: false }),
  copyState: (s) => ({ stack: s.stack.map((x) => ({ ...x })), fence: s.fence, blockComment: s.blockComment, codeLine: s.codeLine }),
  token(stream, state) {
    if (stream.sol() && state.codeLine && !stream.string.trimEnd().endsWith('\\')) state.codeLine = false;
    if (state.fence) {
      if (stream.skipTo(state.fence)) {
        stream.match(state.fence);
        state.fence = null;
      } else stream.skipToEnd();
      return 'string';
    }
    if (state.blockComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/');
        state.blockComment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.blockComment = true;
      return 'comment';
    }
    const m = mode(state);
    const top = state.stack[state.stack.length - 1];
    if (top && stream.peek() === top.close) {
      stream.next();
      state.stack.pop();
      return 'bracket';
    }

    if (m === 'math') {
      if (stream.match(/^[\p{L}][\p{L}.]*/u)) return 'variableName';
      if (stream.match(/^\d+(\.\d+)?/)) return 'number';
      if (stream.match('"')) {
        while (!stream.eol() && stream.next() !== '"');
        return 'string';
      }
      if (stream.eat('(')) state.stack.push({ mode: 'math', close: ')' });
      else stream.next();
      return 'operator';
    }

    if (m === 'code') {
      if (stream.eatSpace()) return null;
      if (stream.peek() === '"') {
        stream.next();
        let c: string | void;
        while ((c = stream.next()) != null && c !== '"') if (c === '\\') stream.next();
        return 'string';
      }
      if (stream.match(/^\d+(\.\d+)?(pt|mm|cm|in|em|fr|%|deg|rad)?/)) return 'number';
      const word = stream.match(/^[\p{L}_][\p{L}\p{N}_-]*/u) as RegExpMatchArray | null;
      if (word) {
        const w = word[0];
        if (KEYWORDS.has(w)) return 'keyword';
        if (CONSTANTS.has(w)) return 'atom';
        if (stream.match(/^\s*:/, false)) return 'propertyName';
        if (stream.match(/^[([]/, false)) return 'variableName.function';
        return 'variableName';
      }
      if (stream.eat('(')) state.stack.push({ mode: 'code', close: ')' });
      else if (stream.eat('{')) state.stack.push({ mode: 'code', close: '}' });
      else if (stream.eat('[')) state.stack.push({ mode: 'markup', close: ']' });
      else if (stream.eat('$')) state.stack.push({ mode: 'math', close: '$' });
      else {
        stream.next();
        return 'operator';
      }
      return 'bracket';
    }

    // markup
    if (stream.sol()) {
      if (stream.match(/^\s*=+\s.*$/)) return 'heading';
      if (stream.match(/^\s*([-+]|\d+\.)(?=\s)/)) return 'operator';
    }
    if (stream.eat('\\')) {
      stream.next();
      return 'escape';
    }
    if (stream.peek() === '`') return rawSpan(stream, state);
    if (stream.match('{{')) {
      // A cloze gap.
      if (stream.skipTo('}}')) stream.match('}}');
      else stream.skipToEnd();
      return 'meta';
    }
    if (stream.eat('$')) {
      state.stack.push({ mode: 'math', close: '$' });
      return 'operator';
    }
    if (stream.eat('#')) {
      const word = stream.match(/^[\p{L}_][\p{L}\p{N}_.-]*/u) as RegExpMatchArray | null;
      if (word) {
        if (word[0] === 'let' || word[0] === 'set' || word[0] === 'show' || word[0] === 'import' || word[0] === 'include') {
          state.codeLine = true;
          return 'keyword';
        }
        if (stream.eat('(')) state.stack.push({ mode: 'code', close: ')' });
        else if (stream.eat('[')) state.stack.push({ mode: 'markup', close: ']' });
        return 'variableName.function';
      }
      if (stream.eat('(')) state.stack.push({ mode: 'code', close: ')' });
      else if (stream.eat('{')) state.stack.push({ mode: 'code', close: '}' });
      return 'keyword';
    }
    // Trailing content blocks of a call: `#f[a][b]`.
    if (stream.peek() === '[') {
      stream.next();
      state.stack.push({ mode: 'markup', close: ']' });
      return 'bracket';
    }
    if (stream.match(/^\*[^*\n]+\*/)) return 'strong';
    if (stream.match(/^_[^_\n]+_/)) return 'emphasis';
    if (stream.match(/^@[\w-]+/) || stream.match(/^<[\w.:-]+>/)) return 'labelName';
    if (stream.match(/^https?:\/\/\S+/)) return 'link';
    stream.next();
    stream.eatWhile(/[^\\`$#[\]{}*_@<\n/]/);
    return null;
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
};

// ───────────────────────── completions ─────────────────────────

export interface TypstContext {
  /** Stable id of the open course, for `from:`. */
  course: string | null;
  exercises: { id: string; title: string }[];
  tags: { id: string; label: string }[];
}

/** Kept current by the app as the open course changes, so every editor offers its exercises and tags. */
export const typstContext: TypstContext = { course: null, exercises: [], tags: [] };

/** A tag as students know it: its label in the open course, else the id written on the card. */
export const tagLabel = (id: string) => typstContext.tags.find((k) => k.id === id)?.label ?? id;

export interface CompletionLabels {
  flashcard: string;
  flashcardBoth: string;
  cloze: string;
  codeBlock: string;
  math: string;
  mathInline: string;
  heading: string;
  list: string;
  numbered: string;
  strong: string;
  emph: string;
  link: string;
  table: string;
  image: string;
  diagram: string;
  importPackage: string;
  front: string;
  back: string;
  paramFrom: string;
  paramTags: string;
  paramBoth: string;
}

const LANGUAGES = ['haskell', 'prolog', 'python', 'java', 'c', 'typst', 'text'];

/** Snippets that start with `#`. */
function hashSnippets(l: CompletionLabels): Completion[] {
  return [
    snippetCompletion(`#flashcard[\n  \${${l.front}}\n][\n  \${${l.back}}\n]`, { label: '#flashcard', detail: l.flashcard, boost: 3 }),
    snippetCompletion(`#flashcard(both: true)[\n  \${${l.front}}\n][\n  \${${l.back}}\n]`, { label: '#flashcard(both: true)', detail: l.flashcardBoth, boost: 2 }),
    snippetCompletion('#cloze[\n  ${} {{${}}}\n]', { label: '#cloze', detail: l.cloze, boost: 2 }),
    snippetCompletion('#strong[${}]', { label: '#strong', detail: l.strong }),
    snippetCompletion('#emph[${}]', { label: '#emph', detail: l.emph }),
    snippetCompletion('#link("${https://}")[${}]', { label: '#link', detail: l.link }),
    snippetCompletion('#table(\n  columns: ${2},\n  [${}], [${}],\n)', { label: '#table', detail: l.table }),
    snippetCompletion('#image("${}")', { label: '#image', detail: l.image }),
    snippetCompletion('#diagram[\n  ${}\n]', { label: '#diagram', detail: l.diagram }),
    snippetCompletion('#import "@preview/${package}:${version}": ${}', { label: '#import "@preview/…"', detail: l.importPackage }),
  ];
}

/** Typst basics, offered when asked for (Ctrl+Space) where nothing more specific fits. */
function basics(l: CompletionLabels): Completion[] {
  return [
    snippetCompletion('```${haskell}\n${}\n```', { label: '```', detail: l.codeBlock }),
    snippetCompletion('$ ${} $', { label: '$ $', detail: l.math }),
    snippetCompletion('$${}$', { label: '$…$', detail: l.mathInline }),
    snippetCompletion('= ${}', { label: '=', detail: l.heading }),
    snippetCompletion('- ${}', { label: '-', detail: l.list }),
    snippetCompletion('+ ${}', { label: '+', detail: l.numbered }),
    snippetCompletion('*${}*', { label: '*…*', detail: l.strong }),
    snippetCompletion('_${}_', { label: '_…_', detail: l.emph }),
  ];
}

/**
 * Completions for any Typst editor: card snippets after `#`, the open course's
 * exercises inside `from: "` and `#xref("`, its tags inside `tags:`, languages after
 * a code fence, and the basics on request.
 */
export function typstCompletions(labels: () => CompletionLabels) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const l = labels();
    const exercises = typstContext.exercises;

    const from = ctx.matchBefore(/from:\s*"[^"\n]*/);
    if (from && typstContext.course) {
      const start = from.from + from.text.indexOf('"') + 1;
      return { from: start, to: ctx.pos, options: exercises.map((e) => ({ label: e.title, detail: e.id, apply: `${typstContext.course}/${e.id}`, type: 'text' })), filter: true };
    }
    const xref = ctx.matchBefore(/#xref\(\s*"[^"\n]*/);
    if (xref) {
      const start = xref.from + xref.text.indexOf('"') + 1;
      return { from: start, options: exercises.map((e) => ({ label: e.title, detail: e.id, apply: e.id, type: 'text' })) };
    }
    const tag = ctx.matchBefore(/tags:\s*(\([^)\n]*)?"[^"\n]*/);
    if (tag) {
      const start = tag.from + tag.text.lastIndexOf('"') + 1;
      return { from: start, options: typstContext.tags.map((t) => ({ label: t.label, detail: t.id, apply: t.id, type: 'text' })) };
    }

    // Inside `#flashcard(…)` or `#cloze(…)`: the named arguments, and their values.
    const call = ctx.matchBefore(/#(flashcard|cloze)\((?:[^()\n]|\([^()\n]*\))*/);
    if (call) {
      const cloze = call.text.startsWith('#cloze');
      // A value right after `from:` or `tags:`, before any quote.
      if (/from:\s*$/.test(call.text)) {
        return { from: ctx.pos, options: exercises.map((e) => ({ label: e.title, detail: e.id, apply: `"${typstContext.course}/${e.id}"`, type: 'text' })) };
      }
      if (/tags:\s*\(?$/.test(call.text)) {
        const open = call.text.endsWith('(');
        return { from: ctx.pos, options: typstContext.tags.map((t) => ({ label: t.label, detail: t.id, apply: open ? `"${t.id}",` : `("${t.id}",)`, type: 'text' })) };
      }
      if (/both:\s*$/.test(call.text)) return { from: ctx.pos, options: ['true', 'false'].map((v) => ({ label: v, type: 'keyword' })) };
      const word = ctx.matchBefore(/[\w-]*/);
      const before = call.text.slice(0, call.text.length - (word?.text.length ?? 0)).trimEnd();
      if (before.endsWith('(') || before.endsWith(',')) {
        const present = new Set([...call.text.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]));
        const params: Completion[] = [
          snippetCompletion('from: "${}"', { label: 'from', detail: `: str · ${l.paramFrom}`, type: 'property' }),
          snippetCompletion('tags: ("${}",)', { label: 'tags', detail: `: array · ${l.paramTags}`, type: 'property' }),
          ...(cloze ? [] : [snippetCompletion('both: ${true}', { label: 'both', detail: `: bool · ${l.paramBoth}`, type: 'property' })]),
        ];
        return { from: word?.from ?? ctx.pos, options: params.filter((p) => !present.has(p.label)), validFor: /^[\w-]*$/ };
      }
    }
    const fence = ctx.matchBefore(/^\s*```[\w-]*/);
    if (fence) {
      const start = fence.from + fence.text.indexOf('`');
      return { from: start, options: LANGUAGES.map((lang) => snippetCompletion(`\`\`\`${lang}\n\${}\n\`\`\``, { label: `\`\`\`${lang}`, detail: l.codeBlock })) };
    }
    const hash = ctx.matchBefore(/#[\w-]*/);
    if (hash) return { from: hash.from, options: hashSnippets(l), validFor: /^#[\w-]*$/ };
    if (ctx.explicit) {
      const word = ctx.matchBefore(/\S*/);
      return { from: word?.from ?? ctx.pos, options: [...basics(l), ...hashSnippets(l)] };
    }
    return null;
  };
}
