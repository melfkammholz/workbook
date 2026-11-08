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
  front: string;
  back: string;
  paramFrom: string;
  paramTags: string;
  paramBoth: string;
  quiz: string;
  choice: string;
  choiceCorrect: string;
  question: string;
  answer: string;
  why: string;
  paramCorrect: string;
}

const LANGUAGES = ['haskell', 'prolog', 'sld', 'python', 'java', 'c', 'typst', 'text'];

/** Snippets that start with `#`. */
function hashSnippets(l: CompletionLabels): Completion[] {
  return [
    snippetCompletion(`#flashcard[\n  \${${l.front}}\n][\n  \${${l.back}}\n]`, { label: '#flashcard', detail: l.flashcard, boost: 3 }),
    snippetCompletion(`#flashcard(both: true)[\n  \${${l.front}}\n][\n  \${${l.back}}\n]`, { label: '#flashcard(both: true)', detail: l.flashcardBoth, boost: 2 }),
    snippetCompletion('#cloze[\n  ${} {{${}}}\n]', { label: '#cloze', detail: l.cloze, boost: 2 }),
    snippetCompletion(`#quiz(\n  [\${${l.question}}],\n  choice[\${${l.answer}}][\${${l.why}}],\n  choice(correct: true)[\${${l.answer}}][\${${l.why}}],\n)`, { label: '#quiz', detail: l.quiz, boost: 2 }),
    snippetCompletion('#strong[${}]', { label: '#strong', detail: l.strong }),
    snippetCompletion('#emph[${}]', { label: '#emph', detail: l.emph }),
    snippetCompletion('#link("${https://}")[${}]', { label: '#link', detail: l.link }),
    snippetCompletion('#table(\n  columns: ${2},\n  [${}], [${}],\n)', { label: '#table', detail: l.table }),
    snippetCompletion('#image("${}")', { label: '#image', detail: l.image }),
    snippetCompletion('#diagram[\n  ${}\n]', { label: '#diagram', detail: l.diagram }),
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

/** A call the cursor is inside: its name, and whether the cursor is between its parentheses (code) or in a `[…]` body (markup). */
interface Enclosing {
  name: string;
  /** Between the parentheses, where arguments go. */
  args: boolean;
  /** Where the call's arguments start, for the named arguments already given. */
  from: number;
}

/**
 * The calls around a position, innermost last. Reads the text from the start, so a call written over
 * several lines (a `#quiz` with its choices) is found too. Strings, raw text, math and comments are
 * skipped; a bracket in them does not count.
 */
export function enclosingCalls(text: string, pos: number): Enclosing[] {
  const stack: { name: string; open: '(' | '[' | '{'; at: number }[] = [];
  let i = 0;
  let lastClosed = '';
  const code = () => stack.length > 0 && stack[stack.length - 1]!.open !== '[';
  while (i < pos) {
    const c = text[i]!;
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? pos : end;
      continue;
    }
    if (c === '`') {
      const fence = text.startsWith('```', i) ? '```' : '`';
      const end = text.indexOf(fence, i + fence.length);
      if (end < 0 || end + fence.length > pos) return [];
      i = end + fence.length;
      continue;
    }
    if (c === '"' && code()) {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (j >= pos) return [];
      i = j + 1;
      continue;
    }
    if (c === '$' && !code()) {
      const end = text.indexOf('$', i + 1);
      if (end < 0 || end >= pos) return [];
      i = end + 1;
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      // The name right before (`#quiz(`, `choice[`); a body right after a call's `)` or `]` belongs to that call.
      const follows = c === '[' && (text[i - 1] === ')' || text[i - 1] === ']');
      const named = /#?([A-Za-z_][\w-]*)$/.exec(text.slice(Math.max(0, i - 40), i));
      stack.push({ name: follows ? lastClosed : (named?.[1] ?? ''), open: c, at: i + 1 });
    } else if (c === ')' || c === ']' || c === '}') {
      const top = stack.pop();
      if (top) lastClosed = top.name;
    }
    i++;
  }
  return stack.filter((f) => f.open !== '{').map((f) => ({ name: f.name, args: f.open === '(', from: f.at }));
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
    // Inside a `#quiz(…)`, written over several lines: its choices and named arguments.
    const calls = enclosingCalls(ctx.state.doc.sliceString(0, ctx.pos), ctx.pos);
    const inner = calls[calls.length - 1];
    if (inner?.args && (inner.name === 'quiz' || inner.name === 'choice')) {
      const word = ctx.matchBefore(/[\w-]*/);
      const before = ctx.state.doc.sliceString(inner.from, word?.from ?? ctx.pos).trimEnd();
      if (inner.name === 'choice') {
        if (/correct:\s*$/.test(before)) return { from: ctx.pos, options: ['true', 'false'].map((v) => ({ label: v, type: 'keyword' })) };
        if (before === '') return { from: word?.from ?? ctx.pos, options: [snippetCompletion('correct: ${true}', { label: 'correct', detail: `: bool · ${l.paramCorrect}`, type: 'property' })], validFor: /^[\w-]*$/ };
        return null;
      }
      if (/from:\s*$/.test(before)) return { from: ctx.pos, options: exercises.map((e) => ({ label: e.title, detail: e.id, apply: `"${typstContext.course}/${e.id}"`, type: 'text' })) };
      if (before === '' || before.endsWith(',')) {
        const present = new Set([...before.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]));
        const options: Completion[] = [
          snippetCompletion(`choice[\${${l.answer}}][\${${l.why}}]`, { label: 'choice', detail: l.choice, type: 'function', boost: 2 }),
          snippetCompletion(`choice(correct: true)[\${${l.answer}}][\${${l.why}}]`, { label: 'choice(correct: true)', detail: l.choiceCorrect, type: 'function', boost: 1 }),
          ...(before === '' ? [snippetCompletion(`[\${${l.question}}]`, { label: '[…]', detail: l.question, type: 'text' })] : []),
          snippetCompletion('from: "${}"', { label: 'from', detail: `: str · ${l.paramFrom}`, type: 'property' }),
          snippetCompletion('tags: ("${}",)', { label: 'tags', detail: `: array · ${l.paramTags}`, type: 'property' }),
        ].filter((o) => !present.has(o.label));
        // Typing a name offers it at once; on an empty line only when asked, so pressing Enter stays Enter.
        if (!word?.text && !ctx.explicit) return null;
        return { from: word?.from ?? ctx.pos, options, validFor: /^[\w-]*$/ };
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
