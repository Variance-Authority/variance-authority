import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';
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
 * The recorded extents are in `src` coordinates either way. Probes are placed
 * after the runner's transform and the block spans are translated back through
 * the map that transform carried, which for a `dist` module is `tsc`'s own
 * `.js.map`. So a hunk header from `git diff` lands on the region an author
 * edited, under whichever of the two names the snapshot holds.
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

/**
 * The suite without the recording, exported so it can be run without it.
 *
 * `tools/uninstrumented.config.mts` is this and nothing else, and it is the arm
 * [journal 0027](docs/context/journal/0027-what-instrumentation-costs.md)
 * compares against — the one measurement that has to be able to take the probes
 * away. Exported rather than restated, so the two arms cannot drift into
 * measuring different suites.
 */
export const suite = defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/*/test/**/*.test.ts',
      'examples/*/src/**/*.test.{ts,tsx}',
      'cases/*/src/**/*.test.{js,ts,tsx}',
    ],
    // `node` is the default; corpus fixtures opt into jsdom per-file with a
    // `// @vitest-environment jsdom` docblock, so the DOM-free packages stay
    // DOM-free (ADR-0001) and nothing accidentally acquires a `document`.
    environment: 'node',
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
 * What the instrument is pointed at, exported so a second arm can record the
 * same suite under different options without restating any of it.
 */
export const selection = {
  root: ROOT,
  include: instrumentable,
  // What governs every observation rather than any one of them: the runner
  // itself, the manifest that resolves every import, the lockfile behind it,
  // and the compiler settings the built half is emitted under. Editing one
  // retires every inherited crossing, which is what declaring a precondition is
  // for. Everything else a change touches — a package manifest, a fixture, a
  // workflow — has no row, and `tools/test-since.mjs` widens to the whole suite
  // rather than pretending the snapshot has an opinion about it.
  preconditions: ['vitest.config.mts', 'package.json', 'yarn.lock', 'tsconfig.base.json'],
};

export default withTestSelection(suite, selection);
