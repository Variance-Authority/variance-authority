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
import type { Viewport } from '@variance-authority/core/format';
import { testBaselineKey, type BaselineKey } from '@variance-authority/raster';

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
   * The titles the test was declared under and its own, outermost first: the
   * `describe` blocks, then the test.
   *
   * `id` is the same titles joined with `/`, which is a fine address and a
   * lossy one — a title that contains a slash comes back as two. A baseline's
   * path names the test by its titles, so they are carried apart. Absent on a
   * descriptor, whose `id` is then read as the titles.
   */
  readonly titlePath?: readonly string[];

  /**
   * The Playwright project that ran the test, by its `name`.
   *
   * Two projects run one test as one subject, and when they differ only in
   * what a baseline's identity does not hold — a colour scheme, a viewport,
   * a scale factor — they paint two images for one path. `{project}` in the
   * baseline path files them apart. Absent for an unnamed project. Not
   * `project`, which is how {@link asRun} tells a `TestInfo` from this.
   */
  readonly projectName?: string;

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
  const projectName = testInfo.project.name;
  return {
    id: testInfo.titlePath.slice(1).join('/'),
    colorScheme: scheme === 'dark' ? 'dark' : 'light',
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor ?? 1,
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(typeof projectName === 'string' && projectName !== '' ? { projectName } : {}),
    // Absent on a `TestInfo` the runner did not build — which is exactly the
    // shape a caller outside Playwright's runner hands over, and a run with no
    // spec file simply records no execution against one.
    ...(typeof testInfo.file === 'string'
      ? { owner: relative(resolve(process.cwd()), testInfo.file).split(sep).join('/') }
      : {}),
    // The first entry is the spec file, which `owner` already carries.
    titlePath: testInfo.titlePath.slice(1),
    accepting: flag === 'all' || flag === 'changed',
    failed: testInfo.status !== undefined && testInfo.status !== 'passed',
  };
}

/**
 * Accept either shape at the seam, so one entry point serves both runners.
 *
 * `TestInfo` is recognised by `project`, the configuration it reads options
 * from: a run descriptor carries those options itself and has no project.
 * `titlePath` is no test, because a descriptor carries one too.
 */
export function asRun(given: TestInfo | VarianceRun): VarianceRun {
  return 'project' in given ? runOf(given as TestInfo) : (given as VarianceRun);
}

/**
 * The subject id a run supplies when an observation does not name one.
 *
 * Refused rather than defaulted: an id is the coordinate a baseline is stored
 * at, and inventing one from a counter or a timestamp would give the same
 * subject a different address on every run.
 */
export function subjectFromRun(run: VarianceRun): string {
  if (run.id === undefined || run.id === '') {
    throw new Error(
      'variance needs a subject id and this run has none; ' +
        'pass `subjectId` on the observation, or `id` on the run descriptor',
    );
  }
  return run.id;
}

/**
 * The key a baseline is stored under: the subject, the spec file that observed
 * it, and the titles that named it.
 *
 * The file and the titles are what a baseline's path is written from
 * (`baselines.path`), so a reviewer reading the pull request sees which test
 * painted each image, and a collocated template can put it beside the spec.
 * The subject decides *which* baseline it is, and so does the project when the
 * template places by `{project}`; the rest decide only where it is filed.
 *
 * An observation the test named with `subjectId` carries the file and nothing
 * else. One test may name several, and each has to land on its own path: the
 * test's titles are the same for all of them, so the id is what the path is
 * written from.
 */
export function baselineKeyOf(
  run: VarianceRun,
  subject: string,
  options: { readonly named?: boolean } = {},
): BaselineKey {
  return testBaselineKey(subject, {
    ...(run.owner === undefined ? {} : { file: run.owner }),
    ...(run.projectName === undefined ? {} : { project: run.projectName }),
    ...(options.named === true || run.titlePath === undefined ? {} : { titles: run.titlePath }),
  });
}

export function viewportOf(
  size: { width: number; height: number } | null,
  run: VarianceRun,
): Viewport {
  if (size === null) {
    throw new Error(
      'variance needs a viewport and this page has none; ' +
        'a null viewport means the image has no declared size, so no two runs are comparable',
    );
  }

  return {
    ...size,
    deviceScaleFactor: run.deviceScaleFactor ?? 1,
    colorScheme: run.colorScheme === 'dark' ? 'dark' : 'light',
  };
}
