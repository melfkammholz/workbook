/**
 * Author tooling.
 *
 *   node dist/cli.js lint [--render] [--solutions]
 *
 * Validates the content directory (CONTENT_DIR, default ./content):
 *   - structure: ids, references, dependency cycles, missing files
 *   - --render:    compiles every exercise and page with Typst and reports errors
 *   - --solutions: runs each exercise's tests against its reference solution
 *                  (they must all pass) and against the starter (they must run, and nothing may fail)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { hasTests, loadContent } from './content/loader.js';
import { TypstRenderer } from './content/typst.js';
import { runChecks } from './runners/checks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = [path.resolve(here, '../assets'), path.resolve(here, '../../assets')].find((p) => fs.existsSync(path.join(p, 'typst'))) ?? path.resolve(here, '../assets');

const [command, ...flags] = process.argv.slice(2);
if (command !== 'lint') {
  console.error('usage: cli lint [--render] [--solutions]');
  process.exit(2);
}

const config = loadConfig();
const content = loadContent(config.contentDir);
let errors = 0;
let warnings = 0;
const report = (sev: 'error' | 'warning', where: string, msg: string) => {
  if (sev === 'error') errors++;
  else warnings++;
  console.log(`${sev === 'error' ? '✗' : '!'} ${where}: ${msg}`);
};

for (const p of content.outline.problems) report(p.severity, p.file + (p.line ? `:${p.line}` : ''), p.message);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-lint-'));
try {
  if (flags.includes('--render')) {
    const renderer = new TypstRenderer({ bin: config.typstBin, contentDir: config.contentDir, dataDir: tmp, assetsDir: path.join(assets, 'typst'), language: content.outline.language });
    renderer.titles = (id) => content.get(id)?.meta.title;
    if (!(await renderer.available())) {
      report('error', 'typst', `"${config.typstBin}" not found (set TYPST_BIN)`);
    } else {
      const texts = [...content.all(), ...content.allDocs()];
      for (const item of texts) {
        const r = await renderer.renderItem(item);
        for (const d of r.diagnostics) report(d.severity, `${item.typstRel}${d.line ? ':' + d.line : ''}`, d.message);
      }
      console.log(`rendered ${texts.length} texts with ${await renderer.version()}`);
    }
  }

  if (flags.includes('--solutions')) {
    for (const item of content.all()) {
      if (item.meta.type !== 'exercise' || !('code' in item) || !item.code || !hasTests(item.code)) continue;
      const run = (files: Record<string, string>) =>
        runChecks({
          runghcBin: config.runghcBin,
          swiplBin: config.swiplBin,
          sldcheckBin: config.sldcheckBin,
          haskellLib: path.join(assets, 'haskell'),
          prologLib: path.join(assets, 'prolog'),
          workDir: path.join(tmp, 'runs'),
          code: item.code!,
          files,
        });
      const id = item.meta.id;
      if (item.code.solution === null) {
        report('warning', id, 'has tests but no solution to verify them against');
        continue;
      }
      const sol = await run(item.code.fullSolution);
      if (item.code.language === 'sld') {
        // The tree is checked against the program: the solution must have no error. There is nothing to say about
        // the starter, which is usually empty.
        if (sol.runnerError || !sol.compiled) report('error', id, `solution does not run: ${sol.runnerError ?? sol.diagnostics[0]?.message}`);
        for (const d of sol.diagnostics.filter((x) => x.severity === 'error')) report('error', id, `reference solution, line ${d.line}${d.code ? ` [${d.code}]` : ''}: ${d.message.replace(/\n/g, ' ')}`);
        for (const d of sol.diagnostics.filter((x) => x.severity === 'warning')) report('warning', id, `reference solution, line ${d.line}${d.code ? ` [${d.code}]` : ''}: ${d.message.replace(/\n/g, ' ')}`);
        console.log(`checked ${id}: ${sol.results.every((x) => x.status === 'pass') && sol.results.length > 0 ? 'the tree is correct' : 'the tree has errors'}`);
        continue;
      }
      if (sol.runnerError || !sol.compiled) report('error', id, `solution does not run: ${sol.runnerError ?? sol.diagnostics[0]?.message}`);
      for (const r of sol.results.filter((x) => x.status !== 'pass')) report('error', id, `reference solution fails "${r.name}": ${r.message.replace(/\n/g, ' ')}`);
      const stub = await run(item.code.files);
      // Usually a starter should run the tests, or a student's first test run is an error about the exercise.
      // A warning only: when students add instances themselves, the tests cannot compile before they do.
      if (stub.runnerError) report('warning', id, `tests do not run on the starter: ${stub.runnerError}`);
      else if (!stub.compiled) report('warning', id, `starter does not compile: ${stub.diagnostics.find((d) => d.severity === 'error')?.message}`);
      for (const r of stub.results.filter((x) => x.status === 'fail')) report('warning', id, `starter gives a wrong answer (not "not implemented") for "${r.name}"`);
      console.log(`checked ${id}: ${sol.results.filter((x) => x.status === 'pass').length}/${sol.results.length} pass on the solution`);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Not a problem, just something an author may want to know: `start-here: 🦔` picks another animal.
const byAnimal = new Map<string, string[]>();
for (const item of content.all())
  if (item.meta.type === 'exercise' && item.meta.startHere && item.meta.emoji) byAnimal.set(item.meta.emoji, [...(byAnimal.get(item.meta.emoji) ?? []), item.meta.id]);
const repeats = [...byAnimal].filter(([, ids]) => ids.length > 1);
if (repeats.length) {
  console.log('\nnote: these animals appear more than once:');
  for (const [emoji, ids] of repeats) console.log(`  ${emoji} ${ids.join(', ')}`);
}

// Without extra material, "thorough" and "everything" show the same.
const exercises = content.all().filter((i) => i.meta.type === 'exercise');
if (exercises.length && !content.all().some((i) => 'extra' in i.meta && i.meta.extra))
  console.log('\nnote: nothing is marked `extra: true` (exercise, lesson or page), so the focus "thorough" shows the same as "everything"');

console.log(`\n${content.outline.chapters.length} chapters, ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
