import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ReplClientMessage, ReplServerMessage, TypeInfo } from '@wb/shared';
import type { ServerExercise } from '../content/loader.js';
import { GhciSession } from '../runners/ghci.js';
import { PrologSession } from '../runners/prolog.js';
import type { Deps } from './deps.js';

/**
 * `/ws/repl/:id` — one warm interpreter per open exercise.
 *
 * The client sends `load` whenever the code changes (debounced) and `input`
 * for everything typed into the REPL; the server answers with the load
 * result (diagnostics) and streams the interpreter's output.
 */
export function replSocket(app: FastifyInstance, d: Deps): void {
  app.get<{ Params: { id: string } }>('/ws/repl/:id', { websocket: true }, (socket: WebSocket, req) => {
    const send = (m: ReplServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    const ex = d.content.current.exercise(req.params.id);
    const language = ex?.code ? (ex.code.runnable ? ex.code.language : null) : (ex?.meta.scratch ?? null);
    if (!ex || !language) {
      send({ type: 'exit', reason: 'this exercise has no interpreter' });
      return socket.close();
    }

    let current: { session: GhciSession | PrologSession; release: () => void } | null = null;
    let closed = false;

    const open = () => {
      const dir = path.join(d.config.dataDir, 'sessions', crypto.randomBytes(8).toString('hex'));
      const session =
        language === 'prolog'
          ? new PrologSession({
              bin: d.config.swiplBin,
              dir,
              libDir: d.prologLib,
              ...(ex.code ? { targets: Object.keys(ex.code.files), support: ex.code.support } : {}),
            }).start()
          : new GhciSession({
              bin: d.config.ghciBin,
              dir,
              libDir: d.haskellLib,
              options: ex.code?.options ?? [],
              ...(ex.code ? { targets: Object.keys(ex.code.files), support: ex.code.support } : {}),
            }).start();
      const entry = d.pool.add(session, dir, (reason) => send({ type: 'exit', reason }));
      session.on('output', (text) => send({ type: 'output', text }));
      session.on('busy', (busy) => send({ type: 'busy', busy }));
      session.on('exit', (reason) => {
        if (current?.session === session) send({ type: 'exit', reason });
      });
      current = { session, release: () => d.pool.release(entry) };
      session.ready.then(
        () => send({ type: 'ready' }),
        (e: Error) => send({ type: 'exit', reason: e.message }),
      );
    };

    // Only one load runs at a time; if more arrive meanwhile, only the newest matters.
    let loading = false;
    let pending: Record<string, string> | null = null;
    // A query must see the newest code, so it waits for every load in front of it.
    let waitingInput: string[] = [];
    const load = async (files: Record<string, string>) => {
      pending = files;
      if (loading) return;
      loading = true;
      try {
        while (pending && current) {
          const next: Record<string, string> = pending;
          pending = null;
          const r = await current.session.load(next);
          send({ type: 'loaded', ...r });
        }
      } catch (e) {
        send({ type: 'exit', reason: (e as Error).message });
      } finally {
        loading = false;
        for (const text of waitingInput.splice(0)) current?.session.input(text);
      }
    };

    open();

    socket.on('message', (raw) => {
      let m: ReplClientMessage;
      try {
        m = JSON.parse(raw.toString()) as ReplClientMessage;
      } catch {
        return;
      }
      switch (m.type) {
        case 'load':
          void load(filterFiles(ex, m.files));
          break;
        case 'input':
          if (typeof m.text !== 'string' || m.text.length >= 100_000) break;
          // While the student's own program runs, this is its stdin. Loads wait for that
          // program, so holding back what it may be waiting for would block both forever.
          if (loading && !current?.session.busy) waitingInput.push(m.text);
          else current?.session.input(m.text);
          break;
        case 'typeAt': {
          const answer = (result: TypeInfo | null) => send({ type: 'typeAt', requestId: m.requestId, result });
          const session = current?.session;
          const span = [m.line, m.column, m.endLine, m.endColumn];
          // Only numbers, a file the exercise declares and a checked name reach the interpreter. A running
          // program or a reload comes first, and a hover is not worth waiting for.
          if (!(session instanceof GhciSession) || loading || session.busy || !ex.code || !(m.file in ex.code.files) || !span.every((n) => Number.isInteger(n) && n > 0 && n < 1_000_000)) {
            answer(null);
            break;
          }
          session.typeAt(m.file, m.line, m.column, m.endLine, m.endColumn, typeof m.name === 'string' ? m.name : '').then(answer, () => answer(null));
          break;
        }
        case 'interrupt':
          current?.session.interrupt();
          break;
        case 'restart':
          current?.release();
          current = null;
          pending = null;
          waitingInput = [];
          open();
          break;
      }
    });

    socket.on('close', () => {
      closed = true;
      current?.release();
      current = null;
    });
    void closed;
  });
}

/** Only the files the exercise declares may be written into the session. */
function filterFiles(ex: ServerExercise, files: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!ex.code || typeof files !== 'object' || files === null) return out;
  for (const path of Object.keys(ex.code.files)) {
    const content = (files as Record<string, unknown>)[path];
    if (typeof content === 'string' && content.length < 500_000) out[path] = content;
  }
  return out;
}
