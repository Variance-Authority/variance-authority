/**
 * Where each test last ran, and when, as the runs record beside a snapshot
 * says it (`commit-runs.ts`). Every reader of where a test stands places it
 * here: a selector reads the commit, `covering` the commit and the time.
 */

// compass: variance-authority.reach

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { CommitRuns, StandingEntry } from './commit-runs.js';
import type { KeptTexts } from './kept-texts.js';
import type { ExecutionTest } from './reverse.js';

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
   * Of a place in `partly`: the cases it laid of each test file it ran in
   * part, as the record names them (`StandingEntry.cases`); none when it kept
   * no cases. Absent when the record does not say which, so which of a file's
   * cases are this place's is not known.
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

function placesOf(of: TestsAt<string | undefined>): Places<TestPlace> {
  const { commit, runs, tests } = of;
  const fallen: TestPlace = { ...(commit === undefined ? {} : { commit }), assumed: true };
  const places = new Map(tests.map((test) => [test, fallen]));
  // Runs recorded at another commit describe some other snapshot and say nothing of this one.
  if (runs === undefined || runs.commit !== commit) return { places, assumed: assumedOf(of, places) };
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
  for (const landing of runs.landings) place({ ...landing, ...(commit === undefined ? {} : { commit }) }, landing.files);
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
  for (const test of tests) places.set(test, withParts(listed.get(test) ?? fallback, parts.get(test)));
  return { places, assumed: assumedOf(of, places) };
}

/**
 * In the runs record's words, how placing `tests` fell back where the record
 * could not say, read off `places`, which one reading gave each of them;
 * absent when none fell back. A reader that placed more test files than it
 * names in one reading says this of the ones it names.
 */
export function assumedOf({ commit, runs, tests }: TestsAt<string | undefined>, places: ReadonlyMap<string, TestPlace>): string | undefined {
  if (tests.length === 0) return undefined;
  const at = commit?.slice(0, 12);
  const everyTest = `so every test is read as though it last ran ${at === undefined ? 'where the snapshot was recorded' : `at ${at}`}`;
  if (runs === undefined) return `no runs record lies beside the snapshot, ${everyTest}`;
  if (runs.commit !== commit) {
    const whose = runs.commit === undefined ? 'a run outside a checkout' : `${runs.commit.slice(0, 12)}'s`;
    const not = at === undefined ? 'and the snapshot names no commit' : `not ${at}'s`;
    return `the runs record beside the snapshot is ${whose}, ${not}, ${everyTest}`;
  }
  const fell = tests.flatMap((test) => {
    const place = places.get(test);
    return place?.assumed === true ? [place] : [];
  });
  if (fell.length === 0) return undefined;
  const from = new Set(fell.flatMap((place) => (place.commit === undefined ? [] : [place.commit])));
  // Only under a snapshot that names no commit, whose runs started at none.
  const where =
    from.size === 0
      ? 'where the snapshot was recorded'
      : from.size === 1 && runs.over === undefined && commit !== undefined && from.has(commit)
      ? `${at}, where the snapshot was recorded`
      : from.size === 1 && runs.over !== undefined && from.has(runs.over)
        ? `${runs.over.slice(0, 12)}, where its runs started`
        : `the commits they were assumed at, ${[...from].map((stand) => stand.slice(0, 12)).join(', ')}`;
  return `the runs record beside the snapshot does not say where ${fell.length} test(s) last ran, so they are read from ${where}`;
}

/**
 * Some of one test file's named cases and the runs they may have last run in:
 * the one that last ran them, then each later run that ran the file in part
 * and does not say which cases it laid, or every later one when no case is
 * named, since each wrote some of the file's lines. `cases`, by name, when the
 * file's named cases last ran apart, so the file is said part by part.
 */
export interface CasesLastRan {
  readonly runs: readonly TestPlace[];
  readonly cases?: readonly string[];
}

/** The named cases of `test`, placed at `place`, grouped by the runs each last ran in: one part, naming no cases, when they all agree. */
export function lastRunsOf(place: TestPlace, test: string, cases: readonly Pick<ExecutionTest, 'id' | 'name'>[] | undefined): readonly CasesLastRan[] {
  const runs = [place, ...(place.partly ?? [])];
  if (place.partly === undefined || cases === undefined || cases.length === 0) return [{ runs }];
  const groups = new Map<string, { readonly runs: readonly TestPlace[]; readonly cases: string[] }>();
  for (const one of cases) {
    const last = lastRanIn(place, test, one.id);
    const key = last.map((run) => runs.indexOf(run)).join(' ');
    const group = groups.get(key) ?? { runs: last, cases: [] };
    group.cases.push(one.name);
    groups.set(key, group);
  }
  const parts = [...groups.values()];
  if (parts.length === 1) return [{ runs: parts[0]!.runs }];
  return parts.map((part) => ({ runs: part.runs, cases: [...new Set(part.cases)].sort(codeUnitOrder) }));
}

/**
 * The runs case `id` of `test` may have last run in: the latest that names it
 * among the cases it laid, else the one that last finished the file, then each
 * later run that ran the file in part and does not say which of its cases.
 */
function lastRanIn(place: TestPlace, test: string, id: string): readonly TestPlace[] {
  const maybe: TestPlace[] = [];
  for (const part of [...(place.partly ?? [])].reverse()) {
    const ran = part.cases?.[test];
    if (ran === undefined) maybe.unshift(part);
    else if (ran.includes(id)) return [part, ...maybe];
  }
  return [place, ...maybe];
}
