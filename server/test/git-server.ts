import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

/** A real git server on localhost, as courses are only ever fetched over http(s). */
export async function startGitServer(): Promise<{ root: string; url: (name: string) => string; close: () => Promise<void> }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-git-'));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const cgi = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method!,
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
      },
    });
    req.pipe(cgi.stdin);
    let head = Buffer.alloc(0);
    let inBody = false;
    cgi.stdout.on('data', (chunk: Buffer) => {
      if (inBody) return void res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const [name, ...value] = line.split(': ');
        if (name!.toLowerCase() === 'status') res.statusCode = Number.parseInt(value[0]!, 10);
        else res.setHeader(name!, value.join(': '));
      }
      inBody = true;
      res.write(head.subarray(end + 4));
    });
    cgi.stdout.on('end', () => res.end());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    root,
    url: (name) => `http://127.0.0.1:${port}/${name}.git`,
    close: () => new Promise((r) => {
      server.closeAllConnections();
      server.close(() => r());
    }),
  };
}

/** Publishes a folder as `<name>.git`. Returns a working copy to change it with. */
export function publish(root: string, name: string, from: string): string {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-work-'));
  fs.cpSync(from, work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'first');
  const bare = path.join(root, `${name}.git`);
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', 'origin', 'main');
  return work;
}
