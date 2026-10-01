import { mkdtempSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { nativeSources } from './tools/native-sources.mjs';
import { probeable } from './tools/page-side.mjs';

/** This file's directory, so the exclusions read the same from any cwd. */
const ROOT = import.meta.dirname;

/**
 * The tests, and only the tests — and the suite records what each one executed.
 *
 * `tools/` used to be in this list, and it should not have been. What lives
 * there asks whether the *repository* is in a legal state — is every link
 * resolvable, does every package declare what it imports, is any file over five
 * hundred lines. Those are real checks and they are not tests: they exercise no
 * behaviour, they have no subject, and a failure means somebody has to move a
 * file rather than fix a bug.
 *
 * Mixed in here they did two kinds of damage. They inflated the count — over a
 * thousand "tests" that are assertions about file layout — so nobody could tell
 * from the number whether the product was covered. And they made `yarn test`
 * fail for reasons that have nothing to do with the code under test, which is
 * how a suite stops being trusted.
 *
 * They now run under `yarn check`, from `vitest.checks.config.ts`.
 *
 * ## Why the wrapper
 *
 * `withTestSelection` is the seam this repository ships for somebody else's
 * suite, and until it was here the only thing that had ever run it over three
 * hundred real test files was a benchmark. Wrapping the suite itself costs a
 * measurement the project already took — probed and unprobed are not separable
 * at this resolution ([journal 0027](docs/context/journal/0027-what-instrumentation-costs.md))
 * — and buys the snapshot `yarn test:since` reads: which of these files entered
 * the regions a diff touched. `yarn test` is still the whole suite and still the
 * gate. What it additionally does now is write down what it saw.
 *
 * `.mts` because the wrapper is ESM and this file is bundled before it is
 * evaluated: a `.ts` config in a package with no `"type": "module"` is bundled
 * as CommonJS and refuses the import.
 */

/**
 * Product source, in both the shapes this suite executes it.
 *
 * A package's own tests import `../src/*.ts`. Every other package's tests reach
 * the same code through the manifest's `exports` into `dist/*.js`, which is the
 * path a consumer takes and the reason nothing here imports across packages by
 * relative path. One edit to one `.ts` file therefore moves two modules the
 * runner loads, and instrumenting only the first would leave every cross-package
 * change unattributable — `core` is imported by nearly everything, and nothing
 * in a `cli` test loads `packages/core/src`.
 *
 * Both shapes are recorded under the `src` path. Probes are placed after the
 * runner's transform, and the block spans, the digest and the module's name all
 * come back through the map that transform carried — for a `dist` module,
 * `tsc`'s own `.js.map`. So the two shapes are one row: a hunk header from `git`
 * diff lands on the region an author edited, and a graph walk asking how far a
 * test sits from that module has a path the scanner has actually read.
 */
const PRODUCT = /[/\\](?:packages|examples|cases)[/\\][^/\\]+[/\\]src[/\\]/;
const BUILT = /[/\\]packages[/\\][^/\\]+[/\\]dist[/\\]/;
const MODULE = /\.[cm]?[jt]sx?$/;
/** A probe in a test file would record the test observing itself. */
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Everything the runner transforms, minus the modules that cannot hold a probe.
 *
 * The subtraction is `tools/page-side.mjs`, which explains itself and names its
 * own check. Nothing is subtracted quietly: every entry there is a module whose
 * functions leave this process, and the list exists because the alternative —
 * a probe that tolerates its own absence — was tried and rejected.
 */
const instrumentable = (file: string) =>
  (PRODUCT.test(file) || BUILT.test(file)) && MODULE.test(file) && !TEST.test(file) && probeable(ROOT, file);

/** What every slice runs under. */
const shared = defineConfig({
  test: {
    // `node` is the default; corpus fixtures opt into jsdom per-file with a
    // `// @vitest-environment jsdom` docblock, so the DOM-free packages stay
    // DOM-free (ADR-0001) and nothing accidentally acquires a `document`.
    environment: 'node',
    // A cache of the run's own, for the workers only. A test that folds, saves
    // or indexes a fixture it made in a temporary directory otherwise writes a
    // layer keyed by that directory into this machine's cache, and the
    // directory is gone before anything can say whose the layer was: one
    // machine held seven thousand of them. The recording is folded in the main
    // process, which does not read `env`, so it still lands in the real cache.
    env: { VARIANCE_AUTHORITY_CACHE: mkdtempSync(join(tmpdir(), 'va-test-cache-')) },
    // A temporary directory of each test's own, so the machine's index turn a
    // test takes is its own and no other test's or developer's index waits on
    // it, or it on them. The file says why a turn made the recording depend on
    // scheduling.
    setupFiles: ['tools/temporary-per-test.ts'],
  },
  esbuild: {
    jsx: 'automatic',
    // Vite's own list is `m?ts` and leaves `.cts` out, which makes a CommonJS
    // TypeScript source the one kind of module in this repository that cannot
    // be unit tested — it reaches the runner untransformed and fails to parse.
    // The files that have to be CommonJS are the ones loaded inside another
    // runner's sandbox, which is not a reason to test them less.
    include: /\.([cm]?ts|[jt]sx)$/,
  },
});

/**
 * Where tests live. A slice is these places narrowed by a marker in the file
 * name, so a file says which slice it is in and no list has to.
 */
const PLACES = [
  'packages/*/src/**/*.test.{ts,tsx}',
  'packages/*/test/**/*.test.ts',
  'examples/*/src/**/*.test.{ts,tsx}',
  'cases/*/src/**/*.test.{js,ts,tsx}',
];

/** The cores this machine offers, which every worker count below is a share of. */
const CORES = availableParallelism();

/**
 * The slices of the suite, in the order `yarn test` runs them, each declared
 * under `suites` in the root `variance.config.json` and each with a record of
 * its own.
 *
 * They were one run until the run starved the machine it ran on. A file in the
 * integration slice starts a process: the CLI out of `dist`, or a whole Jest,
 * rstest or Vitest over a fixture, each of which picks its own worker count. A
 * file in the chromium slice launches a browser. Run beside four hundred
 * in-process files at one fork a core, a pull request's `yarn verify` held a
 * load average three times the core count. Apart, each slice is given the
 * number of files at once its files can afford, and a slow run says which kind
 * of test was slow.
 *
 * - `unit`: in the test's own process. It may start a program that answers
 *   and exits, such as `git`, and not Node or a browser; `tools/in-process.ts`
 *   names the programs and fails a test that starts anything else.
 * - `integration`: `*.integration.test.*`. Starts a process of ours or a test
 *   runner over a fixture. What that process executes is not in this record:
 *   the probes are in this process, so the record says which modules the test
 *   itself entered on its way to starting it.
 * - `chromium`: `*.chromium.test.*`. Launches Chromium, directly or through
 *   Playwright. A file with no Chromium installed reports itself skipped.
 */
export const SLICES = {
  unit: { marker: undefined, workers: undefined },
  // A file here is two processes at least, and a runner it starts is more.
  integration: { marker: 'integration', workers: Math.max(1, Math.floor(CORES / 4)) },
  // A browser is a handful of processes, each busy while a page renders.
  chromium: { marker: 'chromium', workers: Math.max(1, Math.floor(CORES / 8)) },
} as const;

export type SliceName = keyof typeof SLICES;

const MARKERS = Object.values(SLICES).flatMap((slice) => (slice.marker === undefined ? [] : [slice.marker]));

/** One slice as a Vitest config, without the recording. */
export function slice(name: SliceName) {
  const { marker, workers } = SLICES[name];
  return mergeConfig(shared, {
    test: {
      include: marker === undefined ? PLACES : PLACES.map((place) => place.replace('*.test.', `*.${marker}.test.`)),
      exclude: [...configDefaults.exclude, ...(marker === undefined ? MARKERS.map((other) => `**/*.${other}.test.*`) : [])],
      ...(marker === undefined ? { setupFiles: ['tools/in-process.ts'] } : {}),
      ...(workers === undefined ? {} : { maxWorkers: workers, minWorkers: 1 }),
    },
  });
}

/**
 * Every slice in one run, without the recording, at the most careful slice's
 * worker count. `tools/coverage.config.mts` counts what the whole suite
 * executes in its own processes, which no single slice can answer.
 */
export const whole = mergeConfig(shared, {
  test: { include: PLACES, maxWorkers: SLICES.chromium.workers, minWorkers: 1 },
});

/**
 * The unit slice without the recording, exported so it can be run without it.
 *
 * `tools/uninstrumented.config.mts` is this and nothing else, and it is the arm
 * [journal 0027](docs/context/journal/0027-what-instrumentation-costs.md)
 * compares against — the one measurement that has to be able to take the probes
 * away. Exported rather than restated, so the two arms cannot drift into
 * measuring different suites.
 */
export const suite = slice('unit');

/**
 * What the instrument is pointed at in one slice, exported so a second arm can
 * record the same slice under different options without restating any of it.
 */
export const selectionOf = (name: SliceName) => ({
  root: ROOT,
  // The suite this run is, as the root `variance.config.json` declares it.
  suite: name,
  include: instrumentable,
  // What governs every observation rather than any one of them. The seam
  // declares the config file Vite loaded and the local modules it imports, and
  // `tools/test-since.mjs` reads the manifests and the lockfile as the install
  // they record. What is left is what no import names: the compiler settings
  // the built half is emitted under, and the crate the native addon is built
  // from, which Node loads with `dlopen` and every instrumented module passed
  // through (`tools/native-sources.mjs` says why that is every test). Editing a
  // precondition retires every inherited crossing. A fixture or a workflow has
  // no row of its own, and selects nothing until it is declared here.
  preconditions: ['tsconfig.base.json', ...nativeSources(ROOT)],
});

/** The unit slice's, which `tools/native-sources.check.ts` holds to the crate. */
export const selection = selectionOf('unit');

export default withTestSelection(suite, selection);
