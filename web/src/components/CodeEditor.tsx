import { Suspense } from 'react';
import { lazyComponent } from '@/lib/lazy';
import type { EditorProps } from './CodeMirrorEditor';

/** CodeMirror, loaded with the pages that have editors (see `routes.ts`), not with the first bundle. */
const Editor = lazyComponent(() => import('./CodeMirrorEditor').then((m) => m.CodeMirrorEditor));
export const loadEditor = Editor.preload;

/** A code or text editor. Until CodeMirror is there (rarely: it is loaded early), an empty box of the same size. */
export function CodeEditor(props: EditorProps) {
  return (
    <Suspense fallback={<div className="isolate h-full min-h-0 overflow-hidden" />}>
      <Editor {...props} />
    </Suspense>
  );
}
