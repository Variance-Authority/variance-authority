/**
 * Where the change a selector reads starts, for each test, which is not always
 * the commit the snapshot names.
 *
 * A snapshot names the commit of the latest run laid into it, not the commit
 * every observation in it was made at. A partial run — a runner that dropped
 * what `selectSuite` skips, one leg of it or the whole selection — is a run: the seam lands it and stamps the snapshot at `HEAD`, and every test
 * it did not run still stands on the text it last ran on. Read from the
 * snapshot's commit alone, the next selection finds nothing changed and skips
 * every one of those tests. `landRun` writes down where each test the runs at
 * this commit did not observe last ran, in `coverage.runs.json`, so it is read
 * here rather than worked out again or ignored. Both selectors read it through
 * this module, because the answer has one owner.
 *
 * A ref is a lower bound: a test that last ran after the merge base with it is
 * read from the merge base instead, so a ref never reads less than the runs
 * would. That holds after every test has run at the snapshot's commit too. A
 * ref asks what the branch changed, and the rows hold only what the snapshot
 * commit's text ran, so the branch's files are charged whole: a ref named on
 * purpose reads the whole branch rather than the runs.
 *
 * What changed between where a test stands and the snapshot's commit is read
 * for that test from both texts, as the change in the tree is, and the two
 * answers are kept together. The merge carries the rows such a test recorded
 * onto the text the snapshot's commit holds, by each region's address, so its
 * line numbers are that commit's; but it never ran that text. Read the other
 * way — from the snapshot commit's text back to the text the test ran — the
 * change is in the rows' own coordinates, and the regions it charges are the
 * ones the test's run and the snapshot's text disagree on. A run that would go
 * another way through the edit first goes another way in a region the test
 * entered, and that region is charged; a region the edit wrote takes the
 * crossings of the region around it. No other reading judges that pair: the
 * hunks from the test's commit are numbered in the text the rows no longer
 * are, and the snapshot commit's text against the tree leaves out the edit
 * before it.
 *
 * A landing over a dirty tree carries the rows onto the text on disk instead,
 * and keeps that text (`kept-texts.ts`). Those rows were never re-cut onto the
 * snapshot commit's text, and the diff back to the stand is not written from
 * the kept one, so the stand's question reads no kept text: such a file is
 * stale for it and charged whole, which selects more inside it and never
 * skips.
 */

import type { CommitRuns } from './commit-runs.js';
import { askCoverageFile } from './coverage-file.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { nearestFirst, type TestDistance } from './distance.js';
import type { ExecutionNarrowing, SelectionReason } from './select.js';

/** One git invocation, answering its stdout and throwing when git fails. */
export type Git = (...args: string[]) => string;

/** The tests that last ran at one commit other than the snapshot's, and what changed from it. */
export interface Stand {
  readonly commit: string;
  /** In code-unit order. */
  readonly tests: readonly string[];
  /** Every file changed from `commit` to the snapshot's commit, in code-unit order. */
  readonly changed: readonly string[];
  /**
   * The files charged whole for `tests` rather than read from both texts:
   * `changed`, for the merge base with a ref, which reads the whole branch;
   * empty for a stand the runs recorded.
   */
  readonly whole: readonly string[];
}

/**
 * Where a change is read from, per test. `refused`, with no stands and nothing
 * else, for a ref git cannot read; otherwise `base` and `from` are present
 * whenever the snapshot or the ref named a commit.
 */
export interface StandReading {
  /** The commit the hunk diff and the recorded text are read from. */
  readonly base?: string;
  /** The stand landed earliest, the oldest along one line of history; with `widened`, the stand git could not read. */
  readonly from?: string;
  /** In the order they were landed. A test in no stand is read from `base`. */
  readonly stands: readonly Stand[];
  /** Why `from` is where it is, in words that follow the commit. */
  readonly says?: string;
  /** Present when the runs record could not say where some test last ran: what was read instead. `says` ends with it too. */
  readonly assumed?: string;
  /** A ref git cannot read. */
  readonly refused?: string;
  /** A stand git cannot read, such as one a rebase rewrote away; the caller runs every test. */
  readonly widened?: string;
  /** Tests the runs place before the snapshot's commit that are not on disk, in no stand; only {@link standsAt} asks. */
  readonly gone?: readonly string[];
}

