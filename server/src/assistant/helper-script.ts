/**
 * The helper the student runs on their own computer (`GET /helper/workbook-helper.mjs`). The app cannot start programs
 * on the host, so this script asks the app for queued requests (outbound only, it listens to nothing) and starts
 * Claude Code for each one. The instruction text is fixed here; the app only supplies an id and the name of a skill,
 * both checked below, and the student's words are read by the assistant through the MCP.
 */
export const helperScript = (origin: string): string => `#!/usr/bin/env node
// Workbook helper: runs the requests you start in the app ("Send to the assistant") with Claude Code on this computer.
// Needs Node 20+, the \`claude\` command, and the workbook MCP server and skills installed (see the app's settings).
//   WORKBOOK_HELPER_KEY=... node workbook-helper.mjs
import { spawn } from 'node:child_process';

const APP = process.env.WORKBOOK_URL || ${JSON.stringify(origin)};
const KEY = process.env.WORKBOOK_HELPER_KEY || '';
const CLAUDE = process.env.WORKBOOK_CLAUDE || 'claude';
const TIMEOUT_MS = 10 * 60 * 1000;
if (!KEY) {
  console.error('Set WORKBOOK_HELPER_KEY (create it in the app: settings, assistant).');
  process.exit(1);
}

const headers = { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (path, init = {}, ms = 40000) => {
  const res = await fetch(APP + path, { ...init, headers, signal: AbortSignal.timeout(ms) });
  if (res.status === 401) throw new Error('The app does not accept this key (was it regenerated?).');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
};

let current = null;

async function run(req) {
  if (!/^[0-9a-f-]{36}$/.test(req.id) || !/^workbook-[a-z-]+$/.test(req.skill)) throw new Error('refusing a request that looks wrong');
  const purpose = req.skill + ' #' + req.id;
  const instruction =
    'Use the skill ' + req.skill + ' for workbook request ' + req.id + '. First call the workbook tool get_request with request "' + req.id + '" and purpose "' + purpose + '". ' +
    'Use exactly this purpose "' + purpose + '" for every other read of questions. Only propose, change nothing.';
  console.log(new Date().toLocaleTimeString() + '  ' + req.skill + ' (' + req.id.slice(0, 8) + ')');
  const child = spawn(CLAUDE, ['-p', instruction, '--allowedTools', 'mcp__workbook__*', 'Skill'], { stdio: ['ignore', 'pipe', 'pipe'] });
  current = child;
  const lines = [];
  const take = (b) => {
    for (const l of String(b).split('\\n')) if (l.trim()) lines.push(l);
    if (lines.length > 40) lines.splice(0, lines.length - 40);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const timer = setTimeout(() => {
    take('Stopped after 10 minutes.');
    child.kill('SIGTERM');
  }, TIMEOUT_MS);
  const code = await new Promise((resolve) => {
    child.on('error', (e) => {
      take('Could not start "' + CLAUDE + '": ' + e.message);
      resolve(127);
    });
    child.on('close', (c) => resolve(c ?? 1));
  });
  clearTimeout(timer);
  current = null;
  await call('/api/helper/report/' + req.id, { method: 'POST', body: JSON.stringify({ exitCode: code, logTail: lines.join('\\n') }) });
  console.log('  ' + (code === 0 ? 'done' : 'failed (' + code + ')'));
}

// While a run is going the app can ask for it to be stopped; this poll is also the heartbeat.
setInterval(async () => {
  if (!current) return;
  try {
    const r = await call('/api/helper/poll?busy=1&wait=0', {}, 8000);
    if (r.cancel?.length) current.kill('SIGTERM');
  } catch {}
}, 5000).unref();

console.log('Workbook helper connected to ' + APP + ' (Ctrl+C to stop).');
for (;;) {
  try {
    if (current) {
      await sleep(1000);
      continue;
    }
    const r = await call('/api/helper/poll?wait=25');
    if (r.request) await run(r.request);
  } catch (e) {
    console.error(String(e.message || e));
    await sleep(5000);
  }
}
`;
