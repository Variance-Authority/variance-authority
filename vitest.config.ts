import { defineConfig } from 'vitest/config';

/**
 * The tests, and only the tests.
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
 */

export default defineConfig({
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
  },
});
