import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { lintGutter } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, EditorView, placeholder } from '@codemirror/view';
import { classHighlighter, languageFor } from './highlight';

/**
 * The editor behaves like VS Code where it matters: auto-closing brackets,
 * Tab indents (Esc then Tab leaves the editor for keyboard users), Ctrl/Cmd-F
 * search, undo history, bracket matching. Colours come from CSS variables so
 * the theme switch needs no reconfiguration.
 */
export type EditorVariant = 'code' | 'notes' | 'field';

const common = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--sheet)', color: 'var(--ink)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { lineHeight: '1.6', fontFeatureSettings: "'calt' 1, 'liga' 1" },
  '.cm-gutters': { backgroundColor: 'var(--sheet)', color: 'var(--ink-3)', border: 'none', paddingLeft: '6px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-2)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 24%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-matchingBracket, .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', outline: 'none' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--sheet)', color: 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '8px', boxShadow: 'var(--shadow)', fontFamily: 'var(--font-sans)' },
  '.cm-tooltip-lint': { maxWidth: '520px' },
  '.cm-type-doc': { marginTop: '4px', fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--ink-2)', lineHeight: '1.45' },
  '.cm-type-link': { display: 'inline-block', marginTop: '4px', fontFamily: 'var(--font-sans)', fontSize: '12.5px', fontWeight: '500', color: 'var(--accent)' },
  '.cm-type-tip': { padding: '4px 10px', maxWidth: '560px', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '12.5px' },
  '.cm-diagnostic': { padding: '6px 10px', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '12px' },
  '.cm-panels': { backgroundColor: 'var(--sunk)', color: 'var(--ink)', borderColor: 'var(--line)' },
  '.cm-placeholder': { color: 'var(--ink-3)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)', textUnderlineOffset: '3px' },
});

const variants: Record<EditorVariant, Extension> = {
  code: EditorView.theme({ '&': { fontFamily: 'var(--font-mono)', fontSize: 'var(--editor-font-size, 13.5px)' }, '.cm-scroller': { fontFamily: 'inherit' }, '.cm-content': { padding: '12px 0' } }),
  // Notes and text answers: both are Typst a student writes, so they look and feel the same.
  notes: EditorView.theme({
    '&': { fontFamily: 'var(--font-mono)', fontSize: 'var(--editor-font-size, 13.5px)' },
    '.cm-scroller': { fontFamily: 'inherit' },
    '.cm-content': { padding: '14px 16px' },
    '&.cm-editor .cm-activeLine': { backgroundColor: 'transparent' },
  }),
  // A one-line field inside a form (an answer of a quiz card): the same, with the padding of an input.
  field: EditorView.theme({
    '&': { fontFamily: 'var(--font-mono)', fontSize: 'var(--editor-font-size, 13.5px)', backgroundColor: 'transparent' },
    '.cm-scroller': { fontFamily: 'inherit' },
    '.cm-content': { padding: '5px 4px' },
    '&.cm-editor .cm-activeLine': { backgroundColor: 'transparent' },
  }),
};

/** The next or previous thing to focus after `from`, in document order, inside the same dialog if there is one. */
function focusNeighbour(from: HTMLElement, direction: 1 | -1): boolean {
  const root = from.closest<HTMLElement>('[role=dialog]') ?? document.body;
  const all = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable=true], [tabindex]:not([tabindex="-1"])')].filter(
    (el) => el.offsetParent !== null || el === from,
  );
  const target = all[all.indexOf(from) + direction];
  if (!target) return false;
  target.focus();
  return true;
}

/** Tab and Shift+Tab leave the editor, as in a form. For small fields, where indenting is rare. */
const tabLeaves = keymap.of([
  { key: 'Tab', run: (v) => focusNeighbour(v.contentDOM, 1) },
  { key: 'Shift-Tab', run: (v) => focusNeighbour(v.contentDOM, -1) },
]);

export function baseExtensions(opts: {
  language?: string | null;
  lineNumbers?: boolean;
  placeholder?: string;
  wrap?: boolean;
  variant?: EditorVariant;
  completions?: CompletionSource;
  /** Tab goes to the next field instead of indenting. */
  tabMovesFocus?: boolean;
}): Extension[] {
  const lang = opts.language ? languageFor(opts.language) : null;
  return [
    common,
    variants[opts.variant ?? 'code'],
    opts.lineNumbers === false ? [] : [lineNumbers(), highlightActiveLineGutter(), lintGutter()],
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    // Typst offers its snippets while typing; code only on request.
    autocompletion(opts.completions ? { activateOnTyping: true, override: [opts.completions] } : { activateOnTyping: false }),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(classHighlighter),
    lang ?? [],
    opts.wrap ? EditorView.lineWrapping : [],
    opts.placeholder ? placeholder(opts.placeholder) : [],
    EditorState.tabSize.of(2),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, ...(opts.tabMovesFocus ? [] : [indentWithTab])]),
    opts.tabMovesFocus ? tabLeaves : [],
  ];
}
