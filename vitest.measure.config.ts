import { defineConfig } from 'vitest/config';

/**
 * Measurements: what does this cost, on this machine, right now?
 *
 * Separate from `vitest.config.mts` because that suite instruments every product
 * module it loads, and a file that gates on how long the product takes cannot be
 * measured through the thing measuring it. A probe is small — the whole suite
 * runs at the same wall clock with them as without
 * ([journal 0027](docs/context/journal/0027-what-instrumentation-costs.md)) —
 * but it is not evenly small. It lands in the product's hot loops and nowhere
 * else, so a ratio with product code on one side and a library on the other
 * moves under instrumentation even though neither half of the trade changed.
 * The session's cost test is exactly that shape: `new JSDOM` against `collect`
 * and `normalize`. Its reading fell from about two thirds to about half, which
 * is the bound, so under load it began to fail for a reason that has nothing to
 * do with the code it exists to hold.
 *
 * A share whose halves are both the product stays where it was — the collection
 * cost in `packages/dom` times the index against the rest of the same `collect`
 * — so it is a test and it stays in the suite. What moves here is what
 * instrumentation can distort.
 *
 * Same runner, and these are tests: they have a subject and they exercise it.
 * Different command, because `yarn test` now answers "does it work, and what did
 * each test touch" and this one answers "what does it cost". `.measure.ts`
 * rather than `.test.ts` so the distinction survives someone opening the file
 * rather than the config.
 */

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.measure.ts'],
    environment: 'node',
  },
});
