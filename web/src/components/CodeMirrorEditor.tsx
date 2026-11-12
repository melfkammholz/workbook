import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, type DecorationSet } from '@codemirror/view';
import type { Diagnostic, TypeInfo } from '@wb/shared';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '@/lib/api';
import { baseExtensions, type EditorVariant } from '@/lib/editor';
import { isKnown, languageFor, loadLanguage } from '@/lib/highlighter';
import { typstCompletions } from '@/lib/typst';
import { useT } from '@/lib/i18n';

export interface EditorProps {
  value: string;
  onChange?: (text: string) => void;
  language?: string | null;
  diagnostics?: Diagnostic[];
  readOnly?: boolean;
  lineNumbers?: boolean;
  wrap?: boolean;
  placeholder?: string;
  /** Asked what type the code under the pointer has. */
  typeOf?: (span: { line: number; column: number; endLine: number; endColumn: number; name: string }) => Promise<TypeInfo | null>;
  /** Ctrl/Cmd+Enter */
  onSubmit?: () => void;
  label: string;
  variant?: EditorVariant;
  /** The CodeMirror view, for changes that must keep the cursor where it is. Null when it goes. */
  onView?: (view: EditorView | null) => void;
  /** Tab goes to the next field instead of indenting, as in a form. */
  tabMovesFocus?: boolean;
  /** More behaviour, e.g. decorations. Read once, when the editor is made. */
  extensions?: Extension;
  /** A line to highlight, because something elsewhere that stands for it is pointed at. Not scrolled to. */
  hoverLine?: number | null;
}

const setHoverLine = StateEffect.define<number | null>();
const hoverLineMark = Decoration.line({ class: 'cm-hoverLine' });
/** The highlighted line; it goes away when its line is edited away. */
const hoverLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setHoverLine)) continue;
      const n = e.value;
      deco = n !== null && n >= 1 && n <= tr.state.doc.lines ? Decoration.set([hoverLineMark.range(tr.state.doc.line(n).from)]) : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The name or operator at a column, if there is one. */
function tokenAt(text: string, column: number): { from: number; to: number } | null {
  for (const m of text.matchAll(/[\p{L}_][\p{L}\p{N}_']*(?:\.[\p{L}_][\p{L}\p{N}_']*)*|[!#$%&*+./<=>?@\\^|~:-]+/gu)) {
    const from = m.index;
    if (column >= from && column <= from + m[0].length) return { from, to: from + m[0].length };
  }
  return null;
}

/** Vim keys, loaded the first time an editor wants them (most students never do). */
let vimKeymap: typeof import('@replit/codemirror-vim').vim | null = null;

/**
 * Thin wrapper around a CodeMirror view. `value` is the source of truth: when it differs from the document the document is replaced.
 * Loaded through `CodeEditor`, so CodeMirror stays out of the first bundle.
 */
export function CodeMirrorEditor({ value, onChange, language, diagnostics, readOnly, lineNumbers, wrap, placeholder, onSubmit, label, variant, typeOf, onView, tabMovesFocus, extensions, hoverLine }: EditorProps) {
  const t = useT();
  const wantsVim = useSettings().data?.editorKeys === 'vim' && !readOnly;
  const [, loaded] = useState(0);
  useEffect(() => {
    if (wantsVim && !vimKeymap)
      void import('@replit/codemirror-vim').then((m) => {
        vimKeymap = m.vim;
        loaded((n) => n + 1);
      });
  }, [wantsVim]);
  const vimKeys = wantsVim && !!vimKeymap;
  // A language other than the course's own is loaded first; the editor is made again once it is there.
  const languageReady = !language || !!languageFor(language) || !isKnown(language);
  useEffect(() => {
    if (!languageReady && language) void loadLanguage(language).then(() => loaded((n) => n + 1));
  }, [language, languageReady]);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  const typeOfRef = useRef(typeOf);
  typeOfRef.current = typeOf;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const labelsRef = useRef(t.completion);
  labelsRef.current = t.completion;
  const hoogleRef = useRef('');
  hoogleRef.current = t.lookUpInHoogle;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          // First, so that it sees every key before the normal bindings do.
          vimKeys && vimKeymap ? vimKeymap({ status: true }) : [],
          baseExtensions({
            language,
            lineNumbers,
            wrap,
            ...(variant ? { variant } : {}),
            ...(placeholder ? { placeholder } : {}),
            ...(language === 'typst' ? { completions: typstCompletions(() => labelsRef.current) } : {}),
            ...(tabMovesFocus ? { tabMovesFocus } : {}),
          }),
          extensions ?? [],
          hoverLineField,
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  onSubmitRef.current?.();
                  return !!onSubmitRef.current;
                },
              },
            ]),
          ),
          hoverTooltip(async (view, pos) => {
            const line = view.state.doc.lineAt(pos);
            const token = tokenAt(line.text, pos - line.from);
            if (!token || !typeOfRef.current) return null;
            const name = line.text.slice(token.from, token.to);
            const info = await typeOfRef.current({ line: line.number, column: token.from + 1, endLine: line.number, endColumn: token.to + 1, name });
            if (!info) return null;
            return {
              pos: line.from + token.from,
              end: line.from + token.to,
              above: true,
              create: () => {
                const dom = document.createElement('div');
                dom.className = 'cm-type-tip';
                const type = dom.appendChild(document.createElement('div'));
                type.textContent = `${name} :: ${info.type}`;
                if (info.doc) {
                  const doc = dom.appendChild(document.createElement('div'));
                  doc.className = 'cm-type-doc';
                  doc.textContent = info.doc;
                }
                if (info.library) {
                  const link = dom.appendChild(document.createElement('a'));
                  link.className = 'cm-type-link';
                  link.href = `https://hoogle.haskell.org/?hoogle=${encodeURIComponent(name)}`;
                  link.target = '_blank';
                  link.rel = 'noreferrer';
                  link.textContent = hoogleRef.current;
                }
                return { dom };
              },
            };
          }),
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          EditorState.readOnly.of(!!readOnly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    onViewRef.current?.(v);
    return () => {
      v.destroy();
      view.current = null;
      onViewRef.current?.(null);
    };
    // The view is created once per mount; props that change later are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, languageReady, readOnly, lineNumbers, wrap, variant, vimKeys, tabMovesFocus]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value, language, readOnly, lineNumbers, wrap]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const out: CmDiagnostic[] = (diagnostics ?? []).map((d) => {
      const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines));
      const from = Math.min(line.from + Math.max(d.column - 1, 0), line.to);
      const endLine = doc.line(Math.min(Math.max(d.endLine, 1), doc.lines));
      let to = Math.min(endLine.from + Math.max(d.endColumn - 1, 0), endLine.to);
      if (to <= from) to = Math.min(from + 1, doc.length);
      return { from, to, severity: d.severity, message: d.message, ...(d.code ? { source: d.code } : {}) };
    });
    v.dispatch(setDiagnostics(v.state, out));
    // Positions refer to the code that was loaded; CodeMirror maps them through later edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnostics, language, languageReady, readOnly, lineNumbers, wrap, variant, vimKeys, tabMovesFocus]);

  useEffect(() => {
    view.current?.dispatch({ effects: setHoverLine.of(hoverLine ?? null) });
  }, [hoverLine, language, languageReady, readOnly, lineNumbers, wrap, variant, vimKeys, tabMovesFocus]);

  // `isolate`: CodeMirror's own panels and tooltips use high z-indexes, which must not reach dialogs above the editor.
  return <div ref={host} className="isolate h-full min-h-0 overflow-hidden" />;
}
