/**
 * Where a checkout's execution record lives, and how a worktree inherits one.
 *
 * A repository that declares no suites keeps one record, `coverage.bin`, at the
 * top of its layer. A repository that declares them keeps one per suite, under
 * `suites/<name>/`, and everything derived from a record's path — its case
 * index, its runs log — lands beside it and so is the suite's too. The name
 * table and the source index stay at the top of the layer: they describe the
 * checkout, not a run.
 */

// compass: variance-authority.reach

import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { link, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { layeredFiles, repositoryLayers } from './cache-layers.js';
import { commitRunsFile, readCommitRuns, type CommitRuns } from './commit-runs.js';
import { decodeExecutionTests } from './execution-format.js';
import { openSetExecutionIndex } from './execution-set-format.js';
import { openTestCoverage, type TestCoverageView } from './format-view.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { declaredSuite } from './suites.js';

export interface RecordLocationOptions {
  /**
   * The declared suite whose record this is. Required once the root config
   * declares any suite, and refused when it declares none.
   */
  readonly suite?: string | undefined;
  /** The cache directory, when the caller already knows it. */
  readonly cacheRoot?: string | undefined;
}

/**
 * The record's path inside a layer, checked against the declaration.
 *
 * Throws for a suite the root config does not declare, and for no suite once
 * any is declared: see {@link declaredSuite}.
 */
export function recordPath(root: string, suite?: string): string {
  const declared = declaredSuite(root, suite);

  return declared === undefined ? 'coverage.bin' : `suites/${declared.name}/coverage.bin`;
}

/**
 * Where this checkout keeps its snapshot.
 *
 * The checkout's own directory, which in the primary checkout is the
 * repository's and in a worktree is a layer above it — see {@link repositoryLayers}.
 * It is the write target either way: nothing writes to a layer it does not own.
 *
 * A worktree's is empty until {@link seedTestCoverage} fills it.
 */
export function testCoverageFile(root: string, options: RecordLocationOptions = {}): string {
  return resolve(repositoryLayers(root, options.cacheRoot).top, recordPath(root, options.suite));
}

/**
 * The record a seam writes: the file its caller named, or the declared suite's.
 *
 * A caller that names `coverageFile` owns that file, and it is not a layer of
 * anything or checked against the declaration. Naming a suite as well is
 * refused rather than one of the two being dropped: both say where the run
 * records, and a run that honoured one would record where the caller did not
 * look.
 */
export function recordFileFor(
  root: string,
  from: string,
  options: { readonly coverageFile?: string | undefined; readonly suite?: string | undefined },
): string {
  if (options.coverageFile === undefined) return testCoverageFile(root, { suite: options.suite });
  if (options.suite !== undefined) {
    throw new Error(
      `the suite "${options.suite}" and the file ${options.coverageFile} both say where this run records; name one`,
    );
  }

  return resolve(from, options.coverageFile);
}

/**
 * Give a checkout the repository's snapshot to build its own on top of.
 *
 * A worktree cut this morning is a checkout of a repository that has been
 * recording for months, and with a cache directory of its own it would inherit
 * none of that: the first run in it re-instruments a world already sitting on
 * disk a directory away. So before the first run, the base is copied up — once,
 * and only when this checkout has nothing of its own, because after that the
 * checkout's own snapshot is the base plus everything its branch has recorded,
 * and the base is the staler of the two.
 *
 * A copy rather than a read-through join, because the write path already layers:
 * `layeredCoverage` folds a run into a whole snapshot, so a worktree that starts
 * from a copy of the base and lands its runs on that copy holds exactly what a
 * two-layer read would have computed, without paying for the join on every read
 * or pinning the base while it works.
 *
 * A suite's record is seeded from the same suite's under the base, and never
 * from another suite's or from the repository's one record: those were cut by
 * another build.
 *
 * A base this build cannot read is not copied and not an error. That is the same
 * answer {@link recordedCommit} gives, for the same reason: a snapshot written
 * by another layout is a snapshot this run has no claim on, and one stale base
 * must not be able to fail every worktree of the repository at once. The run
 * proceeds with no index and records one.
 *
 * The snapshot is seeded with a runs record beside it, which says where each
 * of its tests last ran: see {@link seedCommitRuns}.
 *
 * Does nothing at all when the caller named its own file, or in the primary
 * checkout, where the two layers are one directory.
 */
export async function seedTestCoverage(
  file: string,
  root: string,
  cacheRoot?: string,
): Promise<void> {
  const layers = repositoryLayers(root, cacheRoot);
  if (layers.top === layers.base) return;
  // A caller that named its own file owns it, and it is not a layer of
  // anything: there is no base beneath a path somebody passed in.
  const inside = relative(layers.top, file).split(sep).join('/');
  if (inside !== 'coverage.bin' && !/^suites\/[^/]+\/coverage\.bin$/u.test(inside)) return;
  let snapshot: TestCoverageView | undefined;
  const seeded = await seedFrom(layers.base, inside, file, (bytes) => {
    snapshot = openTestCoverage(bytes);
  });
  // The case index is a second record beside the snapshot, and the run folds
  // into whatever it finds there, replacing the cases of the files it ran. With
  // nothing seeded the first run in a worktree would write a partial index that
  // then stands for the whole suite.
  //
  // Only beside the snapshot copied with it. A checkout whose own snapshot is
  // there and whose index is not has no recorded cases — a landing removed
  // them, or its runs recorded none — and the base's index is the cases of a
  // different snapshot.
  if (!seeded || snapshot === undefined) return;
  await seedFrom(layers.base, `${inside}.cases.bin`, `${file}.cases.bin`, (bytes) => {
    if (openSetExecutionIndex(bytes) === undefined) decodeExecutionTests(bytes);
  });
  await seedCommitRuns(file, resolve(layers.base, inside), snapshot);
}

/**
 * Lay a runs record beside a snapshot just copied from the base, saying where
 * each of its tests last ran.
 *
 * The primary checkout's record is the recording of `main` as of its last run,
 * and it is what every worktree starts from, so a test the worktree has not run
 * last ran where that record says it did. The runs record beside it says that
 * per test, and it is carried rather than worked out again: `commit`, `files`
 * and `standing` as the base wrote them. Without it the worktree's first
 * partial run finds no record to carry `standing` forward from, and until a run
 * observes every test, a test it did not run is read from the worktree's own
 * first commit — which skips it after a change it never ran against.
 *
 * A test the base's record neither ran nor lists is one the primary checkout
 * reads from the base's `over`, where its runs started, and the seed lists it
 * there. That is the primary's own reading, carried so both checkouts select
 * the same tests; the primary prints it as an assumption and the worktree,
 * holding it as a listing, does not.
 *
 * Nothing is seeded when the base cannot say where every test last ran: no
 * runs record, one naming another commit than its snapshot — a landing
 * replaced the snapshot and listed no run — or one with tests it does not place
 * and no `over` to read them from. A snapshot names the commit of its latest
 * run, not of every test in it, so a seed built from it would record a guess.
 * The worktree's reading then says, on the line under the one naming whose
 * record it read, which tests it could not place and where it read them from.
 *
 * `over` itself is never carried: it is where the base's change started, and a
 * review in the worktree asks where the worktree's own change starts. `runs` is
 * 0, so the worktree's first run at the same commit is not counted as another
 * run of the base's — see `landRun` — and a review still finds that no run of
 * this checkout has listed itself.
 *
 * The record is linked into place rather than renamed over it: a landing that
 * wrote one first, between the snapshot's copy and this, keeps its own.
 */
async function seedCommitRuns(file: string, base: string, snapshot: TestCoverageView): Promise<void> {
  const commit = snapshot.commit;
  if (commit === undefined) return;
  let held: CommitRuns | undefined;
  try {
    held = await readCommitRuns(base);
  } catch {
    // A record this build cannot parse says nothing about this snapshot.
    return;
  }
  if (held?.commit !== commit) return;
  const placed = new Set([...held.files, ...(held.standing ?? []).flatMap((entry) => entry.files)]);
  const unplaced = Array.from(snapshot.testPath.all(), (path) => snapshot.string(path))
    .filter((test) => !placed.has(test))
    .sort(codeUnitOrder);
  let standing = held.standing;
  if (unplaced.length > 0) {
    if (held.over === undefined) return;
    // Every test the record lists last ran before the commit its runs started
    // at, so `over` is the newest stand, and oldest first puts it last.
    const listed = standing ?? [];
    const last = listed.at(-1);
    standing =
      last?.commit === held.over
        ? [...listed.slice(0, -1), { commit: held.over, files: [...last.files, ...unplaced].sort(codeUnitOrder) }]
        : [...listed, { commit: held.over, files: unplaced }];
  }
  const at = new Date().toISOString();
  const record: CommitRuns = {
    commit,
    first: at,
    latest: at,
    runs: 0,
    files: held.files,
    ...(standing === undefined ? {} : { standing }),
  };
  await writeCoverageOnce(commitRunsFile(file), Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
}

/**
 * Copy `name` from under `base` to `target` unless `target` is already there,
 * and unless `opens` refuses the bytes. No base and an unreadable one are the
 * same answer: nothing to inherit. Says whether it copied.
 */
async function seedFrom(
  base: string,
  name: string,
  target: string,
  opens: (bytes: Uint8Array) => void,
): Promise<boolean> {
  try {
    await stat(target);
    return false;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  try {
    const bytes = await readFile(resolve(base, name));
    // Opening parses the section index and nothing else, which is the whole of
    // what "this build can read it" means and costs a fraction of a decode.
    opens(bytes);
    await writeCoverageBytes(target, bytes);
    return true;
  } catch {
    // No base, or one this build has no claim on. Either way there is nothing
    // to inherit and the run records its own.
    return false;
  }
}

/**
 * The nearest snapshot a checkout can read, without writing anything.
 *
 * A reader asks what is known, and in a worktree that has not run yet what is
 * known is the repository's. Reading is not first use — a question about the
 * index should not cost the asker a copy of it — so this resolves rather than
 * seeds, and the copy happens when a run lands, which is the moment the
 * checkout acquires something of its own to keep.
 *
 * The path is returned even when neither layer holds a file, so a caller that
 * wants to say which file it could not read has one to name.
 */
export async function readableTestCoverage(
  root: string,
  options: RecordLocationOptions = {},
): Promise<string> {
  return nearestTestCoverage(root, options);
}

/**
 * {@link readableTestCoverage} for a caller that cannot wait, and the one rule
 * every reader finds a recording by.
 *
 * The case index a reader opens is the one beside this snapshot, never the
 * nearest index on its own: an index answers for the snapshot it was laid
 * beside. A layer whose snapshot is there and whose index is not has no
 * recorded cases, and the layer under it is not asked.
 */
export function nearestTestCoverage(root: string, options: RecordLocationOptions = {}): string {
  const files = layeredFiles(repositoryLayers(root, options.cacheRoot), recordPath(root, options.suite));
  for (const file of files) {
    try {
      statSync(file);
      return file;
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }

  return files[0]!;
}

/**
 * Write bytes where readers will find them, whole or not at all.
 *
 * Which is what `layeredCoverage` hands back: it merges and encodes in one pass
 * over the columns, so there is no model at the end of it to hand a writer that
 * insists on one. A rename over a temporary file in the same directory, so a
 * reader that opens the path sees the previous bytes or these and never the
 * bytes between.
 */
export async function writeCoverageBytes(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

/**
 * {@link writeCoverageBytes} for a file somebody else may be writing: the bytes
 * are linked into place, never over it, so whoever wrote the path first keeps
 * it and a reader still never sees a partial file.
 */
async function writeCoverageOnce(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  try {
    await link(temporary, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error;
  } finally {
    await unlink(temporary);
  }
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
