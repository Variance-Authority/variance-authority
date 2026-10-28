/**
 * The runs at one commit, one landing each (`commit-runs.ts`).
 *
 * A test file's evidence is the rows and cases of the run that last finished
 * it, so where and when it ran, and over which texts, is that run's, and the
 * other runs at the same commit say nothing about it. A run finishes a file it
 * ran whole. A file it ran in part (`-t`, a filter, a skip) keeps the cases it
 * did not run (`layerCaseIndex`), so it stays where it stood, and the run lists
 * it as run in part, with the cases it laid into the case index of it, so a
 * reader dates each case by the run that laid its rows. A run that kept no
 * cases laid none, and says so: the file's rows are both runs', its cases the
 * earlier one's. A run that kept cases and executed no case of a file did not
 * observe that file at all.
 */

// compass: variance-authority.reach

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { RecordedTests, StandingEntry } from './commit-runs.js';
import type { CoverageTest, TestCoverage } from './index.js';
import { sameInstall, type KeptInstall } from './kept-install.js';
import type { KeptTexts } from './kept-texts.js';

/** One run at the record's commit, while a test file it finished has not been finished again there. */
export interface Landing extends Pick<StandingEntry, 'installed' | 'texts' | 'partly' | 'cases'> {
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
  /**
   * The cases of each test file it laid into the case index, by the id the
   * index names them by (`casesRan`): the ones it executed, so a file it
   * executed none of has none. `none` when it kept no cases, so it laid none of
   * any file's. Absent when its index cannot name them, so which it laid is not
   * known.
   */
  readonly laid?: ReadonlyMap<string, readonly string[]> | 'none';
};

/** What a run observed: the files it finished, and the ones it ran in part with the cases it laid of them. */
export interface Observed extends Pick<Landing, 'cases'> {
  readonly observed: string[];
  readonly partly: string[];
}

/**
 * The files `current` observed, and the ones it ran only in part where the
 * snapshot `prior` already held them, each in code-unit order, with the cases
 * it laid of those where it can name them: none, when it kept no cases. A run
 * that kept cases did not observe a file the snapshot held that it executed no
 * case of. A file the snapshot did not hold has no other cases, so a run
 * observes it either way; with no snapshot, it observes every file it ran.
 */
export function observedBy(prior: RecordedTests | undefined, current: RanTests): Observed {
  const held = prior === undefined ? undefined : new Set(prior.tests.map((test) => test.file));
  const { laid } = current;
  const observed = new Set<string>();
  const partly = new Set<string>();
  for (const test of current.tests) {
    if (test.complete || held === undefined || !held.has(test.file)) observed.add(test.file);
    else if (laid === undefined || laid === 'none' || (laid.get(test.file)?.length ?? 0) > 0) partly.add(test.file);
  }
  for (const file of observed) partly.delete(file);
  const part = [...partly].sort(codeUnitOrder);
  return {
    observed: [...observed].sort(codeUnitOrder),
    partly: part,
    ...(laid === undefined || part.length === 0 ? {} : { cases: Object.fromEntries(part.map((file) => [file, laid === 'none' ? [] : laid.get(file)!])) }),
  };
}

/**
 * The files of `of`'s `partly` that `keep` keeps, with the cases it names of
 * them, or nothing when none is left.
 */
export function partlyIn(of: Pick<Landing, 'partly' | 'cases'>, keep: (file: string) => boolean): Pick<Landing, 'partly' | 'cases'> {
  const partly = (of.partly ?? []).filter(keep);
  if (partly.length === 0) return {};
  const cases = of.cases;
  return { partly, ...(cases === undefined ? {} : { cases: Object.fromEntries(partly.flatMap((file) => (cases[file] === undefined ? [] : [[file, cases[file]]]))) }) };
}

/**
 * The landings once a run at `at` lands over `earlier`, the ones at its
 * commit: what it observed leaves every earlier landing, and one with nothing
 * left to answer for is gone.
 */
export function landingsAfter(
  earlier: readonly Landing[],
  { observed, ...ranPart }: Observed,
  at: string,
  installed: KeptInstall | undefined,
  texts: KeptTexts | undefined,
): Landing[] {
  const seen = new Set(observed);
  const unseen = (file: string): boolean => !seen.has(file);
  const kept = earlier.flatMap((landing) => {
    const files = landing.files.filter(unseen);
    const part = partlyIn(landing, unseen);
    if (files.length === 0 && part.partly === undefined) return [];
    const { partly: _part, cases: _cases, ...rest } = landing;
    return [{ ...rest, files, ...part }];
  });
  const part = partlyIn(ranPart, () => true);
  if (observed.length === 0 && part.partly === undefined) return kept;
  return [...kept, {
    files: observed,
    ...part,
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

/** What the landings at one commit say together: the files they finished, and the install they agree on. */
export interface WhatLanded {
  /** Every test file a landing finished, in code-unit order. */
  readonly files: readonly string[];
  /** The install every landing that finished a file names, when they all name one (`agreed`). */
  readonly installed?: KeptInstall;
}

/** What `landings` say together, read off them rather than stored beside them. */
export function whatLanded(landings: readonly Landing[]): WhatLanded {
  const files = [...new Set(landings.flatMap((landing) => landing.files))].sort(codeUnitOrder);
  const installed = agreed(landings, (landing) => landing.installed);
  return { files, ...(installed === undefined ? {} : { installed }) };
}
