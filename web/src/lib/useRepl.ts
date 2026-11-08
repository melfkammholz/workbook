import type { Diagnostic, ReplClientMessage, ReplServerMessage, SldTree, TypeInfo } from '@wb/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface TypeSpan {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  name: string;
}

export interface LogLine {
  kind: 'in' | 'out' | 'note';
  text: string;
}

export interface ReplState {
  connection: 'connecting' | 'warming' | 'ready' | 'closed';
  busy: boolean;
  /** Result of the latest load; null until the first one finishes. */
  loaded: { ok: boolean; diagnostics: Diagnostic[]; durationMs: number } | null;
  /** True between sending code and getting its result. */
  loading: boolean;
  log: LogLine[];
  exitReason: string | null;
  /** SLD trees: the last tree that could be read. Null: none yet. Undefined: sldcheck cannot print trees. */
  sldTree: SldTree | null | undefined;
  /** The text now cannot be read, so `sldTree` is from before. */
  sldStale: boolean;
}

const MAX_LOG_CHARS = 200_000;

/**
 * One warm interpreter per open exercise. `load(files)` is cheap to call on
 * every change: the server coalesces, and only the newest version is compiled.
 */
export function useRepl(exerciseId: string, enabled: boolean) {
  const [state, setState] = useState<ReplState>({ connection: 'connecting', busy: false, loaded: null, loading: false, log: [], exitReason: null, sldTree: undefined, sldStale: false });
  const ws = useRef<WebSocket | null>(null);
  const latest = useRef<Record<string, string> | null>(null);
  const outstanding = useRef(0);
  /** The interpreter can take code. A ref, as sending must not wait for a render. */
  const ready = useRef(false);
  const typeRequests = useRef(new Map<number, (type: TypeInfo | null) => void>());
  const nextRequest = useRef(0);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setState({ connection: 'connecting', busy: false, loaded: null, loading: false, log: [], exitReason: null, sldTree: undefined, sldStale: false });
    outstanding.current = 0;
    ready.current = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws/repl/${encodeURIComponent(exerciseId)}`);
    ws.current = sock;
    let alive = true;

    sock.onopen = () => alive && setState((s) => ({ ...s, connection: 'warming' }));
    sock.onmessage = (ev) => {
      if (!alive) return;
      const m = JSON.parse(String(ev.data)) as ReplServerMessage;
      if (m.type === 'typeAt') {
        typeRequests.current.get(m.requestId)?.(m.result);
        typeRequests.current.delete(m.requestId);
        return;
      }
      if (m.type === 'ready') ready.current = true;
      if (m.type === 'exit') ready.current = false;
      if (m.type === 'loaded') outstanding.current = Math.max(0, outstanding.current - 1);
      setState((s) => {
        switch (m.type) {
          case 'ready':
            return { ...s, connection: 'ready' };
          case 'output':
            return { ...s, log: appendOut(s.log, m.text) };
          case 'busy':
            return { ...s, busy: m.busy };
          case 'loaded': {
            // A text that cannot be read has no tree: the one from before stays, marked, until it can be read again.
            const unreadable = m.sldTree === null && !m.ok;
            const sldTree = m.sldTree === undefined || unreadable ? s.sldTree : m.sldTree;
            return { ...s, loaded: { ok: m.ok, diagnostics: m.diagnostics, durationMs: m.durationMs }, sldTree, sldStale: unreadable, loading: outstanding.current > 0 };
          }
          case 'exit':
            return { ...s, connection: 'closed', busy: false, loading: false, exitReason: m.reason };
        }
      });
      // Once the interpreter is up, send whatever the student has typed so far.
      if (m.type === 'ready' && latest.current) {
        outstanding.current++;
        sock.send(JSON.stringify({ type: 'load', files: latest.current } satisfies ReplClientMessage));
        setState((s) => ({ ...s, loading: true }));
      }
    };
    sock.onclose = () => {
      ready.current = false;
      if (alive) setState((s) => (s.connection === 'closed' ? s : { ...s, connection: 'closed', busy: false, loading: false, exitReason: s.exitReason ?? 'Connection to the interpreter was lost.' }));
    };

    return () => {
      alive = false;
      sock.close();
      if (ws.current === sock) ws.current = null;
    };
  }, [exerciseId, enabled, generation]);

  const send = useCallback((m: ReplClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);

  const load = useCallback(
    (files: Record<string, string>) => {
      latest.current = files;
      // Before `ready` the server is still starting; the files are sent when it is.
      if (!ready.current || ws.current?.readyState !== WebSocket.OPEN) return;
      // Right here and not in a state update, which runs later: a query sent next must find this code in place.
      outstanding.current++;
      send({ type: 'load', files });
      setState((s) => ({ ...s, loading: true }));
    },
    [send],
  );

  const input = useCallback(
    (text: string) => {
      setState((s) => ({ ...s, log: [...s.log, { kind: 'in', text }] }));
      send({ type: 'input', text });
    },
    [send],
  );

  /** The type of a stretch of code. Null if there is none, or no answer comes quickly enough to still matter. */
  const typeAt = useCallback(
    (span: TypeSpan) =>
      new Promise<TypeInfo | null>((resolve) => {
        if (!ready.current) return resolve(null);
        const requestId = ++nextRequest.current;
        typeRequests.current.set(requestId, resolve);
        send({ type: 'typeAt', requestId, ...span });
        setTimeout(() => {
          if (typeRequests.current.delete(requestId)) resolve(null);
        }, 3000);
      }),
    [send],
  );

  const interrupt = useCallback(() => send({ type: 'interrupt' }), [send]);
  const clear = useCallback(() => setState((s) => ({ ...s, log: [] })), []);
  const restart = useCallback(() => {
    // A fresh socket gives a fresh interpreter, and reloads the latest code once ready.
    setGeneration((g) => g + 1);
  }, []);

  return { ...state, load, input, interrupt, clear, restart, typeAt };
}

function appendOut(log: LogLine[], text: string): LogLine[] {
  const last = log[log.length - 1];
  let next: LogLine[];
  if (last && last.kind === 'out') next = [...log.slice(0, -1), { kind: 'out', text: last.text + text }];
  else next = [...log, { kind: 'out', text }];
  // Keep memory bounded: drop the oldest lines.
  let total = next.reduce((n, l) => n + l.text.length, 0);
  while (total > MAX_LOG_CHARS && next.length > 1) total -= next.shift()!.text.length;
  return next;
}