/**
 * The paths of one git answer asked with `-z`, as git wrote them. Without `-z`,
 * git C-quotes a path holding a quote, a backslash, a tab or a newline whatever
 * `core.quotePath` says, and a trimmed line loses a path's own leading space.
 */
const paths = (text: string): string[] => text.split('\0').filter((path) => path !== '');

/** Whether `ancestor` is in the history of `commit`, asked of git. */
function isAncestor(git: Git, ancestor: string, commit: string): boolean {
  try {
    git('merge-base', '--is-ancestor', ancestor, commit);
    return true;
  } catch {
    return false;
  }
}

/**
 * The commit each of `tests` last ran at, as the runs beside the snapshot
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
function standsOf({ commit, runs, tests }: { readonly commit: string; readonly runs: CommitRuns | undefined; readonly tests: readonly string[] }): {
  readonly stands: Map<string, string>;
  readonly assumed: string | undefined;
} {
  const stands = new Map(tests.map((test) => [test, commit]));
  const at = commit.slice(0, 12);
  const everyTest = `so every test is read as though it last ran at ${at}`;
  if (runs === undefined) return { stands, assumed: tests.length === 0 ? undefined : `no runs record lies beside the snapshot, ${everyTest}` };
  if (runs.commit !== commit) {
    const whose = runs.commit === undefined ? 'a run outside a checkout' : `${runs.commit.slice(0, 12)}'s`;
    return { stands, assumed: tests.length === 0 ? undefined : `the runs record beside the snapshot is ${whose}, not ${at}'s, ${everyTest}` };
  }
  const ran = new Set(runs.files);
  const listed = new Map<string, string>();
  const guessed = new Set<string>();
  for (const entry of runs.standing ?? []) {
    for (const file of entry.files) {
      listed.set(file, entry.commit);
      if (entry.assumed === true) guessed.add(file);
    }
  }
  const fallback = runs.over ?? commit;
  let unlisted = 0;
  const from = new Set<string>();
  for (const test of tests) {
    if (ran.has(test)) continue;
    const stand = listed.get(test) ?? fallback;
    stands.set(test, stand);
    if (listed.has(test) && !guessed.has(test)) continue;
    unlisted += 1;
    from.add(stand);
  }
  if (unlisted === 0) return { stands, assumed: undefined };
  const where =
    from.size === 1 && runs.over === undefined && from.has(commit)
      ? `${at}, where the snapshot was recorded`
      : from.size === 1 && runs.over !== undefined && from.has(runs.over)
        ? `${runs.over.slice(0, 12)}, where its runs started`
        : `the commits they were assumed at, ${[...from].map((stand) => stand.slice(0, 12)).join(', ')}`;
  return { stands, assumed: `the runs record beside the snapshot does not say where ${unlisted} test(s) last ran, so they are read from ${where}` };
}

/** The merge base with `ref`, or why there is none to read from. */
function mergeBase(git: Git, ref: string): { readonly merged: string } | { readonly refused: string } {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    return { refused: `\`${ref}\` is not a commit this checkout knows` };
  }
  try {
    return { merged: git('merge-base', ref, 'HEAD').trim() };
  } catch {
    return { refused: `\`${ref}\` shares no history with HEAD` };
  }
}

/**
 * The reading a selector makes of where each test last ran.
 *
 * `runs` is `coverage.runs.json` beside the snapshot being read, which
 * describes that snapshot whichever layer holds it. `tests` are the snapshot's
 * test files the suite still collects: a deleted or renamed test keeps its row
 * in the snapshot and never runs again, and a stand only it holds would read
 * from that commit for ever. `ref`, when given, is the lower bound above.
 */
