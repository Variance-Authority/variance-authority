/**
 * Where each test last ran, and when, as the runs record beside a snapshot
 * says it (`commit-runs.ts`). Every reader of where a test stands places it
 * here: a selector reads the commit, `covering` the commit and the time.
 */

import type { CommitRuns } from './commit-runs.js';

/** Where one test last ran. */
export interface TestPlace {
  /** The commit it last ran at, or the one read instead with `assumed`. */
  readonly commit: string;
  /** The record could not say where it ran, and `commit` is the fallback. */
  readonly assumed?: true;
  /**
   * When the runs it last ran in landed, and how many there were, as the
   * record holds it. Absent when it does not: an assumed place, a stand
   * written before stands carried their time, and the run count of a seeded
   * record, whose runs are its base's.
   */
  readonly first?: string;
  readonly latest?: string;
  readonly runs?: number;
}

/**
 * Where each of `tests` last ran, as the runs beside the snapshot at `commit`
 * recorded it.
 *
 * A test the runs at the snapshot's commit observed stands there. Any other
 * stands where `standing` lists it. Where the record does not say, the reading
 * falls back, and `assumed` is the sentence that says how: a test `standing`
 * lists as assumed is read from where an earlier record assumed it, a test the
 * record does not list is read from `over`, where the runs at the snapshot's
 * commit started, and with no record for this snapshot at all, from the
 * snapshot's commit. Runs recorded at another commit describe some other
 * snapshot and say nothing about this one.
 */
export function placesOf({ commit, runs, tests }: { readonly commit: string; readonly runs: CommitRuns | undefined; readonly tests: readonly string[] }): {
  readonly places: Map<string, TestPlace>;
  readonly assumed: string | undefined;
} {
  const fallen: TestPlace = { commit, assumed: true };
  const places = new Map(tests.map((test) => [test, fallen]));
  const at = commit.slice(0, 12);
  const everyTest = `so every test is read as though it last ran at ${at}`;
  if (runs === undefined) return { places, assumed: tests.length === 0 ? undefined : `no runs record lies beside the snapshot, ${everyTest}` };
  if (runs.commit !== commit) {
    const whose = runs.commit === undefined ? 'a run outside a checkout' : `${runs.commit.slice(0, 12)}'s`;
    return { places, assumed: tests.length === 0 ? undefined : `the runs record beside the snapshot is ${whose}, not ${at}'s, ${everyTest}` };
  }
  const ran = new Set(runs.files);
  const here: TestPlace = { commit, first: runs.first, latest: runs.latest, ...(runs.runs > 0 ? { runs: runs.runs } : {}) };
  const listed = new Map<string, TestPlace>();
  for (const entry of runs.standing ?? []) {
    const place: TestPlace = entry.assumed === true
      ? { commit: entry.commit, assumed: true }
      : { commit: entry.commit, ...(entry.first === undefined || entry.latest === undefined ? {} : { first: entry.first, latest: entry.latest }), ...(entry.runs === undefined ? {} : { runs: entry.runs }) };
    for (const file of entry.files) listed.set(file, place);
  }
  const fallback: TestPlace = { commit: runs.over ?? commit, assumed: true };
  let unlisted = 0;
  const from = new Set<string>();
  for (const test of tests) {
    if (ran.has(test)) {
      places.set(test, here);
      continue;
    }
    const place = listed.get(test) ?? fallback;
    places.set(test, place);
    if (place.assumed !== true) continue;
    unlisted += 1;
    from.add(place.commit);
  }
  if (unlisted === 0) return { places, assumed: undefined };
  const where =
    from.size === 1 && runs.over === undefined && from.has(commit)
      ? `${at}, where the snapshot was recorded`
      : from.size === 1 && runs.over !== undefined && from.has(runs.over)
        ? `${runs.over.slice(0, 12)}, where its runs started`
        : `the commits they were assumed at, ${[...from].map((stand) => stand.slice(0, 12)).join(', ')}`;
  return { places, assumed: `the runs record beside the snapshot does not say where ${unlisted} test(s) last ran, so they are read from ${where}` };
}
