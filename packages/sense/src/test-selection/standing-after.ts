/**
 * Where each test a run did not observe last ran, carried from the runs record
 * the run replaces (`commit-runs.ts`).
 *
 * A guess written here would be read back as a fact at every run after this
 * one. So where no record names the run's base, or a test has no place and the
 * record no `over`, the answer is absent until a run observes every test the
 * snapshot held, which needs no record. A worktree's first record is a copy of
 * the base's (see `seedTestCoverage`), so its first partial run carries the
 * base's `standing` forward, assumed entries included, and leaves it absent
 * when the base had no record to copy.
 */

import type { CommitRuns, RecordedTests, StandingEntry } from './commit-runs.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { installKey } from './kept-install.js';
import { landingsOf } from './landings.js';

/**
 * Where each test the snapshot held before this run last ran, this run's own
 * commit included, leaving out the tests `ran` observed, or `undefined` when
 * that is not known: only a `held` record naming `base`, the commit this run
 * was laid over, knows. Each landing is its own stand, so no stand's time is
 * another run's.
 */
export function standingAfter(
  prior: RecordedTests | undefined,
  held: CommitRuns | undefined,
  base: string | undefined,
  ran: readonly string[],
): CommitRuns['standing'] {
  // No snapshot under these probes: the run replaced it, and holds only its own.
  if (prior === undefined) return [];
  const observed = new Set(ran);
  const unobserved = prior.tests.map((test) => test.file).filter((test) => !observed.has(test));
  if (unobserved.length === 0) return [];
  if (base === undefined || held?.commit !== base) return undefined;
  const stands = new Map<string, StandingEntry>();
  const listed = new Map<string, string>();
  const partly = new Map<string, Set<string>>();
  const stand = (entry: StandingEntry, files: readonly string[], part: readonly string[] | undefined): void => {
    const at = standKey(entry);
    if (!stands.has(at)) stands.set(at, entry);
    for (const file of files) listed.set(file, at);
    for (const file of part ?? []) partly.set(at, (partly.get(at) ?? new Set()).add(file));
  };
  for (const entry of held.standing ?? []) {
    const { files, partly: part, ...rest } = entry;
    stand({ ...rest, files: [] }, files, part);
  }
  // Earliest landing first: the record's own order, then the start it names,
  // then its own landings, which landed after every other. That is not oldest
  // first when a run landed at a commit older than the one before it. A test
  // nothing lists stood at `over`, assumed, where `test:since` read it from.
  const start = held.over === undefined ? undefined : standKey({ commit: held.over, assumed: true });
  if (start !== undefined && !stands.has(start)) stands.set(start, { commit: held.over!, files: [], assumed: true });
  // A test a landing finished stood at `base`, with that landing's time, install
  // and texts. A seeded record's landings are its base's, as they are.
  for (const landing of landingsOf(held)) stand({ commit: base, files: [], ...ranOn(landing), ...landedOf(landing) }, landing.files, landing.partly);
  const grouped = new Map<string, string[]>();
  for (const test of unobserved) {
    const at = listed.get(test) ?? start;
    if (at === undefined) return undefined;
    grouped.set(at, [...(grouped.get(at) ?? []), test]);
  }
  // A stand that ran a file in part is kept while the file stands elsewhere
  // unfinished, so a reader can name both.
  const pending = new Set(unobserved);
  return [...stands].flatMap(([at, entry]) => {
    const files = [...new Set(grouped.get(at))].sort(codeUnitOrder);
    const part = [...(partly.get(at) ?? [])].filter((file) => pending.has(file)).sort(codeUnitOrder);
    if (files.length === 0 && part.length === 0) return [];
    return [{ ...entry, files, ...(part.length === 0 ? {} : { partly: part }) }];
  });
}

/**
 * A stand as one string: its commit, whether it was assumed there, the install
 * and texts it ran on, and when it landed. Those go with the tests, so a stand
 * is compared from what its tests ran on at every select, and two runs at one
 * commit are two stands: one run's time is never another's.
 */
export function standKey(stand: Pick<StandingEntry, 'commit' | 'assumed' | 'installed' | 'texts' | 'first' | 'latest'>): string {
  const installed = stand.installed === undefined ? '' : ` ${installKey(stand.installed)}`;
  const texts = stand.texts === undefined ? '' : ` texts ${installKey(stand.texts)}`;
  const landed = stand.first === undefined || stand.latest === undefined ? '' : ` landed ${stand.first} ${stand.latest}`;
  return `${stand.assumed === true ? 'assumed' : 'observed'} ${stand.commit}${installed}${texts}${landed}`;
}

/** The install and texts `of` holds, each where it holds one. */
export function ranOn(of: Pick<StandingEntry, 'installed' | 'texts'>): Pick<StandingEntry, 'installed' | 'texts'> {
  return { ...(of.installed === undefined ? {} : { installed: of.installed }), ...(of.texts === undefined ? {} : { texts: of.texts }) };
}

type Landed = Pick<StandingEntry, 'first' | 'latest' | 'runs'>;

/** The landing time `of` holds, or nothing when it holds no first and latest. */
export function landedOf(of: Landed): Landed {
  if (of.first === undefined || of.latest === undefined) return {};
  return { first: of.first, latest: of.latest, ...(of.runs === undefined ? {} : { runs: of.runs }) };
}
