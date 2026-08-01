/**
 * Builds the page agent, in memory.
 *
 * Shared by the measurement, the benchmark, and `bundle.mjs`, so all three inject
 * the same bytes. Built on demand rather than read from a committed artifact
 * because a stale `harness-bundle.js` would make a P4 disagreement a story about
 * which of the two profiles was running yesterday's fixtures.
 *
 * IIFE, not ESM: the harness injects it with `addScriptTag({ content })`, and a
 * module would be evaluated asynchronously — the harness's "did the bundle
 * install the agent?" check would then race the bundle instead of catching a
 * broken one.
 */
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const AGENT_ENTRY = resolve(here, '../src/page-agent.ts');
export const HARNESS_PAGE = resolve(here, '../page/harness.html');

/** `file://` URL of the inert harness page. No server, so no port to collide. */
export const HARNESS_PAGE_URL = pathToFileURL(HARNESS_PAGE).href;

export async function buildAgentBundle() {
  const result = await build({
    entryPoints: [AGENT_ENTRY],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    write: false,
    minify: false,
    // `development`, matching what Vitest gives the JSDOM half. React's two
    // builds differ in warnings rather than in rendered DOM, but the profiles
    // must not differ in any input a measurement could later be blamed on.
    define: { 'process.env.NODE_ENV': '"development"' },
  });

  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild produced no output for the page agent');
  return output.text;
}

// Usable as `node agent-bundle.mjs <outfile>`.
//
// The measurement needs this, and cannot call `buildAgentBundle` directly: it
// runs under Vitest's jsdom environment, where `new TextEncoder().encode('')` is
// a `Uint8Array` from a different realm and esbuild refuses to start. Building in
// a child process is the smallest fix that keeps both profiles in one file, which
// is what makes the comparison a measurement rather than two reports.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outfile = process.argv[2];
  if (outfile === undefined) throw new Error('usage: node agent-bundle.mjs <outfile>');
  await writeFile(outfile, await buildAgentBundle());
}
