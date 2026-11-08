// Browser test of an SLD tree exercise: live syntax errors, the picture, the wide layout, tests with marks.
//
//   CONTENT_DIR=$PWD/server/test/fixtures/course DATA_DIR=$(mktemp -d) WEB_DIR=$PWD/web/dist SLDCHECK_BIN=sldcheck npm start &
//   node scripts/e2e-sld.mjs              # BASE_URL defaults to http://localhost:8080; CHROMIUM points at a browser
//
// It needs sldcheck 0.3 or newer, and a throwaway data directory.
import fs from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:8080';
const code = 'server/test/fixtures/course/chapters/03-prolog-grundlagen/code/member.sld';
const solution = fs.readFileSync(code, 'utf8').replace('#ifndef TEMPLATE\n', '').replace('#endif\n', '');

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
const replace = async (text) => {
  await page.click('.cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
};

try {
  await page.goto(`${base}/#/item/sld-member`);
  await page.waitForSelector('text=Willkommen in deinem Workbook');
  await page.click('[role=dialog] button:has-text("English")');
  await page.click('[role=dialog] button:has-text("Get started")');
  await page.click('[role=dialog] [role=radio]:has-text("Thorough")');
  await page.waitForSelector('text=No syntax errors.', { timeout: 20_000 });

  // A syntax error shows while writing.
  await replace(solution.replace('{Y |-> 2}', '{Y |-> 2'));
  await page.waitForSelector('text=/never closed/');
  await replace(solution);
  await page.waitForSelector('text=No syntax errors.');

  // The picture: one element per node and per edge label, and the tests keep their result across layouts.
  await page.click('role=tab[name=/Tests/]');
  await page.click('text=Run tests');
  await page.waitForSelector('text=The tree is correct', { timeout: 20_000 });
  await page.click('role=tab[name=/Preview/]');
  await page.waitForSelector('svg[role=img] g[data-line]');
  const parts = await page.locator('svg[role=img] g[data-line]').count();
  if (parts < 10) throw new Error(`the picture has only ${parts} parts`);

  await page.click('button[aria-label^="Wide layout"]');
  await page.waitForSelector('button[aria-label="Show the task"]');
  if (!(await page.locator('.cm-content').innerText()).includes('member(X4, [_4|T4])')) throw new Error('the text was lost');

  // A click on a node goes to its line.
  const node = await page.locator('svg[role=img] g[data-line="11"]').first().boundingBox();
  await page.mouse.click(node.x + node.width / 2, node.y + node.height / 2);
  if (!(await page.locator('.cm-activeLine').innerText()).includes('member(X, [2])')) throw new Error('the click did not go to the line');

  // The tests mark a wrong step in the picture.
  await replace(solution.replace('{X2 |-> X, _2 |-> 1, T2 |-> [2]}', '{X2 |-> X, _2 |-> 2, T2 |-> [2]}'));
  await page.click('role=tab[name=/Tests/]');
  await page.click('text=Run again');
  await page.waitForSelector('text=/1 problem in the tree/', { timeout: 20_000 });
  if ((await page.locator('svg[role=img] .stroke-danger').count()) === 0) throw new Error('nothing is marked in the picture');

  // The task opens over the editor and closes with Escape.
  await page.click('button[aria-label="Show the task"]');
  await page.waitForSelector('[role=dialog][aria-label=Task]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog][aria-label=Task]', { state: 'detached' });
  console.log('ok: syntax errors, the picture, the wide layout, a click, marks from the tests, the task over the editor');
} catch (e) {
  problems.push(String(e));
}
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
