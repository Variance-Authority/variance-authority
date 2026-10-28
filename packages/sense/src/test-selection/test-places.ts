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
  /**
   * The commit it last ran at, or the one read instead with `assumed`. Absent
   * for a run outside a checkout, which only a snapshot naming no commit holds.
   */
  readonly commit?: string;
  /** The record could not say where it ran, and `commit` is the fallback. */
  readonly assumed?: true;
  /**
   * When the runs it last ran in landed, and how many there were, as the
   * record holds it; a seeded record holds its base's landings as they are.
   * Absent when it does not: an assumed place, a stand written before stands
   * carried their time, and a record seeded before landings were kept.
   */
  readonly first?: string;
  readonly latest?: string;
  readonly runs?: number;
  /**
   * The texts it ran over where they differ from `commit`'s, as the record
   * holds them (`StandingEntry.texts`). Absent when the record does not know.
   */
  readonly texts?: KeptTexts;
  /**
   * The later runs that ran it only in part, earliest first: its cases those
   * runs ran are theirs, and the rest are this place's. Absent when none did.
   */
  readonly partly?: readonly TestPlace[];
  /**
   * Of a place in `partly`: the cases it ran of each test file it ran in part,
   * as the record names them (`StandingEntry.cases`). Absent when the record
   * does not say which, so which of a file's cases are this place's is not known.
   */
  readonly cases?: StandingEntry['cases'];
}

/** The tests to place, under the snapshot at `commit` and the runs record beside it. */
interface TestsAt<Commit extends string | undefined> {
  readonly commit: Commit;
  readonly runs: CommitRuns | undefined;
  readonly tests: readonly string[];
}

/** Each test's place, and, in the runs record's words, how the reading fell back where it could not say. */
interface Places<Place extends TestPlace> {
  readonly places: Map<string, Place>;
  readonly assumed: string | undefined;
}

/** A place under a snapshot at `Commit`: under one that names a commit, every place names one. */
type PlaceUnder<Commit extends string | undefined> = Commit extends string ? TestPlace & { readonly commit: string } : TestPlace;

/**
 * Where each of `tests` last ran, as the runs beside the snapshot at `commit`
 * recorded it: where the run that last finished it landed, with that landing's
 * time and texts, and the later runs that ran it in part. Where the record does
 * not say, `assumed` says what was read instead.
 */
export function testPlaces<Commit extends string | undefined>(of: TestsAt<Commit>): Places<PlaceUnder<Commit>> {
  // Each fallback, landing and stand takes `commit` when the snapshot names one.
  return placesOf(of) as Places<PlaceUnder<Commit>>;
}

function placesOf({ commit, runs, tests }: TestsAt<string | undefined>): Places<TestPlace> {
  const fallen: TestPlace = { ...(commit === undefined ? {} : { commit }), assumed: true };
  const places = new Map(tests.map((test) => [test, fallen]));
  const at = commit?.slice(0, 12);
  const everyTest = `so every test is read as though it last ran ${at === undefined ? 'where the snapshot was recorded' : `at ${at}`}`;
  if (runs === undefined) return { places, assumed: tests.length === 0 ? undefined : `no runs record lies beside the snapshot, ${everyTest}` };
  // Runs recorded at another commit describe some other snapshot and say nothing of this one.
  if (runs.commit !== commit) {
    const whose = runs.commit === undefined ? 'a run outside a checkout' : `${runs.commit.slice(0, 12)}'s`;
    const not = at === undefined ? 'and the snapshot names no commit' : `not ${at}'s`;
    return { places, assumed: tests.length === 0 ? undefined : `the runs record beside the snapshot is ${whose}, ${not}, ${everyTest}` };
  }
  // Each landing and each stand is one place, so a reader that groups by place
  // groups the tests that ran together.
  const listed = new Map<string, TestPlace>();
  const parts = new Map<string, TestPlace[]>();
  const ids = new Map<TestPlace, number>();
  const place = (stand: Omit<StandingEntry, 'files' | 'commit'> & Pick<TestPlace, 'commit'>, files: readonly string[]): void => {
    const where = stand.commit === undefined ? {} : { commit: stand.commit };
    // A stand an earlier record assumed is read from where it assumed it.
    const its: TestPlace = stand.assumed === true
      ? { ...where, assumed: true }
      : {
          ...where,
          ...(stand.first === undefined || stand.latest === undefined ? {} : { first: stand.first, latest: stand.latest }),
          ...(stand.runs === undefined ? {} : { runs: stand.runs }),
          ...(stand.texts === undefined ? {} : { texts: stand.texts }),
          ...(stand.cases === undefined ? {} : { cases: stand.cases }),
        };
    ids.set(its, ids.size);
    for (const file of files) listed.set(file, its);
    for (const file of stand.partly ?? []) parts.set(file, [...(parts.get(file) ?? []), its]);
  };
  for (const entry of runs.standing ?? []) place(entry, entry.files);
  for (const landing of landingsOf(runs)) place({ ...landing, ...(commit === undefined ? {} : { commit }) }, landing.files);
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
  // A test the record does not list is read from where the runs at the snapshot's commit started.
  const over = runs.over ?? commit;
  const fallback: TestPlace = { ...(over === undefined ? {} : { commit: over }), assumed: true };
  let unlisted = 0;
  const from = new Set<string>();
  for (const test of tests) {
    const stand = withParts(listed.get(test) ?? fallback, parts.get(test));
    places.set(test, stand);
    if (stand.assumed !== true) continue;
    unlisted += 1;
    if (stand.commit !== undefined) from.add(stand.commit);
  }
  if (unlisted === 0) return { places, assumed: undefined };
  // Only under a snapshot that names no commit, whose runs started at none.
  const where =
    from.size === 0
      ? 'where the snapshot was recorded'
      : from.size === 1 && runs.over === undefined && commit !== undefined && from.has(commit)
      ? `${at}, where the snapshot was recorded`
      : from.size === 1 && runs.over !== undefined && from.has(runs.over)
        ? `${runs.over.slice(0, 12)}, where its runs started`
        : `the commits they were assumed at, ${[...from].map((stand) => stand.slice(0, 12)).join(', ')}`;
  return { places, assumed: `the runs record beside the snapshot does not say where ${unlisted} test(s) last ran, so they are read from ${where}` };
}