export function readingFrom({
  commit,
  ref,
  runs,
  tests = [],
  git,
}: {
  readonly commit: string | undefined;
  readonly ref: string | undefined;
  readonly runs: CommitRuns | undefined;
  readonly tests?: readonly string[];
  readonly git: Git;
}): StandReading {
  let merged: string | undefined;
  if (ref !== undefined) {
    const found = mergeBase(git, ref);
    if ('refused' in found) return { stands: [], refused: found.refused };
    merged = found.merged;
  }
  if (commit === undefined) {
    return merged === undefined ? { stands: [] } : { base: merged, from: merged, stands: [], says: `the merge base with ${ref}` };
  }

  const { stands, assumed } = standsOf({ commit, runs, tests });
  const also = assumed === undefined ? {} : { assumed };
  let note = '';
  if (merged !== undefined && merged !== commit) {
    if (isAncestor(git, merged, commit)) {
      const lower = new Map<string, boolean>();
      for (const [test, stand] of stands) {
        if (!lower.has(stand)) lower.set(stand, stand !== merged && isAncestor(git, merged, stand));
        if (lower.get(stand) === true) stands.set(test, merged);
      }
    } else note = `; the merge base with ${ref} is not before it`;
  }

  // Landing order, earliest first: `standing` is in the order its commits were
  // landed, and `over` is the snapshot the runs at this commit were laid over,
  // the last landed before them. Along one line of history that is oldest
  // first; a run landed over a newer commit (a suite run after checking out an
  // older one, or the main line's shards landed over a branch's runs) puts a
  // newer stand ahead of an older one, and ordering by ancestry would cost a
  // git call per stand. The merge base comes last: every stand descending from
  // it was lowered onto it above, so no stand still held is after it.
  const order = [
    ...new Set([
      ...(runs?.commit === commit ? [...(runs.standing ?? []).map((entry) => entry.commit), ...(runs.over === undefined ? [] : [runs.over])] : []),
      ...(merged === undefined ? [] : [merged]),
    ]),
  ];
  const grouped = new Map<string, string[]>();
  for (const [test, stand] of stands) {
    if (stand !== commit) grouped.set(stand, [...(grouped.get(stand) ?? []), test]);
  }
  const landed = [...grouped.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const said = assumed === undefined ? '' : `; ${assumed}`;
  if (landed.length === 0) return { base: commit, from: commit, stands: [], says: `where the snapshot was recorded${note}${said}`, ...also };

  const at = commit.slice(0, 12);
  const first = landed[0]!;
  const reason =
    first === merged ? `the merge base with ${ref}` : `where ${grouped.get(first)!.length} test(s) the runs at ${at} did not run last ran`;
  const read: Stand[] = [];
  for (const stand of landed) {
    const standing = grouped.get(stand)!.sort();
    try {
      // FIXME: a submodule's change lists only its gitlink path here, so neither a
      // test under it nor one that entered a file inside it is charged with that change.
      const changed = [...new Set(paths(git('diff', '--name-only', '-z', '--no-renames', stand, commit)))].sort();
      read.push({ commit: stand, tests: standing, changed, whole: stand === merged ? changed : [] });
    } catch {
      return {
        base: commit,
        from: stand,
        stands: [],
        says: `${reason}${said}`,
        ...also,
        widened: `git could not diff ${stand.slice(0, 12)}, where ${standing.length} test(s) last ran, against ${at}`,
      };
    }
  }
  const readings = [false, true].flatMap((whole) => {
    const these = read.filter((stand) => (stand.commit === merged) === whole);
    if (these.length === 0) return [];
    const files = new Set(these.flatMap((stand) => stand.changed)).size;
    const count = these.reduce((sum, stand) => sum + stand.tests.length, 0);
    return whole
      ? [`${files} file(s) changed between the merge base with ${ref} and ${at} are read whole for the ${count} test(s) read from it`]
      : [`${files} file(s) changed between the commits ${count} test(s) last ran at and ${at}, where the snapshot was recorded, are read from both texts for them`];
  });
  return { base: commit, from: first, stands: read, says: `${reason}${note}; ${readings.join('; ')}${said}`, ...also };
}

/**
 * The reading of the snapshot at `coverageFile` against `runs`, the record
 * beside it, for every test the snapshot holds that is still on disk.
 *
 * For a selector that has no suite of its own to ask which tests still count,
 * such as `variance select`. A deleted or renamed test keeps its row in the
 * snapshot, and every later run carries it forward in `standing`, because no
 * run can observe it again. Left in, it would hold a stand at the commit it
 * last ran at for ever: an extra reading, a note, and, once that commit is gone
 * from the checkout, a reading that cannot be made. So a test the runs place
 * before the snapshot's commit is kept only when `exists` finds it, and the
 * ones it does not find are named in `gone`. The disk is asked rather than
 * git's list of files, which holds no generated test under an ignored
 * directory and no test inside a submodule or a nested repository. Asking the
 * disk keeps such a test in its stand rather than dropping it; it does not
 * make git's diff list what changed inside a submodule, which it names by its
 * gitlink path alone. Only those tests are asked about; nothing walks the tree.
 *
 * `runs` is read by the caller, which says what the record was for when it
 * cannot be parsed. `undefined` when the snapshot names no commit, so there is
 * nothing to read from.
 */
export function standsAt(
  coverageFile: string,
  runs: CommitRuns | undefined,
  git: Git,
  exists: (test: string) => boolean,
): StandReading | undefined {
  const recorded = askCoverageFile(coverageFile, (coverage) => ({
    commit: coverage.commit,
    tests: Array.from(coverage.testPath.all(), (path) => coverage.string(path)),
  }));
  const commit = recorded.commit;
  if (commit === undefined) return undefined;
  const { stands } = standsOf({ commit, runs, tests: recorded.tests });
  const gone = new Set([...stands].filter(([test, stand]) => stand !== commit && !exists(test)).map(([test]) => test));
  const tests = recorded.tests.filter((test) => !gone.has(test));
  const reading = readingFrom({ commit, ref: undefined, runs, tests, git });
  return gone.size === 0 ? reading : { ...reading, gone: [...gone].sort(codeUnitOrder) };
}

/** A path as a `diff --git` header spells it, unquoted where git quoted it. */
function headerPath(rest: string): string {
  if (!rest.startsWith('"')) return rest.slice(2, 2 + (rest.length - 5) / 2);
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, '\\': 92 };
  for (let at = 1; at < rest.length && rest[at] !== '"'; at += 1) {
    if (rest[at] !== '\\') {
      const character = String.fromCodePoint(rest.codePointAt(at)!);
      bytes.push(...Buffer.from(character));
      at += character.length - 1;
    } else if (/[0-7]/.test(rest[at + 1] ?? '')) {
      bytes.push(Number.parseInt(rest.slice(at + 1, at + 4), 8));
      at += 3;
    } else {
      bytes.push(escapes[rest[at + 1]!] ?? rest.charCodeAt(at + 1));
      at += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8').slice(2);
}

/**
 * The diff with every section for one of `files` left out, so none of them is
 * also read by its hunks. Cut from the diff's own text rather than asked of git
 * with a pathspec per file, which a long branch would push past the argument
 * limit. A `diff --git` line at the start of a line is always a header: a hunk
 * line starts with a space, `+`, `-` or `\`.
 */
export function withoutFiles(diff: string, files: readonly string[]): string {
  if (files.length === 0) return diff;
  const drop = new Set(files);
  const out: string[] = [];
  let keep = true;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) keep = !drop.has(headerPath(line.slice('diff --git '.length)));
    if (keep) out.push(line);
  }
  return out.join('\n');
}

