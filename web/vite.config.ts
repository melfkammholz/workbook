import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

const api = process.env.WB_API ?? 'http://localhost:8080';

/** The Latin faces of the two body fonts start loading with the page, not once the stylesheet has been read. */
function preloadFonts(): Plugin {
  const wanted = [/schibsted-grotesk-latin-wght-normal-[\w-]+\.woff2$/, /fira-code-latin-wght-normal-[\w-]+\.woff2$/];
  return {
    name: 'wb-preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) => wanted.some((w) => w.test(f)));
        return files.map((f) => ({ tag: 'link', attrs: { rel: 'preload', href: `/${f}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' as const }));
      },
    },
  };
}

/** Brotli and gzip copies of scripts, styles and HTML, which the server sends to browsers that take them. */
function precompress(): Plugin {
  let outDir = '';
  return {
    name: 'wb-precompress',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
      for (const file of walk(outDir)) {
        if (!/\.(js|css|html|svg|json)$/.test(file)) continue;
        const data = fs.readFileSync(file);
        if (data.length < 1024) continue;
        fs.writeFileSync(`${file}.br`, zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
        fs.writeFileSync(`${file}.gz`, zlib.gzipSync(data, { level: 9 }));
      }
    },
  };
}

/** The font files and character maps pdf.js needs for PDFs that do not embed their fonts (served at /pdfjs/, copied into the build). */
function pdfjsAssets(): Plugin {
  const root = path.resolve(import.meta.dirname, '../node_modules/pdfjs-dist');
  const dirs = ['standard_fonts', 'cmaps'];
  return {
    name: 'wb-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const file = path.join(root, decodeURIComponent((req.url ?? '').split('?')[0]!));
        if (!dirs.some((d) => file.startsWith(path.join(root, d) + path.sep)) || !fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const d of dirs) {
        for (const f of fs.readdirSync(path.join(root, d))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${d}/${f}`, source: fs.readFileSync(path.join(root, d, f)) });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts(), pdfjsAssets(), precompress()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      // Not the short form `'/api': api`: it rewrites Host to the API's, which no longer
      // matches the page's Origin, and the server rejects every write as cross-site.
      '/api': { target: api },
      '/ws': { target: api, ws: true },
    },
  },
  // The main chunk stays under 500 kB: pages and CodeMirror are loaded when needed (`src/lib/routes.ts`).
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 500 },
});
