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
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const ENTRY = resolve(here, '../src/page-agent.ts');
export const OUTFILE = resolve(here, '../dist/case.js');
/** What the bundle was built from, so staleness is read rather than guessed. */
export const MANIFEST = resolve(here, '../dist/case.inputs.json');
export const PAGE = resolve(here, '../page/case.html');

/** `file://` URL of the page. No server, so no port for two runners to fight over. */
export const PAGE_URL = pathToFileURL(PAGE).href;

export async function bundle() {
  const result = await build({
    metafile: true,
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

  // esbuild's own input list, rather than a hand-written guess at one. The
  // guessed version reported the *test file* as an input and refused to run.
  writeFileSync(
    MANIFEST,
    `${JSON.stringify({ base: process.cwd(), inputs: Object.keys(result.metafile.inputs) })}\n`,
    'utf8',
  );

  return OUTFILE;
}

/**
 * Whether the built page is older than what it was built from.
 *
 * The bundle is deliberately *read* rather than rebuilt at test time, so that
 * both arms observe the same bytes — see the note in the test's `beforeAll`.
 * The cost of that is a stale bundle testing yesterday's implementation while
 * reporting a green head-to-head, which is the same failure as a silently
 * skipped case: it reads in a summary exactly like a case that ran and agreed.
 * A `packages/dom` fix went un-exercised here once already, and the run stayed
 * green throughout.
 *
 * Returns `null` when the bundle is current, or a sentence naming what is newer.
 */
export function stale() {
  let built;
  try {
    built = statSync(OUTFILE).mtimeMs;
  } catch {
    return 'the page bundle has not been built';
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    // A bundle with no manifest predates this check. Refusing is the safe
    // reading: it is exactly the state that produced the stale run.
    return 'the page bundle was built without an input manifest';
  }

  for (const input of manifest.inputs) {
    const path = isAbsolute(input) ? input : resolve(manifest.base, input);
    let at;
    try {
      at = statSync(path).mtimeMs;
    } catch {
      return `the page bundle was built from ${input}, which is gone`;
    }
    if (at > built) return `the page bundle is older than ${input}`;
  }

  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await bundle());
}
