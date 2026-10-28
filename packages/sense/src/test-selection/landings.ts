/**
 * The runs at one commit, one landing each (`commit-runs.ts`).
 *
 * A test file's evidence is the rows and cases of the run that last finished
 * it, so where and when it ran, and over which texts, is that run's, and the
 * other runs at the same commit say nothing about it. A run finishes a file it
 * ran whole. A file it ran in part (`-t`, a filter, a skip) keeps the cases it
 * did not run (`layerCaseIndex`), so it stays where it stood, and the run lists
 * it as run in part, which a reader names beside that place.
 */

import type { CommitRuns, RecordedTests, StandingEntry } from './commit-runs.js';
import type { CoverageTest, TestCoverage } from './index.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { sameInstall, type KeptInstall } from './kept-install.js';
import type { KeptTexts } from './kept-texts.js';

/** One run at the record's commit, while a test file it finished has not been finished again there. */
export interface Landing extends Pick<StandingEntry, 'installed' | 'texts' | 'partly'> {
  /** The test files it finished, in code-unit order. */
  readonly files: readonly string[];
  /**
   * When it landed: one instant for a run, a span for a record that kept no
   * landings. Absent for a record seeded before landings, which was stamped
   * when it was seeded.
   */
  readonly first?: string;
  readonly latest?: string;
  /**
   * How many runs it is: one for a run, the count a record that kept no
   * landings held. A seed carries its base's landings as they are, so a seeded
   * record's are its base's runs. Absent where the record held none.
   */
  readonly runs?: number;
}

/** A run as the runs record reads it: the probes, the commit, and each test file with whether the run finished it. */
export type RanTests = Pick<TestCoverage, 'instrumentation' | 'commit'> & {
  readonly tests: readonly Pick<CoverageTest, 'file' | 'complete'>[];
};

/**
 * The files `current` observed, and the ones it ran only in part where the
 * snapshot `prior` already held them, each in code-unit order. A file the
 * snapshot did not hold has no other cases, so a run observes it either way;
 * with no snapshot, it observes every file it ran.
 */
export function observedBy(prior: RecordedTests | undefined, current: RanTests): { readonly observed: string[]; readonly partly: string[] } {
  const held = prior === undefined ? undefined : new Set(prior.tests.map((test) => test.file));
  const observed = new Set<string>();
  const partly = new Set<string>();
  for (const test of current.tests) {
    if (test.complete || held === undefined || !held.has(test.file)) observed.add(test.file);
    else partly.add(test.file);
  }
  for (const file of observed) partly.delete(file);
  return { observed: [...observed].sort(codeUnitOrder), partly: [...partly].sort(codeUnitOrder) };
}

/**
 * The landings `record` holds, earliest first; a record that kept none is one
 * landing of its own fields, which names no texts: a record written before
 * landings was written before texts were named. One with no runs of its own
 * was seeded then, and a seed stamped the moment of seeding, so its time is
 * not held.
 */
export function landingsOf(record: Pick<CommitRuns, 'files' | 'first' | 'latest' | 'runs' | 'installed' | 'landings'>): readonly Landing[] {
  if (Array.isArray(record.landings)) return record.landings;
  if (!Array.isArray(record.files) || record.files.length === 0) return [];
  return [{
    files: record.files,
    ...(record.runs > 0 ? { first: record.first, latest: record.latest, runs: record.runs } : {}),
    ...(record.installed === undefined ? {} : { installed: record.installed }),
  }];
}

/**
 * The landings once a run at `at` lands over `earlier`, the ones at its
 * commit: what it observed leaves every earlier landing, and one with nothing
 * left to answer for is gone.
 */
export function landingsAfter(
  earlier: readonly Landing[],
  { observed, partly }: ReturnType<typeof observedBy>,
  at: string,
  installed: KeptInstall | undefined,
  texts: KeptTexts | undefined,
): Landing[] {
  const seen = new Set(observed);
  const kept = earlier.flatMap((landing) => {
    const files = landing.files.filter((file) => !seen.has(file));
    const part = (landing.partly ?? []).filter((file) => !seen.has(file));
    if (files.length === 0 && part.length === 0) return [];
    const { partly: _part, ...rest } = landing;
    return [{ ...rest, files, ...(part.length === 0 ? {} : { partly: part }) }];
  });
  if (observed.length === 0 && partly.length === 0) return kept;
  return [...kept, {
    files: observed,
    ...(partly.length === 0 ? {} : { partly }),
    first: at,
    latest: at,
    runs: 1,
    ...(installed === undefined ? {} : { installed }),
    ...(texts === undefined ? {} : { texts }),
  }];
}

/**
 * What every landing that finished a file says of `of`, the install or the
 * texts, when they all say one thing; `undefined` when one does not know or
 * two differ, which a reader compares from the commit.
 */
export function agreed<Kept extends KeptInstall>(landings: readonly Landing[], of: (landing: Landing) => Kept | undefined): Kept | undefined {
  let kept: Kept | undefined;
  for (const landing of landings) {
    if (landing.files.length === 0) continue;
    const its = of(landing);
    if (its === undefined || (kept !== undefined && !sameInstall(kept, its))) return undefined;
    kept = its;
  }
  return kept;
}
