import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap } from '@codemirror/view';
import { vim } from '@replit/codemirror-vim';
import type { Diagnostic, TypeInfo } from '@wb/shared';
import { useEffect, useRef } from 'react';
import { useSettings } from '@/lib/api';
import { baseExtensions, type EditorVariant } from '@/lib/editor';
import { useT } from '@/lib/i18n';

interface Props {
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
}

/** The name or operator at a column, if there is one. */
function tokenAt(text: string, column: number): { from: number; to: number } | null {
  for (const m of text.matchAll(/[\p{L}_][\p{L}\p{N}_']*(?:\.[\p{L}_][\p{L}\p{N}_']*)*|[!#$%&*+./<=>?@\\^|~:-]+/gu)) {
    const from = m.index;
    if (column >= from && column <= from + m[0].length) return { from, to: from + m[0].length };
  }
  return null;
}

/** Thin wrapper around a CodeMirror view. `value` is the source of truth: when it differs from the document the document is replaced. */
export function CodeEditor({ value, onChange, language, diagnostics, readOnly, lineNumbers, wrap, placeholder, onSubmit, label, variant, typeOf }: Props) {
  const t = useT();
  const vimKeys = useSettings().data?.editorKeys === 'vim' && !readOnly;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  const typeOfRef = useRef(typeOf);
  typeOfRef.current = typeOf;
  const hoogleRef = useRef('');
  hoogleRef.current = t.lookUpInHoogle;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          // First, so that it sees every key before the normal bindings do.
          vimKeys ? vim({ status: true }) : [],
          baseExtensions({ language, lineNumbers, wrap, ...(variant ? { variant } : {}), ...(placeholder ? { placeholder } : {}) }),
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
    return () => {
      v.destroy();
      view.current = null;
    };
    // The view is created once per mount; props that change later are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, lineNumbers, wrap, variant, vimKeys]);

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
  }, [diagnostics, language, readOnly, lineNumbers, wrap]);

  // `isolate`: CodeMirror's own panels and tooltips use high z-indexes, which must not reach dialogs above the editor.
  return <div ref={host} className="isolate h-full min-h-0 overflow-hidden" />;
}
