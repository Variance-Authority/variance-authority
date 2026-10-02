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
import { caseSectionsOf, sharedRecord } from './case-record.js';
import { decodeExecutionTests } from './execution-format.js';
import { openSetExecutionIndex } from './execution-set-format.js';
import { RecordWithoutCoverage } from './format-validation.js';
import { openTestCoverage, type TestCoverageView } from './format-view.js';
import { layFetchedMainline, lastFetchedMainline, type LastFetched } from './mainline-layer.js';
import { writeOwnLayer } from './own-layer.js';
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

/** Which record a checkout's first run was laid on, when {@link seedTestCoverage} laid one. */
export type Seeded =
  | { readonly from: 'mainline'; readonly record: LastFetched }
  | {
      readonly from: 'primary';
      /** The primary checkout's record that was copied. */
      readonly file: string;
      /** The suite, when the root config gives it to the share and so a mainline record was looked for first. */
      readonly shared?: string;
    };

/**
 * Give a checkout the base to build its own record on top of, before its first
 * run lands.
 *
 * A worktree cut this morning is a checkout of a repository that has been
 * recording for months, and with a cache directory of its own it would inherit
 * none of that: the first run in it re-instruments a world already sitting on
 * disk. So before the first run the base is copied up — once, and only when
 * this checkout has nothing of its own, because after that the checkout's own
 * record is the base plus everything its branch has recorded.
 *
 * The base is the one every reader measures from, in the same order:
 *
 * 1. **The mainline's record, as last fetched on this machine**, for a suite
 *    the root config gives to the share: the coverage record, its case index
 *    and the runs record the publishing run wrote, unaltered — see
 *    {@link lastFetchedMainline}. This applies in the primary checkout too,
 *    whenever its own layer is empty.
 * 2. **The primary checkout's record**, in a worktree, when no mainline record
 *    was fetched here or the fetched one does not read. For a suite given to
 *    the share this is an offline fallback, and {@link noteSeeded} says so.
 *
 * A copy rather than a read-through join, because the write path already layers:
 * `layeredCoverage` folds a run into a whole snapshot, so a checkout that starts
 * from a copy of the base and lands its runs on that copy holds exactly what a
 * two-layer read would have computed, without paying for the join on every read
 * or pinning the base while it works.
 *
 * A suite's record is seeded from the same suite's, and never from another
 * suite's or from the repository's one record: those were cut by another build.
 *
 * A base this build cannot read is not copied and not an error. That is the same
 * answer {@link recordedCommit} gives, for the same reason: a snapshot written
 * by another layout is a snapshot this run has no claim on, and one stale base
 * must not be able to fail every worktree of the repository at once. The run
 * proceeds with the next base, or with no index, and records one.
 *
 * The primary checkout's snapshot is seeded with a runs record beside it, which
 * says where each of its tests last ran: see {@link seedCommitRuns}.
 *
 * Does nothing at all when the caller named its own file. Returns what it laid,
 * or `undefined` when it laid nothing.
 */
export async function seedTestCoverage(
  file: string,
  root: string,
  cacheRoot?: string,
): Promise<Seeded | undefined> {
  const layers = repositoryLayers(root, cacheRoot);
  // A caller that named its own file owns it, and it is not a layer of
  // anything: there is no base beneath a path somebody passed in.
  const inside = relative(layers.top, file).split(sep).join('/');
  if (inside !== 'coverage.bin' && !/^suites\/[^/]+\/coverage\.bin$/u.test(inside)) return undefined;
  const suite = /^suites\/([^/]+)\//u.exec(inside)?.[1];
  const shared = suite === undefined ? undefined : declaredSuite(root, suite)?.carry === 'share' ? suite : undefined;
  if (shared !== undefined) {
    const record = lastFetchedMainline(root, shared, cacheRoot);
    if (record !== undefined && (await layFetchedMainline(record, file))) return { from: 'mainline', record };
  }
  if (layers.top === layers.base) return undefined;
  let snapshot: TestCoverageView | undefined;
  // The cases come in the record, and the run folds into whatever it finds
  // there, replacing the cases of the files it ran: with none seeded, the first
  // run in a worktree would write a partial index that then stands for the
  // whole suite. The base's last run, and what that run laid over, are the
  // base's and stay there; the worktree's first run is the first it has. A
  // base whose run instrumented nothing holds cases and no coverage: its cases
  // are seeded all the same, and the copy is as unmeasured as the base, with no
  // runs record beside it, since no test stands at a commit nothing measured.
  const seeded = await seedFrom(layers.base, inside, file, (bytes) => {
    try {
      snapshot = openTestCoverage(bytes);
    } catch (error) {
      if (!(error instanceof RecordWithoutCoverage)) throw error;
    }
    const { index } = caseSectionsOf(bytes);
    if (index !== undefined && openSetExecutionIndex(index) === undefined) decodeExecutionTests(index);
    return sharedRecord(bytes);
  });
  if (!seeded) return undefined;
  if (snapshot !== undefined) await seedCommitRuns(file, resolve(layers.base, inside), snapshot);
  // The primary checkout's record is no milestone: nothing is pinned, and no
  // fetch moves it. Its tests are not this checkout's.
  await writeOwnLayer(file, { ran: [] });
  return { from: 'primary', file: resolve(layers.base, inside), ...(shared === undefined ? {} : { shared }) };
}

