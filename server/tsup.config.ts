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
  // The PDF reader finds its worker file next to itself, so it stays a package.
  external: ['node:sqlite', /^pdfjs-dist/],
});
