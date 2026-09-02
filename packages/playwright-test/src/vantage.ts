/**
 * Telling a watching process what this run is doing.
 *
 * The signals are already here. A worker knows which test is running, which
 * realms have answered it, what opened and never closed, and how it ended; all
 * of that is spent settling waits and printing failures, and then the worker
 * moves on. This is the second reader — `@variance-authority/vantage` — and it
 * gets the same signals at the same moment, without collecting anything new.
 *
 * ## Why the lifecycle fixture is automatic and the announcements are not
 *
 * A suite watching itself wants **every** test in the listing, including the
 * ones that take no screenshot and destructure no fixture: a run where half the
 * tests are invisible is worse than one where none of them are, because the
 * gaps read as tests that never started. So `varianceWatched` is `auto` — and it
 * is affordable precisely because it is nothing at all when
 * {@link VANTAGE_VARIABLE} is unset, which is every run nobody is watching.
 *
 * Announcements ride the log a test already opened, because there is no log
 * without one. A test that never destructures `events` has no listener installed
 * and nothing to forward; it still appears, with nothing heard, which is the
 * true answer rather than a missing one.
 */

import type { Fixtures, PlaywrightTestArgs, PlaywrightWorkerArgs, TestInfo } from '@playwright/test';
import { openVantage, type TestState, type Vantage } from '@variance-authority/vantage';
import { ownerOf } from './execution.js';

export interface VarianceVantageWorkerFixtures {
  /**
   * Where this worker reports what it is doing, if anywhere.
   *
   * Undefined unless {@link VANTAGE_VARIABLE} names a watcher, which is the
   * whole of the configuration: a run nobody is watching pays one environment
   * read per worker and reports nothing.
   */
  readonly varianceVantage: Vantage | undefined;
}

export interface VarianceVantageFixtures {
  /**
   * This test, in a watcher's listing.
   *
   * Automatic, so a listing has no holes in it. Nothing to destructure and
   * nothing to call.
   */
  readonly varianceWatched: void;
}

export const varianceVantageFixtures: Fixtures<
  VarianceVantageFixtures,
  VarianceVantageWorkerFixtures,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  varianceVantage: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(openVantage());
    },
    { scope: 'worker' },
  ],

  varianceWatched: [
    async ({ varianceVantage }, use, testInfo) => {
      const file = ownerOf(process.cwd(), testInfo);
      varianceVantage?.opened(testInfo.testId, {
        title: titleOf(testInfo, file),
        file,
        ...(testInfo.project.name === '' ? {} : { project: testInfo.project.name }),
        worker: testInfo.workerIndex,
      });

      await use();

      // Teardown, so the status is the one the body ended on rather than the
      // one it started with. A retry arrives as a separate test id, which is
      // what a reader comparing two attempts needs it to be.
      const failure = testInfo.error?.message ?? testInfo.errors[0]?.message;
      varianceVantage?.closed(
        testInfo.testId,
        stateOf(testInfo.status),
        failure === undefined ? undefined : failure.split('\n').slice(0, 4).join('\n'),
      );
    },
    { auto: true },
  ],
};

/**
 * The whole title, describes included, joined the way the runner prints it.
 *
 * `titlePath` opens with the project and the spec file, both of which are
 * columns of their own in a listing and would only be repeated inside the title.
 * Dropped by what they are rather than by position, because how many entries
 * precede the first `describe` is the runner's business and has changed.
 */
function titleOf(testInfo: TestInfo, file: string): string {
  const named = leaf(file);
  const path = testInfo.titlePath.filter(
    (part) => part !== '' && part !== testInfo.project.name && leaf(part) !== named,
  );
  return path.length === 0 ? testInfo.title : path.join(' › ');
}

/**
 * The last segment of a path, whichever separator wrote it.
 *
 * The spec entry in `titlePath` is written relative to the runner's own root,
 * which is not always the directory this process is in, so the two spellings of
 * one file are compared by their leaf rather than by one containing the other.
 */
function leaf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** A test that is being torn down has ended, whatever the runner calls it. */
function stateOf(status: TestInfo['status']): TestState {
  return status === undefined ? 'interrupted' : status;
}
