import { CircleStop, Eraser, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { useRepl } from '@/lib/useRepl';
import { IconButton, Spinner, clsx } from './ui';

type Repl = ReturnType<typeof useRepl>;

/**
 * A small terminal: output on top, one input line below with history.
 * The prompt is drawn by us (ghci runs without one), so typing never waits
 * on a round trip to look responsive.
 */
export function ReplView({ repl, prompt, language }: { repl: Repl; prompt: string; language: string }) {
  const t = useT();
  const prolog = language === 'prolog';
  const [text, setText] = useState('');
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Not for an empty log: reading its height lays the page out, once more before an opened exercise is painted.
  useEffect(() => {
    const el = scroller.current;
    if (el && repl.log.length) el.scrollTop = el.scrollHeight;
  }, [repl.log]);

  const submit = () => {
    const line = text.trim();
    if (!line) return;
    if (history.current[history.current.length - 1] !== line) history.current.push(line);
    cursor.current = -1;
    repl.input(line);
    setText('');
  };

  const dead = repl.connection === 'closed';
  const warming = repl.connection === 'connecting' || repl.connection === 'warming';

  return (
    <div className="flex h-full min-h-0 flex-col bg-sheet">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <span className={clsx('size-2 rounded-full', dead ? 'bg-danger' : warming ? 'bg-review' : repl.busy ? 'bg-accent' : 'bg-done')} aria-hidden />
          {dead ? t.interpreterStopped : warming ? t.interpreterStarting : repl.busy ? t.running : t.ready}
          {repl.busy ? <Spinner /> : null}
        </div>
        <div className="flex items-center">
          <IconButton label={t.interrupt} onClick={repl.interrupt} disabled={!repl.busy}>
            <CircleStop size={16} />
          </IconButton>
          <IconButton label={t.clearOutput} onClick={repl.clear}>
            <Eraser size={16} />
          </IconButton>
          <IconButton label={t.restartInterpreter} onClick={repl.restart}>
            <RotateCcw size={16} />
          </IconButton>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[13px] leading-relaxed" onClick={() => !window.getSelection()?.toString() && inputRef.current?.focus()}>
        {repl.log.length === 0 && !dead ? (
          <p className="font-sans text-ink-3">{prolog ? t.tryQuery : t.tryExpression}</p>
        ) : null}
        {repl.log.map((l, i) =>
          l.kind === 'in' ? (
            <div key={i} className="whitespace-pre-wrap break-words">
              <span className="select-none text-accent">{prompt} </span>
              {l.text}
            </div>
          ) : (
            <div key={i} className="whitespace-pre-wrap break-words text-ink-2">
              {l.text.replace(/\n$/, '')}
            </div>
          ),
        )}
        {dead && repl.exitReason ? <p className="mt-2 font-sans text-danger">{t.replExit[repl.exitReason] ?? repl.exitReason}</p> : null}
      </div>

      <form
        className="flex items-center gap-2 border-t border-line px-4 py-2 font-mono text-[13px] focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="select-none text-accent" aria-hidden>
          {prompt}
        </span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={dead}
          aria-label={t.interpreterInput}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          placeholder={dead ? t.restartToContinue : prolog ? t.askQuery : t.evaluate}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:font-sans placeholder:text-ink-3"
          onKeyDown={(e) => {
            const h = history.current;
            if (e.key === 'ArrowUp' && h.length) {
              e.preventDefault();
              cursor.current = cursor.current < 0 ? h.length - 1 : Math.max(0, cursor.current - 1);
              setText(h[cursor.current]!);
            } else if (e.key === 'ArrowDown' && cursor.current >= 0) {
              e.preventDefault();
              cursor.current++;
              if (cursor.current >= h.length) {
                cursor.current = -1;
                setText('');
              } else setText(h[cursor.current]!);
            } else if (e.key === 'c' && e.ctrlKey) {
              repl.interrupt();
            }
          }}
        />
      </form>
    </div>
  );
}
