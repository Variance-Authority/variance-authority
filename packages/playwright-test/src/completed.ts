/**
 * The runner's verdict, handed to the recorder once per test.
 *
 * Held apart from the accumulation because it arrives from somewhere else. A
 * worker's crossings come from the page, through whichever fixture the spec
 * happened to destructure; whether the spec finished is the runner's to say,
 * and it has to be said for every test — including the ones that destructured
 * nothing from this package at all.
 */

import type {
  Fixtures,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs,
  TestInfo,
} from '@playwright/test';
import type { ExecutionRecorder } from './execution.js';

/** The worker fixture the recorder lives on, for the halves that report to it. */
export interface RecorderFixture {
  readonly varianceRecorder: ExecutionRecorder | undefined;
}

export interface VarianceCompletedFixtures {
  /**
   * Nothing a test reads. It is here to be torn down.
   *
   * A spec that ends early has executed some of what it would have executed,
   * and the difference is invisible from inside: the crossings it never reached
   * look exactly like crossings it does not need. So the runner's verdict is
   * the only thing that can retire the file's claim, and it has to arrive for
   * every test — including the ones that destructured nothing from this
   * package.
   */
  readonly varianceCompleted: void;
}

/**
 * Hand the runner's verdict to the recorder, once per test.
 *
 * `auto`, for the same reason `varianceWatched` is: a spec records through
 * whichever fixture suits it — `variance` for a subtree it compares, `events`
 * for a service that answers for itself, both, or neither at all while a head
 * reports against the file — so a verdict read in any one of those teardowns is
 * a verdict the other routes never produce. What a missing verdict costs is not
 * a lost run: the spec is written with the reach it managed before it died, and
 * a record that says whole is believed, so every region past the failure is
 * excluded from each later `--since` that touches it. That is the skip nobody
 * asked for, and it is the one {@link ExecutionRecorder.mark} exists to refuse.
 *
 * It costs a setup and a teardown per test and nothing else: the recorder is
 * the worker's, `mark` is a set insertion, and a run with recording off has no
 * recorder to tell.
 */
export const varianceCompletedFixtures: Fixtures<
  VarianceCompletedFixtures,
  RecorderFixture,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  varianceCompleted: [
    async ({ varianceRecorder }, use, testInfo) => {
      await use();
      // After `use`, which is where the runner has already decided this test.
      // Automatic fixtures are set up before the ones a test asked for, so this
      // is torn down after them and reads the status they have already settled.
      if (varianceRecorder === undefined) return;
      varianceRecorder.mark(varianceRecorder.owner(testInfo), usableOutcome(testInfo.status));
    },
    { auto: true },
  ],
};

/**
 * Whether one test's outcome leaves the file's claim standing.
 *
 * A skip is not a gap, for the reason `usableOutcome` in
 * `@variance-authority/sense` gives at length: a test that did not run entered
 * nothing, and every way it stops being skipped edits either the spec file —
 * a digest-checked precondition of the record — or a module the collection
 * already entered. A skip decided outside the source, by an environment
 * variable or a platform check, is the boundary every diff-based selector has
 * and the configuration's business rather than the diff's.
 *
 * `failed`, `timedOut` and `interrupted` are a different thing and each spoils
 * the file: a test that stopped early recorded only as far as it got, so the
 * file undercounts its own reach and the undercount is invisible. An expected
 * failure spoils it too, and deliberately — `test.fail()` means the body
 * throws on purpose, which is still a body that stopped part-way.
 */
function usableOutcome(status: TestInfo['status']): boolean {
  return status === 'passed' || status === 'skipped';
}
