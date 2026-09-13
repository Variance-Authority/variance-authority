/**
 * What this package needs to know about the run it is observing inside.
 *
 * Everything here is read from `TestInfo` when there is one, and `TestInfo` is
 * the reason the list is this short: five fields out of an interface with
 * dozens, four of which are configuration the caller states once. A suite that
 * drives Playwright from somewhere other than Playwright's runner — vitest,
 * node:test, a script — has all five and no `TestInfo` to put them in, and
 * demanding a fabricated one would be asking it to lie about its runner to use
 * a library that never needed the answer.
 *
 * The boundary is drawn at *acceptance* rather than at convenience. Promoting a
 * candidate to a baseline is the one thing in this package that must not happen
 * by default (ADR-0021), so it is a field the caller has to set rather than a
 * mode inferred from an absent runner.
 */

import type { TestInfo } from '@playwright/test';
import { relative, resolve, sep } from 'node:path';

/** The run an observation belongs to, independent of what is driving it. */
export interface VarianceRun {
  /**
   * Subject id for observations that do not name one.
   *
   * Under Playwright this is the test's title path, which is unique per test and
   * reads as a place rather than an address. A caller naming every observation
   * through `subjectId` does not need it.
   */
  readonly id?: string;

  /** Both partition the baseline: the same subject at 2x is a different image. */
  readonly colorScheme?: 'light' | 'dark';
  readonly deviceScaleFactor?: number;

  /** Where the page under observation is served, for journeys and heads. */
  readonly baseURL?: string;

  /**
   * The spec file this run is attributed to, relative to the project root.
   *
   * Test selection records which source a test covered, so the record is keyed
   * by the file that asked. A run that records no execution leaves it unset.
   */
  readonly owner?: string;

  /**
   * Whether this run may promote a candidate to a baseline.
   *
   * Under Playwright's runner this is `--update-snapshots=all|changed` and
   * nothing else — its `missing` default is the flag's *absence*, and treating
   * absence as approval writes a new baseline from the same unreviewed run that
   * reported it.
   */
  readonly accepting?: boolean;

  /** Set when the run has already failed, so a recorder can mark it. */
  readonly failed?: boolean;
}

/** Read a Playwright `TestInfo` as the run it describes. */
export function runOf(testInfo: TestInfo): VarianceRun {
  const scheme = testInfo.project.use.colorScheme;
  const flag = testInfo.config.updateSnapshots;
  const baseURL = testInfo.project.use.baseURL;
  return {
    id: testInfo.titlePath.slice(1).join('/'),
    colorScheme: scheme === 'dark' ? 'dark' : 'light',
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor ?? 1,
    ...(baseURL === undefined ? {} : { baseURL }),
    // Absent on a `TestInfo` the runner did not build — which is exactly the
    // shape a caller outside Playwright's runner hands over, and a run with no
    // spec file simply records no execution against one.
    ...(typeof testInfo.file === 'string'
      ? { owner: relative(resolve(process.cwd()), testInfo.file).split(sep).join('/') }
      : {}),
    accepting: flag === 'all' || flag === 'changed',
    failed: testInfo.status !== undefined && testInfo.status !== 'passed',
  };
}

/**
 * Accept either shape at the seam, so one entry point serves both runners.
 *
 * `TestInfo` is recognised by `titlePath`: a run descriptor is a small record
 * of options and has no reason to carry one.
 */
export function asRun(given: TestInfo | VarianceRun): VarianceRun {
  return 'titlePath' in given ? runOf(given as TestInfo) : (given as VarianceRun);
}