/**
 * Say which base a run was laid on, where the run prints: once, when a
 * checkout's first run lands. Silent when nothing was laid, and for the primary
 * checkout's record under a suite the share does not carry, where it is the
 * only base there is.
 */
export function noteSeeded(seeded: Seeded | undefined): void {
  if (seeded === undefined) return;
  if (seeded.from === 'mainline') {
    const { record } = seeded;
    console.warn(
      `variance-authority laid this checkout's first record of "${record.suite}" from mainline ${record.mainline}, ` +
        `published at ${record.commit} and fetched ${record.fetched}${record.runs === undefined ? ', with no runs record' : ''}; kept at ${record.coverage}.`,
    );
    return;
  }
  if (seeded.shared === undefined) return;
  console.warn(
    `variance-authority laid this worktree's first record of "${seeded.shared}" from the primary checkout's, at ${seeded.file}: ` +
      `no mainline record of it has been fetched on this machine, or the one fetched does not read. ` +
      `\`variance share --suite ${seeded.shared}\` fetches it.`,
  );
}

/**
 * Lay a runs record beside a snapshot just copied from the base, saying where
 * each of its tests last ran.
 *
 * The primary checkout's record is the recording of `main` as of its last run,
 * and it is what every worktree starts from, so a test the worktree has not run
 * last ran where that record says it did. The runs record beside it says that
 * per test, and it is carried rather than worked out again: `commit`, `over`,
 * `files` and `standing` as the base wrote them. Without it the worktree's first
 * partial run finds no record to carry `standing` forward from, and until a run
 * observes every test, a test it did not run is read from the worktree's own
 * first commit — which skips it after a change it never ran against.
 *
 * A copy, and nothing added to it: an entry the base marked assumed stays
 * marked, and a test the base's record does not place is read from the base's
 * `over`, as the base reads it. The worktree's first run lists that test at the
 * copy's `over`, marked assumed, as the base's next run would (see `landRun`).
 *
 * Nothing is seeded when the base has no runs record, or one naming another
 * commit than its snapshot — a landing replaced the snapshot and listed no
 * run. A snapshot names the commit of its latest run, not of every test in it,
 * so a seed built from it would record a guess. The worktree's reading then
 * says, on the line under the one naming whose record it read, how many tests
 * it could not place and where it read them from.
 *
 * `runs` is 0, so the worktree's first run at the same commit is not counted
 * as another run of the base's — see `landRun` — and a review still finds that
 * no run of this checkout has listed itself.
 *
 * The record is linked into place rather than renamed over it, so a runs record
 * already beside the snapshot when the link is made is kept. That protects this
 * file only: the snapshot and its case index are copied by {@link seedFrom}.
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
  const at = new Date().toISOString();
  const record: CommitRuns = { ...held, first: at, latest: at, runs: 0 };
  await writeCoverageOnce(commitRunsFile(file), Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
}

/**
 * Copy `name` from under `base` to `target` unless `target` is already there,
 * as `opens` returns the bytes, and unless it refuses them. No base and an
 * unreadable one are the same answer: nothing to inherit. Says whether it
 * copied.
 */
async function seedFrom(
  base: string,
  name: string,
  target: string,
  opens: (bytes: Uint8Array) => Uint8Array,
): Promise<boolean> {
  // FIXME: the check and the copy are two steps, so two first writes in one
  // worktree can both find `target` missing, and the later copy replaces a
  // snapshot the earlier one already landed a run on.
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
    await writeCoverageBytes(target, opens(bytes));
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
 * A reader asks what is known, and in a checkout that has not run yet what is
 * known is the base its first run would be laid on, in the order
 * {@link seedTestCoverage} lays it: this checkout's own record, else the
 * mainline's as last fetched on this machine, else, in a worktree, the primary
 * checkout's. Reading is not first use — a question about the index should not
 * cost the asker a copy of it — so this resolves rather than seeds, and the copy
 * happens when a run lands, which is the moment the checkout acquires something
 * of its own to keep.
 *
 * The path is returned even when no layer holds a file, so a caller that wants
 * to say which file it could not read has one to name: this checkout's own.
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
 * The cases a reader opens are the ones in this snapshot, never the nearest
 * layer's that has some: cases answer for the record they were laid in. A
 * record that keeps none has no recorded cases, and the layer under it is not
 * asked.
 */
export function nearestTestCoverage(root: string, options: RecordLocationOptions = {}): string {
  const inside = recordPath(root, options.suite);
  const [own, ...under] = layeredFiles(repositoryLayers(root, options.cacheRoot), inside);
  if (present(own!)) return own!;
  // The fetched record is the base only when the first run here would lay it:
  // one this build does not read is passed over, as seeding passes it over.
  const suite = /^suites\/([^/]+)\//u.exec(inside)?.[1];
  const fetched = suite === undefined ? undefined : lastFetchedMainline(root, suite, options.cacheRoot);
  if (fetched !== undefined) return fetched.coverage;
  for (const file of under) if (present(file)) return file;

  return own!;
}

function present(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch (error) {
    if (!missing(error)) throw error;
    return false;
  }
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
 *
 * Only for a file that may go unwritten. A link that fails for any reason is
 * not an error: the path is already somebody's, or the file system has no hard
 * links (FAT, exFAT, SMB, some FUSE mounts). A reader finding no file says so.
 */
async function writeCoverageOnce(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await link(temporary, file).catch(() => {});
  await unlink(temporary).catch(() => {});
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
