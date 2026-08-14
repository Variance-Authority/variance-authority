import { defineConfig } from 'vitest/config';
import { instrument } from '../packages/oxc/dist/instrument/index.js';

/**
 * The same suite, with every product file instrumented.
 *
 * This is the acceptance test for
 * [spec 0028](../docs/specs/0028-the-instrument.md), and it is deliberately not a
 * unit test. A transform is correct when the program it produces does what the
 * program it consumed did, and the only honest way to establish that over a
 * hundred thousand lines is to run them: same tests, same results, same exit code,
 * with probes and without.
 *
 * It also produces the number that decides whether the project is worth building.
 * `o` — this run's wall clock over `yarn test`'s — is pre-registered at ≤ 1.35 in
 * [spec 0027](../docs/specs/0027-a-test-is-selected-by-what-it-executed.md), and
 * no other component can measure it.
 *
 * Run:  yarn workspace @variance-authority/oxc differential
 *
 * `enforce: 'post'` is load-bearing twice over. It puts this after esbuild, so the
 * probes land on JavaScript rather than on TypeScript nobody will run; and it puts
 * it after vitest's own transform, which has already hoisted `vi.mock` to the top
 * of the file — a header spliced above that hoisting would change evaluation
 * order, silently, in whichever direction the mock mattered.
 */

/** Product code only. A probe in a test file records the test observing itself. */
const PRODUCT = /[/\\]packages[/\\][^/\\]+[/\\]src[/\\].*\.[cm]?[jt]sx?$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;

export default defineConfig({
  plugins: [
    {
      name: 'variance:instrument',
      enforce: 'post',
      transform(code: string, id: string) {
        const path = id.split('?')[0] ?? id;
        if (!PRODUCT.test(path) || TEST.test(path)) return null;

        const done = instrument(code, path);
        // A file this cannot read runs uninstrumented rather than not at all. The
        // count of those is the honest report; a throw here would be a suite that
        // fails for a reason unrelated to the code under test.
        return done === undefined ? null : { code: done.code, map: null };
      },
    },
  ],
  test: {
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/*/test/**/*.test.ts',
      'examples/*/src/**/*.test.{ts,tsx}',
      'cases/*/src/**/*.test.{js,ts,tsx}',
    ],
    environment: 'node',
  },
  esbuild: {
    jsx: 'automatic',
  },
});