/** A file named with no hunk, which the selector charges every region of. */
export const wholeEntry = (file: string): string => `diff --git a/${file} b/${file}`;

/**
 * The change from the snapshot's commit back to `stand`, as `git diff` writes
 * it with every setting that would reword it turned off: the snapshot's text is
 * the old side, so the hunks are numbered in the lines the rows hold.
 */
export const standDiff = (git: Git, commit: string, stand: string): string =>
  git(
    '-c', 'core.quotePath=false', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false',
    'diff', '--no-color', '--no-ext-diff', '--no-renames', commit, stand,
  );

/**
 * One question `askPerStand` puts to a selector. `tree` reads the change from
 * the snapshot's commit to the tree, on the install at `at`, with `whole`
 * charged whole and left out of the hunks; `stand` reads the change from the
 * snapshot's commit to `at`, from both texts, with no install of its own and
 * no kept text, so a module a landing kept a text for is charged whole.
 */
export type StandQuestion =
  | { readonly read: 'tree'; readonly at: string | undefined; readonly whole: readonly string[] }
  | { readonly read: 'stand'; readonly at: string };

/** What a selector answers one {@link StandQuestion} with. */
export interface StandAnswer<Distance extends TestDistance> {
  readonly narrowing: ExecutionNarrowing;
  readonly distances?: readonly Distance[];
}

