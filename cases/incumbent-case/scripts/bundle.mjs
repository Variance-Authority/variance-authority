/**
 * Builds the page bundle both arms load.
 *
 * Written to `dist/case.js` rather than held in memory, because the incumbent's
 * runner is a separate process that navigates to a `file://` URL and can only
 * load what is on disk. Our arm reads the same file and injects it, so the two
 * arms are guaranteed the same bytes — a bundle built twice, once per arm, is a
 * bundle that can differ.
 *
 * IIFE, not ESM: our harness injects it with `addScriptTag({ content })`, and a
 * module would be evaluated asynchronously — the harness's "did the bundle
 * install the agent?" check would then race the bundle rather than catch a
 * broken one.
 */
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const ENTRY = resolve(here, '../src/page-agent.ts');
export const OUTFILE = resolve(here, '../dist/case.js');
export const PAGE = resolve(here, '../page/case.html');

/** `file://` URL of the page. No server, so no port for two runners to fight over. */
export const PAGE_URL = pathToFileURL(PAGE).href;

export async function bundle() {
  await build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    minify: false,
    // `development`, matching what Vitest gives every other subject here.
    // React's two builds differ in warnings rather than in rendered DOM, but a
    // pixel measurement must not differ in any input it could later be blamed on.
    define: { 'process.env.NODE_ENV': '"development"' },
  });

  return OUTFILE;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await bundle());
}
