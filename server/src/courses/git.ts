import { execFile } from 'node:child_process';

export class GitError extends Error {
  constructor(
    message: string,
    /** The program itself is missing, as opposed to a command that failed. */
    readonly missing = false,
  ) {
    super(message);
  }
}

const CLONE_MS = 5 * 60_000;
const QUICK_MS = 20_000;

function git(args: string[], cwd: string | undefined, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        ...(cwd ? { cwd } : {}),
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        // Only public repositories for now: a login request must fail at once, not wait for an answer nobody can give.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'http:https' },
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        reject(new GitError(stderr.trim() || err.message, (err as NodeJS.ErrnoException).code === 'ENOENT'));
      },
    );
  });
}

/** Only the latest state: a course needs no history, and this keeps the download small. */
export async function clone(url: string, dir: string): Promise<void> {
  await git(['clone', '--depth', '1', '--single-branch', '--no-tags', '--', url, dir], undefined, CLONE_MS);
}

export async function localHead(dir: string): Promise<string> {
  return (await git(['rev-parse', 'HEAD'], dir, QUICK_MS)).trim();
}

/** Asks the server without downloading anything. */
export async function remoteHead(dir: string): Promise<string | null> {
  return (await git(['ls-remote', 'origin', 'HEAD'], dir, QUICK_MS)).split(/\s/)[0] || null;
}

/** The app owns this copy, so whatever is there is replaced by the latest state. */
export async function pull(dir: string): Promise<void> {
  await git(['fetch', '--depth', '1', '--no-tags', 'origin', 'HEAD'], dir, CLONE_MS);
  await git(['reset', '--hard', 'FETCH_HEAD'], dir, QUICK_MS);
  await git(['clean', '-fd'], dir, QUICK_MS);
}
