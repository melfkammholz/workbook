import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { typstParser } from './typst';

/** Maps token types to the same `.tok-*` classes the editor uses, so code in the task text matches code in the editor. */
export const classHighlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self, t.null], class: 'tok-keyword' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.meta], class: 'tok-type' },
  { tag: [t.string, t.special(t.string), t.character, t.regexp, t.attributeValue], class: 'tok-string' },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom], class: 'tok-number' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tok-comment' },
  { tag: [t.definition(t.variableName), t.function(t.variableName), t.standard(t.variableName), t.propertyName, t.attributeName, t.labelName], class: 'tok-def' },
  { tag: [t.operator, t.punctuation], class: 'tok-op' },
  { tag: t.heading, class: 'tok-heading' },
  { tag: t.strong, class: 'tok-strong' },
  { tag: t.emphasis, class: 'tok-emph' },
  { tag: [t.link, t.url], class: 'tok-link' },
  { tag: t.escape, class: 'tok-op' },
]);

/**
 * The legacy Haskell mode calls type and constructor names `variable-2` or `builtin`, which reads as plain text. Short
 * inline code (`Maybe a`, `Just x`) is mostly such names, so they are types here, as in the editor.
 */
const haskellTypes: StreamParser<unknown> = {
  ...(haskell as StreamParser<unknown>),
  token(stream, state) {
    const style = (haskell as StreamParser<unknown>).token(stream, state);
    return (style === 'variable-2' || style === 'builtin') && /^[A-Z]/.test(stream.current()) ? 'typeName' : style;
  },
};

