// Browser smoke test: first-run setup, edit code, evaluate in the interpreter, run tests, mark done, see it in review.
//
//   CONTENT_DIR=$PWD/server/test/fixtures/course DATA_DIR=$(mktemp -d) WEB_DIR=$PWD/web/dist npm start &
//   npx --yes playwright@1 install chromium   # once
//   node scripts/e2e-smoke.mjs                # BASE_URL defaults to http://localhost:8080
//
// It writes progress for the example exercise "binary-exponentiation", so point it at a throwaway data directory.
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:8080';
const solution = `module BinaryExponentiation (power) where

power :: Num a => a -> Integer -> a
power _ 0 = 1
power x n
  | even n = let h = power x (n \`div\` 2) in h * h
  | otherwise = x * power x (n - 1)
`;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

try {
  await page.goto(`${base}/#/item/binary-exponentiation`);
  await page.waitForSelector('text=Willkommen in deinem Workbook');
  await page.click('[role=dialog] button:has-text("English")');
  await page.click('[role=dialog] button:has-text("Get started")');
  // A new course asks how much of it to show.
  await page.click('[role=dialog] [role=radio]:has-text("Thorough")');
  await page.waitForSelector('.cm-content');
  await page.waitForSelector('text=Ready', { timeout: 20_000 });

  await page.click('.cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(solution);
  await page.waitForSelector('text=/Loaded in \\d+ ms/');

  await page.fill('input[aria-label="Interpreter input"]', 'power 2 10');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=1024');

  await page.click('role=tab[name=/Tests/]');
  await page.click('text=Run tests');
  await page.waitForSelector('text=All tests pass', { timeout: 30_000 });

  await page.click('button:has-text("Mark as done") >> nth=0');
  await page.waitForSelector('text=How did that go?');
  await page.click('[role=dialog] fieldset button:has-text("Confident")');
  await page.fill('[role=dialog] textarea', 'Why is this logarithmic?');
  await page.click('[role=dialog] button:has-text("Save")');
  await page.waitForSelector('text=Confidence: Confident');

  await page.goto(`${base}/#/review`);
  await page.click('main >> text=Binäre Exponentiation');
  await page.waitForSelector('text=Why is this logarithmic?');
  // The old addresses of the questions page lead to Tickets.
  await page.goto(`${base}/#/questions`);
  await page.waitForSelector('h1:has-text("Tickets")');
  await page.goto(`${base}/#/inbox`);
  await page.waitForSelector('h1:has-text("Tickets")');
  // Todos: add with Enter, put one next, move it with the keys, tick it and undo.
  await page.goto(`${base}/#/todos`);
  const add = page.locator('input[aria-label="Add a todo"]');
  await add.fill('Smoke todo one');
  await add.press('Enter');
  await add.fill('Smoke todo two');
  await add.press('Enter');
  await page.waitForSelector('li[data-todo]:has-text("Smoke todo one")');
  const two = page.locator('li[data-todo]:has-text("Smoke todo two")');
  await two.hover();
  await two.locator('button[aria-label="Put next"]').click();
  await page.waitForSelector('section:has-text("You decide the order") li:has-text("Smoke todo two")');
  await two.locator('> div').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForSelector('section:has-text("Later") li:has-text("Smoke todo two")');
  await two.locator('[role=checkbox]').first().click();
  await page.waitForSelector('[role=status]:has-text("Marked as done")');
  await page.click('[role=status] >> text=Undo');
  console.log('ok: set up, edited, evaluated, tested, marked done, rated, found it in review, reached Tickets and used Todos');
} catch (e) {
  problems.push(String(e));
} finally {
  await browser.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