/**
 * Ask once for the tests read from the snapshot's commit, and per older stand
 * for the tests standing there, and keep each answer only for the tests it was
 * asked for. One question over every stand at once would read a test that ran
 * after an edit as though it had not.
 *
 * A stand is asked twice: what the tree changed since the snapshot's commit, on
 * the install the stand's tests ran on, and what the snapshot's commit changed
 * since the stand. A test either reading charges is entered, for the reasons
 * both name, at the nearer distance. A stand that charges its files whole, the
 * merge base with a ref, is asked the first question alone. Each selector
 * builds and asks the diff itself, because each brings the hunks into its own
 * coordinates. `whole`, `readings` and the rest of the narrowing are the
 * snapshot commit's answer; `unread` and `stale` are every answer's.
 */
export async function askPerStand<Distance extends TestDistance>(
  stands: readonly Stand[],
  ask: (question: StandQuestion) => Promise<StandAnswer<Distance>>,
): Promise<{ readonly narrowing: ExecutionNarrowing; readonly distances: readonly Distance[] }> {
  const owner = new Map(stands.flatMap((stand, at) => stand.tests.map((test) => [test, at] as const)));
  const mine = (at: number) => (test: string) => (owner.get(test) ?? -1) === at;
  const entered = new Set<string>();
  const because = new Map<string, Map<string, SelectionReason>>();
  const distances = new Map<string, Distance>();
  const unread = new Set<string>();
  const stale = new Set<string>();
  const keep = (answer: StandAnswer<Distance>, at: number): void => {
    for (const test of answer.narrowing.entered) if (mine(at)(test)) entered.add(test);
    for (const cause of answer.narrowing.because) {
      if (!mine(at)(cause.test)) continue;
      const via = because.get(cause.test) ?? new Map<string, SelectionReason>();
      for (const reason of cause.via) via.set(JSON.stringify(reason), reason);
      because.set(cause.test, via);
    }
    for (const distance of answer.distances ?? []) {
      if (!mine(at)(distance.test)) continue;
      const held = distances.get(distance.test);
      if (held === undefined || nearestFirst(distance, held) < 0) distances.set(distance.test, distance);
    }
    for (const path of answer.narrowing.unread) unread.add(path);
    for (const name of answer.narrowing.stale) stale.add(name);
  };
  const here = await ask({ read: 'tree', at: undefined, whole: [] });
  keep(here, -1);
  for (const [at, stand] of stands.entries()) {
    keep(await ask({ read: 'tree', at: stand.commit, whole: stand.whole }), at);
    if (stand.whole.length === 0 && stand.changed.length > 0) keep(await ask({ read: 'stand', at: stand.commit }), at);
  }
  const order = [...entered];
  return {
    narrowing: {
      ...here.narrowing,
      entered: order,
      because: order.flatMap((test) => {
        const via = because.get(test);
        return via === undefined ? [] : [{ test, via: [...via.values()] }];
      }),
      unread: [...unread].sort(),
      stale: [...stale].sort(),
    },
    distances: [...distances.values()],
  };
}
