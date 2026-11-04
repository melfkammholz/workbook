import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Types-only workspace package: inline it so the runtime has no workspace dependency.
  noExternal: ['@wb/shared'],
  // `node:sqlite` only exists with its prefix; tsup would strip it from built-in imports.
  removeNodeProtocol: false,
  external: ['node:sqlite'],
});
