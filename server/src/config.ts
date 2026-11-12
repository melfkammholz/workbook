import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  /** A course folder given at startup, mainly for writing content. Optional: students add repositories in the app. */
  contentDir: string;
  /** Workbooks on this computer (plain folders or git repos), offered in the add dialog. Optional. */
  workbooksDir: string;
  /** Persistent student data: SQLite file, caches. */
  dataDir: string;
  /** Directory with the built web app, or null in development. */
  webDir: string | null;
  typstBin: string;
  ghciBin: string;
  runghcBin: string;
  swiplBin: string;
  pythonBin: string;
  /** The `sldcheck` command, which checks SLD trees. */
  sldcheckBin: string;
  /** Max simultaneously open interpreter sessions. */
  maxSessions: number;
  idleTimeoutMs: number;
  /** Hostnames the server answers to (guards against DNS rebinding). */
  allowedHosts: string[];
}

export function loadConfig(env = process.env): Config {
  const abs = (p: string) => path.resolve(p);
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    contentDir: abs(env.CONTENT_DIR ?? './content'),
    workbooksDir: abs(env.WORKBOOKS_DIR ?? './workbooks'),
    dataDir: abs(env.DATA_DIR ?? './data'),
    webDir: env.WEB_DIR ? abs(env.WEB_DIR) : null,
    typstBin: env.TYPST_BIN ?? 'typst',
    ghciBin: env.GHCI_BIN ?? 'ghci',
    runghcBin: env.RUNGHC_BIN ?? 'runghc',
    swiplBin: env.SWIPL_BIN ?? 'swipl',
    pythonBin: env.PYTHON_BIN ?? 'python3',
    sldcheckBin: env.SLDCHECK_BIN ?? 'sldcheck',
    maxSessions: Number(env.MAX_SESSIONS ?? 6),
    idleTimeoutMs: Number(env.SESSION_IDLE_MS ?? 15 * 60_000),
    allowedHosts: (env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  };
}
