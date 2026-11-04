import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './api/app.js';
import { makeDeps } from './api/deps.js';
import { loadConfig } from './config.js';
import { CourseManager } from './courses/manager.js';
import { SessionPool } from './runners/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from `src/` (tsx) and from the bundled `dist/`.
const assets = [path.resolve(here, '../assets'), path.resolve(here, '../../assets')].find((p) => fs.existsSync(path.join(p, 'typst'))) ?? path.resolve(here, '../assets');

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });

const pool = new SessionPool(config.maxSessions, config.idleTimeoutMs);
pool.start();

const courses = new CourseManager({
  config,
  typstAssets: path.join(assets, 'typst'),
  onSwitch: () => pool.closeSessions('the course was changed'),
  onLoad: (title, c) => {
    const { problems, chapters } = c.outline;
    const errors = problems.filter((p) => p.severity === 'error').length;
    console.log(`${title}: ${chapters.length} chapters, ${errors} errors, ${problems.length - errors} warnings (version ${c.outline.version})`);
  },
});

const app = await buildApp(makeDeps({ config, courses, pool, haskellLib: path.join(assets, 'haskell'), prologLib: path.join(assets, 'prolog') }));
await app.listen({ port: config.port, host: config.host });
console.log(`Workbook running on http://localhost:${config.port}`);

const shutdown = async () => {
  pool.closeAll();
  await app.close();
  courses.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
