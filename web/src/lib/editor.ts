import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
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
export type EditorVariant = 'code' | 'prose' | 'notes';

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
  // Free-text answers read like the task text: same typeface, wide leading, limited measure.
  prose: EditorView.theme({
    '&': { fontFamily: 'var(--font-sans)', fontSize: 'calc(var(--editor-font-size, 13.5px) + 1.5px)' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.65', fontFeatureSettings: 'normal' },
    '.cm-content': { padding: '16px 20px', maxWidth: '70ch' },
    '&.cm-editor .cm-activeLine': { backgroundColor: 'transparent' },
  }),
  notes: EditorView.theme({
    '&': { fontFamily: 'var(--font-mono)', fontSize: 'var(--editor-font-size, 13.5px)' },
    '.cm-scroller': { fontFamily: 'inherit' },
    '.cm-content': { padding: '14px 16px' },
    '&.cm-editor .cm-activeLine': { backgroundColor: 'transparent' },
  }),
};

export function baseExtensions(opts: { language?: string | null; lineNumbers?: boolean; placeholder?: string; wrap?: boolean; variant?: EditorVariant }): Extension[] {
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
    autocompletion({ activateOnTyping: false }),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(classHighlighter),
    lang ?? [],
    opts.wrap ? EditorView.lineWrapping : [],
    opts.placeholder ? placeholder(opts.placeholder) : [],
    EditorState.tabSize.of(2),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
  ];
}
