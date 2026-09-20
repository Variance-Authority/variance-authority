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
 * It is a second arm rather than a flag on the first because the cost lands on
 * every run and the answer is wanted on almost none of them. Record it when a
 * change is about to be reviewed:
 *
 *   yarn test:cases
 *
 * The index lands beside the snapshot as `<coverage file>.cases.json`, and
 * `variance covering` reads it back.
 */
import { mergeConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { selection, suite } from '../vitest.config.mjs';

export default withTestSelection(
  mergeConfig(suite, {
    test: {
      // An async context per case adds about a third to the time inside a
      // compute-bound test, and the browser arms are the only tests here that
      // measure their own wall clock — so the default budgets fail them for
      // being observed rather than for being wrong. Widened on this arm alone.
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  }),
  { ...selection, cases: true },
);
