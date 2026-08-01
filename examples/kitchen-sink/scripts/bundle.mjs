/**
 * Bundles the browser entry into `page/bundle.js`.
 *
 * React's npm package ships CommonJS, so a browser cannot load `src/browser.ts`'s
 * output directly, and an import map pointing at a CDN would make every collector
 * run depend on the network — which for a corpus whose entire subject is
 * *determinism* is not a tradeoff worth making. Fifteen lines of esbuild instead.
 *
 * Not part of `yarn build`: `tsc --build` is what CI type-checks, and this
 * artifact is only needed when someone actually opens a browser.
 */
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildAgentBundle } from './agent-bundle.mjs';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(here, '../src/browser.ts')],
  outfile: resolve(here, '../page/bundle.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  // The corpus measures rendered output, not bundle size, and a minified build
  // would make the page harder to inspect by hand when a case misbehaves.
  minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
});

console.log('wrote page/bundle.js');

// The harness builds this itself, in memory, on every run — writing it out is
// only so `page/harness.html` can be opened by hand with the agent available to
// the console. Nothing in the measurement path reads this file.
await writeFile(resolve(here, '../page/harness-bundle.js'), await buildAgentBundle());
console.log('wrote page/harness-bundle.js');
