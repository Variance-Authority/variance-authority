/**
 * Where each test last ran, and when, as the runs record beside a snapshot
 * says it (`commit-runs.ts`). Every reader of where a test stands places it
 * here: a selector reads the commit, `covering` the commit and the time.
 */

import type { CommitRuns, StandingEntry } from './commit-runs.js';
import type { KeptTexts } from './kept-texts.js';
import { landingsOf } from './landings.js';

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
  /**
   * The texts it ran over where they differ from `commit`'s, as the record
   * holds them (`CommitRuns.texts`). Absent when the record does not know.
   */
  readonly texts?: KeptTexts;
  /**
   * The later runs that ran it only in part, earliest first: its cases those
   * runs ran are theirs, and the rest are this place's. Absent when none did.
   */
  readonly partly?: readonly TestPlace[];
}

/**
 * Where each of `tests` last ran, as the runs beside the snapshot at `commit`
 * recorded it.
 *
 * A test a run at the snapshot's commit finished stands where that run's
 * landing puts it, with its time and texts. Any other stands where `standing`
 * lists it. A later run that ran it in part is named beside its place. Where the record does not say, the reading
 * falls back, and `assumed` is the sentence that says how: a test `standing`
 * lists as assumed is read from where an earlier record assumed it, a test the
 * record does not list is read from `over`, where the runs at the snapshot's
 * commit started, and with no record for this snapshot at all, from the
 * snapshot's commit. Runs recorded at another commit describe some other
 * snapshot and say nothing about this one.
 */
export function testPlaces({ commit, runs, tests }: { readonly commit: string; readonly runs: CommitRuns | undefined; readonly tests: readonly string[] }): {
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
  // Each landing and each stand is one place, so a reader that groups by place
  // groups the tests that ran together.
  const listed = new Map<string, TestPlace>();
  const parts = new Map<string, TestPlace[]>();
  const ids = new Map<TestPlace, number>();
  const place = (stand: Omit<StandingEntry, 'files'>, files: readonly string[]): void => {
    const its: TestPlace = stand.assumed === true
      ? { commit: stand.commit, assumed: true }
      : {
          commit: stand.commit,
          ...(stand.first === undefined || stand.latest === undefined ? {} : { first: stand.first, latest: stand.latest }),
          ...(stand.runs === undefined ? {} : { runs: stand.runs }),
          ...(stand.texts === undefined ? {} : { texts: stand.texts }),
        };
    ids.set(its, ids.size);
    for (const file of files) listed.set(file, its);
    for (const file of stand.partly ?? []) parts.set(file, [...(parts.get(file) ?? []), its]);
  };
  for (const entry of runs.standing ?? []) place(entry, entry.files);
  for (const landing of landingsOf(runs)) place({ ...landing, commit }, landing.files);
  // A test placed and run in part since is one place per pair, shared alike.
  const shared = new Map<TestPlace, Map<string, TestPlace>>();
  const withParts = (at: TestPlace, part: readonly TestPlace[] | undefined): TestPlace => {
    if (part === undefined) return at;
    const key = part.map((one) => ids.get(one)).join(' ');
    const those = shared.get(at) ?? new Map<string, TestPlace>();
    shared.set(at, those);
    const its = those.get(key) ?? { ...at, partly: part };
    those.set(key, its);
    return its;
  };
  const fallback: TestPlace = { commit: runs.over ?? commit, assumed: true };
  let unlisted = 0;
  const from = new Set<string>();
  for (const test of tests) {
    const stand = withParts(listed.get(test) ?? fallback, parts.get(test));
    places.set(test, stand);
    if (stand.assumed !== true) continue;
    unlisted += 1;
    from.add(stand.commit);
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
