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
 *
 * ## The two calls a test author writes
 *
 * {@link VarianceDesk.snapshot} and {@link VarianceDesk.observe} are
 * `console.log` and `debugger;` for something that is not a person: send what is
 * here now, or send it and stand still until an agent that has looked around
 * says go on. They are named for what a test author is doing, and they owe the
 * vocabulary inside this project nothing — the only thing that crosses is where
 * the call sits and what it said.
 *
 * ## Where they can be called from, and where they cannot
 *
 * Anywhere the test is transitively awaiting: the test body, a helper it awaits,
 * a `page.route` handler it awaits. A frame nobody awaits — an effect, a render
 * body — has no await point to stop at, so `observe` there sends its note and
 * the execution carries on past it. That is the rule, and it is not the runner's
 * business: it is what `await` means.
 *
 * Two callers are deliberately not here yet, and are marked rather than assumed:
 *
 * - **From inside the page.** Not `fetch` from page origin — wire's listener
 *   answers JSON with no `access-control-allow-origin`, so the response would be
 *   blocked and the page would see a network error rather than a release. The
 *   route is `page.exposeFunction`, which returns a promise the page can await
 *   and is already how the page reports.
 * - **From a service.** A service under test is another participant with an
 *   execution id, so the mechanism fits unchanged; what it needs is a package
 *   named for who it serves, which is a decision about the install and not about
 *   this file.
 *
 * Both are additions to the same two calls in another place, not changes to
 * them.
 *
 * Both are inert when nobody is watching, which is what makes them committable.
 * A left-behind `debugger;` or `.only` changes what CI does; a left-behind
 * `await variance.observe()` costs one already-read environment variable and
 * returns. That is the property the feature is for: the call can stay in the
 * spec that needed it, and the next person to need it does not have to write it
 * again.
 */

import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fixtures, PlaywrightTestArgs, PlaywrightWorkerArgs, TestInfo } from '@playwright/test';
import {
  openVantage,
  type TestState,
  type Vantage,
  type Waited,
  type WaitOptions,
} from '@variance-authority/vantage';
import { ownerOf } from './execution.js';

/** What a test author calls to be seen. */
export interface VarianceDesk {
  /**
   * Send what is here now, and keep going.
   *
   * `note` is for the reader, not the machine: whatever would have gone in the
   * `console.log` this replaces.
   */
  readonly snapshot: (note?: string) => void;
  /**
   * Send it, and stand here until something that has looked around says go on.
   *
   * Answers how the standing ended rather than throwing, because none of the
   * three endings is a test failure — a suite nobody is watching is the ordinary
   * case, and so is an agent that wandered off.
   */
  readonly observe: (note?: string, options?: WaitOptions) => Promise<Waited>;
}

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

export interface DeskOptions {
  /**
   * Hold the runner's clock while the test stands still.
   *
   * Called when a wait begins; what it answers is called when the wait ends. A
   * test stopped for somebody to look at it is not a slow test, and a runner
   * that killed it at thirty seconds would turn the one feature whose whole
   * purpose is to hold a page still into a timeout with no explanation in it.
   *
   * Optional, and absent everywhere but under a runner that has a clock.
   */
  readonly reprieve?: () => () => void;
}

/**
 * The two calls, bound to one test.
 *
 * Exported so the callable fixture a suite already destructures can carry them,
 * rather than adding a second thing to destructure for the two lines a test
 * author writes when they want to be looked at.
 */
export function varianceDesk(
  vantage: Vantage | undefined,
  test: string,
  options: DeskOptions = {},
): VarianceDesk {
  return {
    snapshot: (note) => vantage?.noted(test, siteOf(), note ?? ''),
    observe: async (note, waiting) => {
      // Before the stack is read, not after. The unwatched path is the one every
      // committed call takes in CI, and it should cost an already-read variable
      // rather than a thrown error per call.
      if (vantage === undefined) return 'unwatched';
      const at = siteOf();
      if (note !== undefined) vantage.noted(test, at, note);
      const restore = options.reprieve?.();
      try {
        return await vantage.waits(test, at, waiting);
      } finally {
        restore?.();
      }
    },
  };
}

/**
 * Stop the runner's clock for as long as the test stands still.
 *
 * Hands the time back rather than resetting the budget: a test released after
 * two minutes should have exactly the remaining time it had before somebody
 * looked at it. Playwright counts elapsed time against whatever the timeout is
 * set to, so `was + elapsed` is the spelling that restores it.
 *
 * Here rather than in the fixture because it is the runner half of
 * {@link DeskOptions.reprieve}, and the desk is the thing that knows when a
 * wait begins and ends.
 */
export function runnerReprieve(testInfo: TestInfo): () => void {
  const was = testInfo.timeout;
  const from = Date.now();
  testInfo.setTimeout(0);
  return () => testInfo.setTimeout(was + (Date.now() - from));
}

/**
 * Where in the spec the call sits, for a reader who has the file open.
 *
 * Read from a thrown stack rather than passed in, because the useful answer is a
 * line number and asking an author to type their own line number is asking them
 * to keep it correct. The first frame that is not this file is the caller,
 * whether that is the test body or something the test is awaiting.
 */
function siteOf(): string {
  const here = fileURLToPath(import.meta.url);
  for (const frame of (new Error().stack ?? '').split('\n').slice(1)) {
    const found = /\(?((?:\/|[A-Za-z]:\\|file:)[^()]*?)(:\d+:\d+)\)?\s*$/.exec(frame.trim());
    if (found === null) continue;
    const [, where = '', line = ''] = found;
    // Compared against this module's own path rather than a name fragment,
    // because a fragment matches the file that tests this one too, and the
    // answer would then be whatever called *that*.
    const file = where.startsWith('file:') ? fileURLToPath(where) : where;
    if (file.startsWith(here)) continue;
    const root = `${process.cwd()}${sep}`;
    return `${file.startsWith(root) ? file.slice(root.length) : file}${line}`;
  }
  return 'somewhere in the spec';
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
