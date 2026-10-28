/**
 * Where each test a run did not observe last ran, carried from the runs record
 * the run replaces (`commit-runs.ts`).
 */

import type { CommitRuns, RecordedTests, StandingEntry } from './commit-runs.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { installKey } from './kept-install.js';

/**
 * Where each test the snapshot held before this run last ran, leaving out the
 * tests `ran` observed, or `undefined` when that is not known.
 *
 * `base` is the commit this run was laid over: the snapshot's own, or on a
 * retried landing the one its record still names. Only the record `held`
 * knows, and only when it names `base`: a test in its `files` stood there, and
 * a test its `standing` lists stood where it says. A test it cannot place is
 * listed at its `over`, marked assumed, which is where `test:since` read it
 * from while that record was the latest; carried, the assumption stays there
 * when a later run moves `over`. No record, a record of another commit, and a
 * test with no place and no `over` are not known, and a guess written here
 * would be read back as a fact at every run after this one. So the answer is
 * absent until a run observes every test the snapshot held, which needs no
 * record at all.
 *
 * A test is listed at the commit this run is at when it last ran there and
 * this run did not observe it, as a run landed at an older commit leaves it: a
 * test the record does not list is one nobody knows about.
 *
 * The tests in `held`'s `files` take its landing time with them: when its runs
 * landed, and how many there were (none in a seeded record, whose runs are the
 * base's), and the install and texts they ran on. An entry `held` already
 * lists keeps its own. Where the two meet in one stand, the stand spans both;
 * where either time is not known, neither is.
 *
 * A worktree's first run is laid over a copy of the primary checkout's
 * snapshot, and the record beside it was seeded with that copy: the base's own
 * record, with no run of this checkout's in it (see `seedTestCoverage`). So a
 * worktree's first partial run carries the base's `standing` forward, assumed
 * entries included, and leaves it absent when the base had no record to copy.
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
