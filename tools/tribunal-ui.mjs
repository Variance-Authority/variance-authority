import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundle the review surface into `tribunal/dist/ui`, after `tsc` has emitted.
 *
 * The Node service serves a document and one script; a React component tree is
 * neither. Something has to bundle it, and a bundler is not something a consumer
 * of a visual-regression tool should install — `tools/shape.check.ts` refuses
 * build tools in any package's `dependencies`. So the bundling happens here, at
 * this repository's build time, and the package ships the result. Same rule and
 * same reason as `tools/page-agents.mjs`; the difference is only the format.
 *
 * **ESM, not IIFE.** A page agent is loaded by a check that races a module's
 * asynchronous evaluation, so it cannot be one. This is a `<script type="module">`
 * on a page that has nothing to race: the document is inert until it runs.
 *
 * React and `react-dom` are bundled in. They are a peer dependency of the package
 * for the *importing* case — a Next.js app renders `ReviewApp` with its own React
 * and must not get a second one — and this artifact is the other case: a browser
 * with no module system being handed a finished page.
 *
 * Generated rather than committed, so it cannot serve yesterday's surface while
 * every other signal says it is today's.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'packages/tribunal/dist/ui/browser-entry.js');
const OUT = join(ROOT, 'packages/tribunal/dist/ui/review.bundle.js');

// A missing entry means `tsc` did not emit, which is a build-ordering problem and
// not something to paper over with an empty bundle: the failure would arrive as a
// review surface that loads a script and stays blank.
if (!existsSync(ENTRY)) {
  throw new Error(`tribunal-ui: no built ${ENTRY}; run \`tsc --build\` first`);
}

await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});

console.log(`tribunal-ui: packages/tribunal/dist/ui/review.bundle.js`);