/** The Prolog tokenizer: enough for readable highlighting of facts, rules and queries. */
function prologToken(stream: StringStream, state: { block: boolean }): string | null {
  if (state.block) {
    if (stream.skipTo('*/')) {
      stream.match('*/');
      state.block = false;
    } else stream.skipToEnd();
    return 'comment';
  }
  if (stream.eatSpace()) return null;
  if (stream.match('/*')) {
    state.block = true;
    return 'comment';
  }
  if (stream.eat('%')) {
    stream.skipToEnd();
    return 'comment';
  }
  const q = stream.peek();
  if (q === '"' || q === "'" || q === '`') {
    stream.next();
    let escaped = false;
    let c: string | void;
    while ((c = stream.next()) != null) {
      if (c === q && !escaped) break;
      escaped = !escaped && c === '\\';
    }
    return q === "'" ? 'atom' : 'string';
  }
  if (stream.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
  if (stream.match(/^[A-Z_][A-Za-z0-9_]*/)) return 'variableName';
  if (stream.match(/^[a-z][A-Za-z0-9_]*/)) return stream.match(/^(?=\()/, false) ? 'variableName.function' : 'atom';
  if (stream.match(/^(:-|-->|\\\+|=\.\.|=:=|=\\=|\\==|==|=<|>=|=|<|>|is\b|->|;|\|)/)) return 'operator';
  stream.next();
  return 'punctuation';
}

const prolog: StreamParser<{ block: boolean }> = {
  startState: () => ({ block: false }),
  token: prologToken,
  languageData: { commentTokens: { line: '%', block: { open: '/*', close: '*/' } } },
};

/**
 * The notation of SLD trees (https://github.com/melfkammholz/sldcheck): lines starting with `?-` are nodes, lines
 * starting with `|` are steps, and what they contain is Prolog. The bars that give the tree its structure are
 * operators, so they recede; the words of the notation are keywords; the names of nodes (`@c`) and the numbers of
 * clauses (`#2`) are marked where they stand.
 */
const sld: StreamParser<{ block: boolean; line: 'node' | 'step' | 'other' | null }> = {
  startState: () => ({ block: false, line: null }),
  token(stream, state) {
    if (stream.sol()) state.line = null;
    if (state.block) return prologToken(stream, state);
    if (stream.eatSpace()) return null;
    // The first thing on a line says what kind of line it is.
    if (state.line === null) {
      if (stream.match('?-')) {
        state.line = 'node';
        return 'operator';
      }
      if (stream.peek() === '|' && !stream.match(/^\|->/, false)) {
        stream.next();
        state.line = 'step';
        return 'operator';
      }
      state.line = 'other';
    }
    if (stream.match(/^@[A-Za-z0-9_]+/)) return 'typeName';
    if (stream.match('|->')) return 'operator';
    if (stream.eat('!')) return 'keyword';
    if (state.line === 'step') {
      // As in the notation: not a word of a longer name, and not the start of a term such as `fails(x)` or `by.`.
      if (stream.match(/^(?:pruned|builtin|fails|by)(?![A-Za-z0-9_(.])/) || stream.match(/^no\s+rule(?![A-Za-z0-9_(.])/)) return 'keyword';
      if (stream.match(/^#\d+/)) return 'number';
    }
    return prologToken(stream, state);
  },
  languageData: { commentTokens: { line: '%', block: { open: '/*', close: '*/' } } },
};

type Parser = StreamParser<unknown>;
/** Built in: the course's own languages, which nearly every page shows. */
const builtIn: Record<string, Parser> = { typst: typstParser, haskell: haskellTypes, prolog, sld } as unknown as Record<string, Parser>;
/** Everything else is loaded the first time a text or editor asks for it. */
const lazy: Record<string, () => Promise<unknown>> = {
  python: () => import('@codemirror/legacy-modes/mode/python').then((m) => m.python),
  c: () => import('@codemirror/legacy-modes/mode/clike').then((m) => m.c),
  cpp: () => import('@codemirror/legacy-modes/mode/clike').then((m) => m.cpp),
  csharp: () => import('@codemirror/legacy-modes/mode/clike').then((m) => m.csharp),
  java: () => import('@codemirror/legacy-modes/mode/clike').then((m) => m.java),
  kotlin: () => import('@codemirror/legacy-modes/mode/clike').then((m) => m.kotlin),
  scala: () => import('@codemirror/legacy-modes/mode/clike').then((m) => m.scala),
  dart: () => import('@codemirror/legacy-modes/mode/clike').then((m) => m.dart),
  javascript: () => import('@codemirror/legacy-modes/mode/javascript').then((m) => m.javascript),
  typescript: () => import('@codemirror/legacy-modes/mode/javascript').then((m) => m.typescript),
  json: () => import('@codemirror/legacy-modes/mode/javascript').then((m) => m.json),
  rust: () => import('@codemirror/legacy-modes/mode/rust').then((m) => m.rust),
  go: () => import('@codemirror/legacy-modes/mode/go').then((m) => m.go),
  swift: () => import('@codemirror/legacy-modes/mode/swift').then((m) => m.swift),
  ruby: () => import('@codemirror/legacy-modes/mode/ruby').then((m) => m.ruby),
  perl: () => import('@codemirror/legacy-modes/mode/perl').then((m) => m.perl),
  lua: () => import('@codemirror/legacy-modes/mode/lua').then((m) => m.lua),
  r: () => import('@codemirror/legacy-modes/mode/r').then((m) => m.r),
  julia: () => import('@codemirror/legacy-modes/mode/julia').then((m) => m.julia),
  shell: () => import('@codemirror/legacy-modes/mode/shell').then((m) => m.shell),
  sql: () => import('@codemirror/legacy-modes/mode/sql').then((m) => m.standardSQL),
  css: () => import('@codemirror/legacy-modes/mode/css').then((m) => m.css),
  html: () => import('@codemirror/legacy-modes/mode/xml').then((m) => m.html),
  xml: () => import('@codemirror/legacy-modes/mode/xml').then((m) => m.xml),
  yaml: () => import('@codemirror/legacy-modes/mode/yaml').then((m) => m.yaml),
  toml: () => import('@codemirror/legacy-modes/mode/toml').then((m) => m.toml),
  ocaml: () => import('@codemirror/legacy-modes/mode/mllike').then((m) => m.oCaml),
  fsharp: () => import('@codemirror/legacy-modes/mode/mllike').then((m) => m.fSharp),
  sml: () => import('@codemirror/legacy-modes/mode/mllike').then((m) => m.sml),
  scheme: () => import('@codemirror/legacy-modes/mode/scheme').then((m) => m.scheme),
  clojure: () => import('@codemirror/legacy-modes/mode/clojure').then((m) => m.clojure),
  lisp: () => import('@codemirror/legacy-modes/mode/commonlisp').then((m) => m.commonLisp),
  erlang: () => import('@codemirror/legacy-modes/mode/erlang').then((m) => m.erlang),
  elm: () => import('@codemirror/legacy-modes/mode/elm').then((m) => m.elm),
};
const loaded: Record<string, Parser> = { ...builtIn };
const loading = new Map<string, Promise<StreamLanguage<unknown> | null>>();
const languages = new Map<string, StreamLanguage<unknown>>();

const ALIASES: Record<string, string> = {
  hs: 'haskell',
  lhs: 'haskell',
  pl: 'prolog',
  swipl: 'prolog',
  pro: 'prolog',
  py: 'python',
  python3: 'python',
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  kt: 'kotlin',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  rs: 'rust',
  golang: 'go',
  rb: 'ruby',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  console: 'shell',
  yml: 'yaml',
  svg: 'xml',
  ml: 'ocaml',
  fs: 'fsharp',
  scm: 'scheme',
  racket: 'scheme',
  clj: 'clojure',
  commonlisp: 'lisp',
  cl: 'lisp',
  erl: 'erlang',
  typ: 'typst',
  jl: 'julia',
};

const nameOf = (raw: string) => ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();

/** The language, if it is known and loaded; `loadLanguage` loads one that is known. */
export function languageFor(raw: string): StreamLanguage<unknown> | null {
  const name = nameOf(raw);
  // `Object.hasOwn`: a code block tagged "constructor" must not find a function on the prototype.
  const p = Object.hasOwn(loaded, name) ? loaded[name] : undefined;
  if (!p) return null;
  let l = languages.get(name);
  if (!l) languages.set(name, (l = StreamLanguage.define(p)));
  return l;
}

/** Whether `raw` names a language that can be highlighted once it is loaded. */
export function isKnown(raw: string): boolean {
  const name = nameOf(raw);
  return Object.hasOwn(loaded, name) || Object.hasOwn(lazy, name);
}

/** Loads a language; null if there is none by that name or it cannot be loaded (then it counts as unknown). */
export function loadLanguage(raw: string): Promise<StreamLanguage<unknown> | null> {
  const name = nameOf(raw);
  const have = languageFor(name);
  if (have || !Object.hasOwn(lazy, name)) return Promise.resolve(have);
  let p = loading.get(name);
  if (!p) {
    p = lazy[name]!().then(
      (parser) => {
        loaded[name] = parser as Parser;
        return languageFor(name);
      },
      () => {
        delete lazy[name];
        return null;
      },
    );
    loading.set(name, p);
  }
  return p;
}

/** Highlights `code` into an HTML string (already escaped). */
export function highlightToHtml(code: string, lang: string): string | null {
  const language = languageFor(lang);
  if (!language) return null;
  const tree = language.parser.parse(code);
  let out = '';
  let pos = 0;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  highlightTree(tree, classHighlighter, (from, to, cls) => {
    if (from > pos) out += esc(code.slice(pos, from));
    out += `<span class="${cls}">${esc(code.slice(from, to))}</span>`;
    pos = to;
  });
  return out + esc(code.slice(pos));
}
