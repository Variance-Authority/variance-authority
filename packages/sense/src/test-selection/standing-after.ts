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

/**
 * Where each test the snapshot held before this run last ran, leaving out the
 * tests `ran` observed, or `undefined` when that is not known.
 *
 * `base` is the commit this run was laid over. Only a `held` record naming it
 * knows: a test in its `files` stood there, with the record's landing time,
 * install and texts; a test its `standing` lists stood where it says; any other
 * stood at its `over`, assumed, where `test:since` read it from, and stays
 * there when a later run moves `over`. A test this run did not observe is
 * listed where it last ran, this run's own commit included.
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
  for (const entry of held.standing ?? []) {
    const at = standKey(entry);
    stands.set(at, { commit: entry.commit, files: [], ...(entry.assumed ? { assumed: true } : {}), ...ranOn(entry), ...landedOf(entry) });
    for (const file of entry.files) listed.set(file, at);
  }
  // Earliest landing first: the record's own order, then the start it names,
  // then its own commit, which landed after every other. That is not oldest
  // first when a run landed at a commit older than the one before it.
  const start = held.over === undefined ? undefined : standKey({ commit: held.over, assumed: true });
  if (start !== undefined && !stands.has(start)) stands.set(start, { commit: held.over!, files: [], assumed: true });
  const ranAt = standKey({ commit: base, ...ranOn(held) });
  const ranThere = new Set(held.files);
  // A seeded record's runs are the base's, so it counts none as its own. Met in
  // a stand `standing` lists, the two times span; one not known, neither is.
  const own = landedOf(held.runs === 0 ? { first: held.first, latest: held.latest } : held);
  const there = stands.get(ranAt);
  if (there === undefined) {
    stands.set(ranAt, { commit: base, files: [], ...ranOn(held), ...own });
  } else if (unobserved.some((test) => ranThere.has(test))) {
    const { commit, files, assumed } = there;
    stands.set(ranAt, { commit, files, ...(assumed ? { assumed } : {}), ...ranOn(there), ...spanned(there, own) });
  }
  const grouped = new Map<string, string[]>();
  for (const test of unobserved) {
    const at = ranThere.has(test) ? ranAt : (listed.get(test) ?? start);
    if (at === undefined) return undefined;
    grouped.set(at, [...(grouped.get(at) ?? []), test]);
  }
  return [...stands]
    .filter(([at]) => grouped.has(at))
    .map(([at, stand]) => ({ ...stand, files: [...new Set(grouped.get(at))].sort(codeUnitOrder) }));
}

/**
 * A stand as one string: its commit, whether it was assumed there, and the
 * install and texts it ran on. Those go with the tests, so a stand is compared
 * from what its tests ran on at every select, and two runs at one commit over
 * two of them are two stands.
 */
export function standKey(stand: Pick<StandingEntry, 'commit' | 'assumed' | 'installed' | 'texts'>): string {
  const installed = stand.installed === undefined ? '' : ` ${installKey(stand.installed)}`;
  const texts = stand.texts === undefined ? '' : ` texts ${installKey(stand.texts)}`;
  return `${stand.assumed === true ? 'assumed' : 'observed'} ${stand.commit}${installed}${texts}`;
}

/** The install and texts `of` holds, each where it holds one. */
function ranOn(of: Pick<StandingEntry, 'installed' | 'texts'>): Pick<StandingEntry, 'installed' | 'texts'> {
  return { ...(of.installed === undefined ? {} : { installed: of.installed }), ...(of.texts === undefined ? {} : { texts: of.texts }) };
}

type Landed = Pick<StandingEntry, 'first' | 'latest' | 'runs'>;

/** The landing time `of` holds, or nothing when it holds no first and latest. */
export function landedOf(of: Landed): Landed {
  if (of.first === undefined || of.latest === undefined) return {};
  return { first: of.first, latest: of.latest, ...(of.runs === undefined ? {} : { runs: of.runs }) };
}

/** One stand's time once the runs of two land in it: from the earlier first to the later latest. */
export function spanned(one: Landed, other: Landed): Landed {
  if (one.first === undefined || one.latest === undefined || other.first === undefined || other.latest === undefined) return {};
  const runs = one.runs === undefined || other.runs === undefined ? {} : { runs: one.runs + other.runs };
  return {
    first: one.first < other.first ? one.first : other.first,
    latest: one.latest > other.latest ? one.latest : other.latest,
    ...runs,
  };
}
