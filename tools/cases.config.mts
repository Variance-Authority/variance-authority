/**
 * The same suite, recorded per test case instead of per test file.
 *
 * The shipped arm answers *which files must run*, which is the question CI
 * asks. This one answers *which named tests went there*, which is the question
 * a reviewer and a coding agent ask — and it is a different record, not a
 * richer one: a case index holds a row per file-and-region rather than one per
 * region, so it grows with the cases in a file rather than with the modules in
 * the repository.
 *
 * It is a second arm rather than a flag on the first because the index is tens
 * of megabytes and the answer is wanted on almost no runs. Record it when a
 * change is about to be reviewed:
 *
 *   yarn test:cases
 *
 * The index lands beside the snapshot as `<coverage file>.cases.json`, and
 * `variance covering` reads it back.
 *
 * Add `continuations: true` here when hunting a test whose work outlives it.
 * Each case then gets an async context, and the run names the cases that
 * crossed a region after they had settled. It costs 4.7 nanoseconds a crossing
 * over the variable, which on a real suite lands inside the noise: over zod the
 * crossing count predicts 0.2%, and ten interleaved repetitions do not resolve
 * it.
 */
import { mergeConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { selection, suite } from '../vitest.config.mjs';

export default withTestSelection(
  mergeConfig(suite, {
    test: {
      // The browser arms are the only tests here that measure their own wall
      // clock, so a default budget fails them for being observed rather than
      // for being wrong — and `continuations: true` makes that worse whenever
      // it is on. Widened on this arm alone.
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  }),
  { ...selection, cases: true },
);
