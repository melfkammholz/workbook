import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import { c, cpp, csharp, dart, java, kotlin, scala } from '@codemirror/legacy-modes/mode/clike';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { commonLisp } from '@codemirror/legacy-modes/mode/commonlisp';
import { css } from '@codemirror/legacy-modes/mode/css';
import { elm } from '@codemirror/legacy-modes/mode/elm';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { go } from '@codemirror/legacy-modes/mode/go';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { fSharp, oCaml, sml } from '@codemirror/legacy-modes/mode/mllike';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { python } from '@codemirror/legacy-modes/mode/python';
import { r } from '@codemirror/legacy-modes/mode/r';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { scheme } from '@codemirror/legacy-modes/mode/scheme';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { html, xml } from '@codemirror/legacy-modes/mode/xml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';

/** Maps token types to the same `.tok-*` classes the editor uses, so code in the task text matches code in the editor. */
export const classHighlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self, t.null], class: 'tok-keyword' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.meta], class: 'tok-type' },
  { tag: [t.string, t.special(t.string), t.character, t.regexp, t.attributeValue], class: 'tok-string' },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom], class: 'tok-number' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tok-comment' },
  { tag: [t.definition(t.variableName), t.function(t.variableName), t.standard(t.variableName), t.propertyName, t.attributeName, t.labelName], class: 'tok-def' },
  { tag: [t.operator, t.punctuation], class: 'tok-op' },
]);

/** A small Prolog tokenizer: enough for readable highlighting of facts, rules and queries. */
const prolog: StreamParser<{ block: boolean }> = {
  startState: () => ({ block: false }),
  token(stream: StringStream, state) {
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
  },
  languageData: { commentTokens: { line: '%', block: { open: '/*', close: '*/' } } },
};

const parsers = {
  haskell,
  prolog,
  python,
  c,
  cpp,
  csharp,
  java,
  kotlin,
  scala,
  dart,
  javascript,
  typescript,
  json,
  rust,
  go,
  swift,
  ruby,
  perl,
  lua,
  r,
  julia,
  shell,
  sql: standardSQL,
  css,
  html,
  xml,
  yaml,
  toml,
  ocaml: oCaml,
  fsharp: fSharp,
  sml,
  scheme,
  clojure,
  lisp: commonLisp,
  erlang,
  elm,
} as unknown as Record<string, StreamParser<unknown>>;
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
  jl: 'julia',
};

export function languageFor(raw: string): StreamLanguage<unknown> | null {
  const name = ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
  // `Object.hasOwn`: a code block tagged "constructor" must not find a function on the prototype.
  const p = Object.hasOwn(parsers, name) ? parsers[name] : undefined;
  if (!p) return null;
  let l = languages.get(name);
  if (!l) languages.set(name, (l = StreamLanguage.define(p)));
  return l;
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
