import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundle each package's page half into its own `dist`, after `tsc` has emitted.
 *
 * A page agent is the one artifact in this repository that has to cross into a
 * browser, and it cannot cross as ESM: a module evaluates asynchronously, so the
 * "did the bundle install?" check races it instead of catching a broken one. It
 * therefore needs a bundler — and a bundler is not something a consumer of a
 * visual-regression tool should install, which `tools/shape.check.ts` enforces by
 * refusing build tools in any package's `dependencies`.
 *
 * So the bundling happens here, at this repository's build time, and the packages
 * ship the result. `cases/storybook-case` does the same thing for the same reason
 * in its own `collector/bundle.mjs`; the difference is only that a case is
 * allowed to own its bundler and a package is not.
 *
 * Generated rather than committed, so it cannot describe yesterday's collector
 * while every other signal says it is about today's.
 *
 * A bundle is read as text and run in the page, so no test loads what went into
 * it through the runner and no recording holds a line of it. The `chromium`
 * suite, whose tests inject the bundles, therefore declares each bundle's entry
 * as its `before` in the root `variance.config.json`: selection walks forward
 * from an entry, so an edit to anything a bundle is built from runs that whole
 * suite. `inputsOf` lists what each bundle is built from, as the
 * sources a diff names, and `tools/page-agents.check.ts` holds the declaration
 * to that list.
 */

// FIXME: the declaration over-picks: an edit to one bundled source runs every `chromium` test, not the ones that
// injected its bundle. Measuring it needs a marked id per injected bundle input, emitted by eyes and presentation
// through the probe runtime and folded by every runner — the probe protocol in two packages that do not depend on sense.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each entry is `[package, entry within dist, output within dist]`. */
export const AGENTS = [
  ['packages/eyes', 'page-agent-entry.js', 'page-agent.bundle.js'],
  ['packages/presentation', 'browser-agent-entry.js', 'browser-agent.bundle.js'],
  ['packages/playwright-test', 'page-agent-entry.js', 'page-agent.bundle.js'],
  ['packages/storybook-collector', 'page-agent-entry.js', 'page-agent.bundle.js'],
  ['packages/route-collector', 'page-agent-entry.js', 'page-agent.bundle.js'],
];

/**
 * What esbuild is told for one agent: the build that writes the bundle and the
 * one that only lists its inputs are the same build.
 *
 * @param {readonly [string, string, string]} agent one of {@link AGENTS}
 * @returns {import('esbuild').BuildOptions}
 */
function optionsOf([pkg, entry, out]) {
  const from = join(ROOT, pkg, 'dist', entry);

  // A missing entry means `tsc` did not emit, which is a build ordering problem
  // and not something to paper over with an empty bundle: the failure would
  // arrive in a browser, as an agent that is simply not installed.
  if (!existsSync(from)) {
    throw new Error(`page-agents: ${pkg} has no built ${entry}; run \`tsc --build\` first`);
  }

  return {
    absWorkingDir: ROOT,
    entryPoints: [from],
    outfile: join(ROOT, pkg, 'dist', out),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
  };
}

/**
 * The sources an emitted module was compiled from, repository-relative.
 *
 * A bundle's inputs are `dist` files, and nothing in a diff names one. `tsc`
 * wrote a map beside each, and the map names the source it read; a file with no
 * map is its own source.
 *
 * @param {string} file the emitted module, repository-relative
 * @returns {string[]} the sources it was emitted from
 */
function sourcesOf(file) {
  const map = join(ROOT, `${file}.map`);
  if (!existsSync(map)) return [file];
  const { sources } = JSON.parse(readFileSync(map, 'utf8'));
  return sources.map((source) => relative(ROOT, resolve(dirname(join(ROOT, file)), source)));
}

/**
 * What one agent's bundle is built from, as the sources a diff names: its entry,
 * and every input esbuild reads for it, sorted by code unit.
 *
 * Asked of esbuild with the options the build uses, writing nothing, so the
 * answer is the bundle's and no list of it is kept anywhere to go stale.
 *
 * @param {readonly [string, string, string]} agent one of {@link AGENTS}
 * @returns {Promise<{ entry: string, inputs: string[] }>}
 */
export async function inputsOf(agent) {
  const options = optionsOf(agent);
  const { metafile } = await build({ ...options, write: false, metafile: true });
  const [entry] = sourcesOf(relative(ROOT, options.entryPoints[0]));
  const inputs = [...new Set(Object.keys(metafile.inputs).flatMap(sourcesOf))].sort();
  return { entry, inputs };
}

/** Bundle every agent into its package's `dist`. */
async function bundleAll() {
  for (const agent of AGENTS) {
    await build(optionsOf(agent));
    console.log(`page-agents: ${agent[0]}/dist/${agent[2]}`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await bundleAll();
