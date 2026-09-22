import { mergeConfig } from 'vitest/config';
import { suite } from '../vitest.config.mjs';

/**
 * A second instrument over the same suite, owned by somebody else.
 *
 * This repository records what every test executed and then reasons about it —
 * which region, which importer, which test may be skipped. All of that is our
 * own arithmetic over our own probes, and an instrument that grades itself is
 * not evidence. V8's counters are the independent reading: a different
 * mechanism, written by people with no stake in our answer, over the same files
 * in the same run.
 *
 * ```bash
 * yarn test:coverage
 * ```
 *
 * It runs the suite with the probes taken away. Our transform is
 * `enforce: 'post'` and returns text without a source map, so a coverage
 * provider reading the probed output would attribute counts to lines the author
 * never wrote — the two instruments would disagree about the file rather than
 * about the code. Reusing `suite` is what keeps them looking at one subject:
 * same include globs, same environment, one plugin fewer.
 *
 * No threshold. A percentage that gates turns into a number people write tests
 * to move, and the question here is whether our record and a foreign counter
 * tell the same story about the same run — not whether either reaches a figure
 * somebody picked.
 */
export default mergeConfig(suite, {
  test: {
    // Counting costs time, and the browser arms are the only tests in this
    // suite that measure their own wall clock. Under v8's counters three of
    // them cross a timeout they clear comfortably without it, so this arm
    // gives them room. It is the only thing this config changes about the run.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      enabled: true,
      provider: 'v8',
      // The product, in the shape it is written. `dist` is the same code after
      // `tsc`, and counting both would report every cross-package module twice
      // under two names.
      include: ['packages/*/src/**/*.{ts,tsx,mts,cts}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.check.ts',
        '**/*.measure.ts',
        '**/__fixtures__/**',
        '**/fixtures/**',
        '**/dist/**',
      ],
      // Every file, not only the ones a test happened to load: a module nothing
      // imports reads as 0% here, and reads as nothing at all if it is left out.
      all: true,
      reporter: ['text-summary', 'json-summary'],
      // A failing suite is exactly when the reading is wanted: the question is
      // what ran, and a run that ends red still ran.
      reportOnFailure: true,
    },
  },
});
