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
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

/** The bytes, not when they were written. See the note on {@link stale}. */
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export async function bundle({ entry = ENTRY, outfile = OUTFILE, manifest = MANIFEST } = {}) {
  const result = await build({
    metafile: true,
    entryPoints: [entry],
    outfile,
    // Stated, so that the keys in `metafile.inputs` and the `base` recorded
    // below are relative to the same directory *by construction*.
    //
    // Left to itself esbuild resolves them against its own service process's
    // working directory, which is the cwd at the moment the service span up —
    // not necessarily Node's cwd when `build()` is called. A caller that
    // `chdir`s between those two points gets keys relative to one directory and
    // a `base` naming another, and the reader then resolves a path that is not
    // there. The first Linux run found it: `resolve('/tmp', 'tmp/…/helper.ts')`
    // → `/tmp/tmp/…`, on a machine where `tmpdir()` is not a symlink.
    absWorkingDir: process.cwd(),
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
  const inputs = Object.keys(result.metafile.inputs);
  const digests = {};
  for (const input of inputs) {
    digests[input] = digest(isAbsolute(input) ? input : resolve(process.cwd(), input));
  }

  // esbuild's own name for the entry, not `relative(cwd, entry)`. The two differ
  // whenever the path reaches here through a symlink — on macOS `/var` resolves
  // to `/private/var`, so a computed key misses and the guard refuses a bundle it
  // has just written. Read from the metafile, it is the same string as a key in
  // `digests` by construction. The round-trip test found this on its first run.
  const output = Object.values(result.metafile.outputs).find((it) => it.entryPoint !== undefined);

  // `inputs` stays the array it always was, and the digests arrive beside it.
  // Changing its shape would make an older checkout of this file throw an
  // uncaught `TypeError` at module scope while reading a newer manifest — and
  // `stale()` is called at module scope, so a `git bisect` across this change
  // would turn two suites into collection failures rather than into skips.
  writeFileSync(
    manifest,
    `${JSON.stringify({
      base: process.cwd(),
      entry: output?.entryPoint,
      inputs,
      bundle: digest(outfile),
      digests,
    })}\n`,
    'utf8',
  );

  return outfile;
}

/**
 * Whether the built page is the one its inputs still describe.
 *
 * The bundle is deliberately *read* rather than rebuilt at test time, so that
 * both arms observe the same bytes — see the note in the test's `beforeAll`.
 * The cost of that is a stale bundle testing yesterday's implementation while
 * reporting a green head-to-head, which is the same failure as a silently
 * skipped case: it reads in a summary exactly like a case that ran and agreed.
 * A `packages/dom` fix went un-exercised here once already, and the run stayed
 * green throughout.
 *
 * ## Compared by content, and it used to be by mtime
 *
 * The first version asked whether any input was *newer* than the bundle, which is
 * a question about when a file was last written and not about what it says.
 * `yarn typecheck` is `tsc --build --force`, which re-emits every `dist` file with
 * the bytes that were already there: 55 of the 68 recorded inputs get a new mtime,
 * the bundle gets none, and 44 tests refuse to run against a bundle that is
 * correct. The only way out was to re-record the incumbent's baselines — so the
 * guard's noise was teaching a reader to run the command that silences it, which
 * is how a guard gets deleted instead of fixed. It fired on the two commands this
 * repository tells a developer to run in sequence.
 *
 * The other direction is the rest of the argument. An mtime that moves *backwards*
 * — a restored cache, an archive unpacked with its times, a dependency downgraded
 * — leaves a changed file looking older than the bundle, and the old check read
 * that as current. That is the original failure exactly: a green head-to-head
 * against an implementation nobody is running.
 *
 * The bundle's own digest is recorded beside the inputs', because the claim is
 * "this file was produced from these bytes" and half of it is about this file. A
 * half-written `case.js` from an interrupted build has the newest mtime in the
 * tree, which the old check read as maximally fresh.
 *
 * **What it still cannot see:** an input that would *enter* the graph without any
 * recorded input changing — a package's `exports` re-pointed, a directory grown an
 * `index.js` that wins resolution. esbuild's metafile does not list the files it
 * consulted to resolve, so the manifest cannot record them. Only a rebuild answers
 * that, and a rebuild is the thing this case may not do.
 *
 * Returns `null` when the bundle is current, or a sentence naming what moved.
 */
export function stale({ outfile = OUTFILE, manifest: manifestPath = MANIFEST } = {}) {
  let bundled;
  try {
    bundled = digest(outfile);
  } catch {
    return 'the page bundle has not been built';
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    // A bundle with no manifest predates this check. Refusing is the safe
    // reading: it is exactly the state that produced the stale run.
    return 'the page bundle was built without an input manifest';
  }

  // A manifest from before digests existed has an input list and no answer.
  // Reading the half that is there and calling the rest a pass is how a partial
  // check gets summarised as a check that ran.
  const digests = manifest.digests;
  if (
    typeof manifest.base !== 'string' ||
    typeof manifest.bundle !== 'string' ||
    digests === null ||
    typeof digests !== 'object' ||
    Array.isArray(digests)
  ) {
    return 'the page bundle was built without input digests — rebuild it';
  }

  // Non-emptiness, said as coherence: the manifest names the entry it was built
  // from, and that entry must be one of the files it recorded. An empty digest
  // map would otherwise loop zero times and return `null` — a check that ran and
  // examined nothing.
  if (typeof manifest.entry !== 'string' || digests[manifest.entry] === undefined) {
    return 'the manifest does not record the entry point it names — rebuild it';
  }

  if (manifest.bundle !== bundled) return 'the page bundle is not the one this manifest describes';

  for (const [input, recorded] of Object.entries(digests)) {
    const path = isAbsolute(input) ? input : resolve(manifest.base, input);
    let now;
    try {
      now = digest(path);
    } catch (error) {
      return error.code === 'ENOENT'
        ? `the page bundle was built from ${input}, which is gone`
        : `the page bundle was built from ${input}, which cannot be read`;
    }
    // "a different", not "an older": content has no direction, and a message that
    // guesses one is wrong on every branch switch.
    if (now !== recorded) return `the page bundle was built from a different ${input}`;
  }

  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await bundle());
}
