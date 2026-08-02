/**
 * Bundles the real-browser check.
 *
 * The vitest suite proves the fiber walk under jsdom; this proves the *same
 * code* under a real engine, which is the claim ADR-0002 rests on when it puts
 * the provenance dimension in the cheap tier. Kept as a manual harness rather
 * than a CI job because it needs a browser, and CI has none until the Playwright
 * collector lands.
 *
 *   node packages/provenance-react/browser-check/build.mjs
 *   python3 -m http.server 5599 --directory packages/provenance-react/browser-check/www
 *   # open http://localhost:5599; results are in the <pre> and on the console
 *
 * The `node:crypto` alias is not a convenience — see `crypto-stub.js`.
 */
import { build } from 'esbuild';

const here = new URL('.', import.meta.url).pathname;

await build({
  entryPoints: [`${here}entry.jsx`],
  bundle: true,
  outfile: `${here}www/bundle.js`,
  format: 'iife',
  // Development, deliberately: `_debugOwner` — and therefore `createdBy` —
  // exists only in dev builds, so a production bundle would quietly verify a
  // weaker property than the one under test.
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { 'node:crypto': `${here}crypto-stub.js` },
  logLevel: 'info',
});
