// Screenshots of a running workbook (start one with scripts/test-server.sh), and the errors the pages logged.
//
//   node scripts/shot.mjs [options] <route>...
//
//   route              an app route ('item/foo', '/item/foo', '#/item/foo') or a full URL
//   --base URL         default http://localhost:8091 (8080, the real workbook, is refused)
//   --out DIR          default $TMPDIR/workbook-shots
//   --width 1440,400   one screenshot per width (default 1440)
//   --height 900       viewport height (default 900); a tall one shows a whole lesson
//   --theme light,dark one screenshot per theme (light, dusk, dark, system); default: leave as is
//   --set key=value    any other setting for the run, e.g. --set warmPaper=false --set showAchievements=true
//   --scroll TEXT      scroll the first element containing TEXT into view
//   --click SELECTOR   click before the screenshot (repeatable, in order; Playwright selectors, e.g. 'text=Run tests')
//   --wait MS          extra wait after loading and after each click (default 600)
//   --el SELECTOR      screenshot only this element
//   --act FILE         a module whose default export `async (page) => {}` runs before the screenshot
//
// Settings are restored afterwards. Prints one line per file, then the page errors, console errors and failed API
// requests (or "no errors"). Exits 1 if there were errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const opts = { base: 'http://localhost:8091', out: path.join(os.tmpdir(), 'workbook-shots'), width: '1440', height: '900', wait: '600' };
const routes = [], clicks = [], sets = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { routes.push(a); continue; }
  const k = a.slice(2), v = argv[++i];
  if (v === undefined) throw new Error(`${a} needs a value`);
  if (k === 'click') clicks.push(v);
  else if (k === 'set') {
    const [key, ...rest] = v.split('=');
    const raw = rest.join('=');
    try { sets[key] = JSON.parse(raw); } catch { sets[key] = raw; }
  } else opts[k] = v;
}
if (!routes.length) { console.error('usage: node scripts/shot.mjs [options] <route>... (see the top of the file)'); process.exit(2); }
const base = opts.base.replace(/\/$/, '');
if (new URL(base).port === '8080') { console.error('refusing :8080, that is the real workbook'); process.exit(2); }
fs.mkdirSync(opts.out, { recursive: true });

const api = (p, init) => fetch(base + p, { ...init, headers: { 'content-type': 'application/json' } });
const original = await (await api('/api/settings')).json();
const putSettings = async (s) => {
  const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...original, ...s }) });
  if (!r.ok) throw new Error(`settings: ${r.status} ${await r.text()}`);
};
const act = opts.act ? (await import(pathToFileURL(path.resolve(opts.act)).href)).default : null;
const widths = opts.width.split(',').map(Number);
const themes = opts.theme ? opts.theme.split(',') : [null];
const wait = Number(opts.wait);
const slug = (r) => r.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
const url = (r) => (/^https?:/.test(r) ? r : `${base}/#/${r.replace(/^#?\/?/, '')}`);

const browser = await chromium.launch();
const problems = [];
try {
  for (const theme of themes) {
    await putSettings({ ...sets, ...(theme ? { theme } : {}) });
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: Number(opts.height) } });
      const tag = (r) => `${slug(r)} ${theme ?? ''}@${width}`;
      for (const r of routes) {
        page.removeAllListeners();
        page.on('pageerror', (e) => problems.push(`${tag(r)} page error: ${e.message}`));
        page.on('console', (m) => m.type() === 'error' && problems.push(`${tag(r)} console: ${m.text()}`));
        page.on('response', (res) => res.url().includes('/api/') && res.status() >= 400 && problems.push(`${tag(r)} ${res.status()} ${res.url()}`));
        await page.goto(url(r), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(wait);
        for (const c of clicks) { await page.click(c); await page.waitForTimeout(wait); }
        if (opts.scroll) {
          await page.getByText(opts.scroll).first().scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
        }
        if (act) await act(page);
        const file = path.join(opts.out, [slug(r), theme, widths.length > 1 || width !== 1440 ? width : null].filter(Boolean).join('-') + '.png');
        await (opts.el ? page.locator(opts.el).first() : page).screenshot({ path: file });
        console.log(file);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(original) });
}
console.log(problems.length ? problems.join('\n') : 'no errors');
process.exit(problems.length ? 1 : 0);
