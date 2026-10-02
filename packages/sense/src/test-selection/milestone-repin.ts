/**
 * Move a checkout's record onto a newer milestone, keeping the tests it ran.
 *
 * A checkout's record is the milestone it was laid on with its own runs
 * folded in, and its ledger (`own-layer.ts`) says which tests are whose. When
 * a fetch brings a newer snapshot of the mainline, the record is rebuilt from
 * that snapshot's bytes with this checkout's tests laid over it, the way a
 * run's are: their rows, their crossings, their cases and their cases' Eyes
 * journals replace the milestone's, and every other test is the new
 * milestone's, unaltered.
 *
 * Only forward along HEAD's history. The new snapshot must be an ancestor of
 * HEAD and descend from the pinned one; a snapshot of a commit this branch
 * does not contain is someone else's base, and a pin git cannot place is
 * kept. A test this checkout ran over a state that does not descend from the
 * new milestone ran over older code than it, and the milestone answers for it.
 *
 * The milestone's own files are read and never written.
 */

// compass: variance-authority.reach

import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { carriedSources } from './carried-sources.js';
import { caseSectionsOf, withCaseSections } from './case-record.js';
import { layerCaseIndex } from './case-layer.js';
import { commitRunsFile, readCommitRuns, writeCommitRuns, type CommitRuns, type StandingEntry } from './commit-runs.js';
import { decodeSetExecutionIndex, encodeAsSetExecutionIndex, openSetExecutionIndex } from './execution-set-format.js';
import { layEyes, readableEyes } from './eyes-record.js';
import { decodeTestCoverage } from './format.js';
import { layerTestCoverage } from './format-layer.js';
import { openTestCoverage, wholeCoverage } from './format-view.js';
import { withIndexLock } from './index-lock.js';
import type { TestCoverage } from './index.js';
import { codeUnitOrder } from './instrumented-modules.js';
import type { LastFetched } from './mainline-layer.js';
import { readOwnLayer, writeOwnLayer, type OwnLayer, type OwnState } from './own-layer.js';
import { writeCoverageBytes } from './record-location.js';

/** What {@link repinOwnLayer} did, and why it left the pin when it did. */
export type Repin =
  | { readonly repinned: true; readonly from: string; readonly to: string; readonly kept: readonly string[]; readonly dropped: readonly string[] }
  | { readonly repinned: false; readonly why: RepinRefusal };

/** Why {@link repinOwnLayer} left the record on the milestone it stands on. */
export type RepinRefusal =
  /** The record has no ledger, or the ledger names no milestone: there is nothing to move. */
  | 'unpinned'
  /** The record already stands on this milestone. */
  | 'current'
  /** The fetched snapshot is of another mainline than the pinned one. */
  | 'other-mainline'
  /** HEAD does not contain the fetched snapshot's commit. */
  | 'not-ancestor'
  /** The fetched snapshot does not descend from the pinned one: it is older, or on another line. */
  | 'behind'
  /** Git could not say: a shallow clone, or a commit this clone lacks. */
  | 'unknown'
  /** Another process holds the record. */
  | 'busy'
  /** The record or the snapshot does not read in this build. */
  | 'unreadable';

/**
 * Re-base the record at `coverageFile` in the checkout at `root` onto `record`
 * when the rules above allow, under the record's lock. The ledger is written
 * last: a process killed before it leaves the old ledger beside the new
 * record, which only over-claims tests as this checkout's.
 */
export async function repinOwnLayer(coverageFile: string, record: LastFetched, root: string): Promise<Repin> {
  const layer = await readOwnLayer(coverageFile);
  const refused = refusal(layer, record, root);
  if (refused !== undefined) return { repinned: false, why: refused };
  const locked = await withIndexLock(coverageFile, () => repin(coverageFile, record, root, layer!));
  return locked.held ? locked.value : { repinned: false, why: 'busy' };
}

function refusal(layer: OwnLayer | undefined, record: LastFetched, root: string): RepinRefusal | undefined {
  const pinned = layer?.pinned;
  if (pinned === undefined) return 'unpinned';
  if (pinned.commit === record.commit) return 'current';
  if (pinned.mainline !== record.mainline) return 'other-mainline';
  const contained = ancestor(root, record.commit, 'HEAD');
  if (contained === undefined) return 'unknown';
  if (!contained) return 'not-ancestor';
  const ahead = ancestor(root, pinned.commit, record.commit);
  if (ahead === undefined) return 'unknown';
  return ahead ? undefined : 'behind';
}

async function repin(coverageFile: string, record: LastFetched, root: string, layer: OwnLayer): Promise<Repin> {
  let ownBytes: Buffer;
  let own: TestCoverage;
  let milestone: Buffer;
  let instrumentation: string;
  try {
    ownBytes = await readFile(coverageFile);
    own = decodeTestCoverage(ownBytes);
    milestone = await readFile(record.coverage);
    // A milestone the layer cannot open whole would be laid as nothing, and
    // the record would lose every row this checkout did not run.
    const whole = wholeCoverage(milestone);
    if (whole === undefined) return { repinned: false, why: 'unreadable' };
    // Rows recorded under other probes cannot be laid over the milestone's:
    // it answers for every test.
    instrumentation = whole.view.instrumentation;
  } catch {
    return { repinned: false, why: 'unreadable' };
  }
  // A state git cannot place is answered by the milestone: a wider read,
  // never one that skips. So is a test the ledger lists and the record holds
  // no row of, which a run under other probes left behind.
  const held = new Set(own.tests.map((test) => test.file));
  const states = instrumentation !== own.instrumentation ? [] : layer.ran
    .filter((state) => ancestor(root, record.commit, state.commit) === true)
    .map((state) => ({ ...state, files: state.files.filter((file) => held.has(file)) }))
    .filter((state) => state.files.length > 0);
  const kept = new Set(states.flatMap((state) => state.files));
  const dropped = [...new Set(layer.ran.flatMap((state) => state.files))].filter((file) => !kept.has(file));
  // Under the milestone's probes, so a subset of nothing lays the milestone as it is.
  const subset = { ...ownSubset(own, kept), instrumentation };
  const bytes = layerTestCoverage(milestone, subset, await carriedSources(root, milestone, subset));

  const ownCases = caseSectionsOf(ownBytes);
  const milestoneCases = caseSectionsOf(milestone);
  const cases = repinnedCases(milestoneCases.index, ownCases.index, kept);
  const eyes = repinnedEyes(milestoneCases.eyes, ownCases, cases, kept);
  const view = openTestCoverage(bytes);
  const recorded = Array.from(view.testPath.all(), (path) => view.string(path));
  const runs = repinnedRuns(await readCommitRuns(coverageFile), own.commit, record, states, recorded, kept);

  // The snapshot first: its new rows beside the old runs record read the
  // milestone's tests from the old pin, which only widens, where the new runs
  // record beside the old rows would read changes since the old pin as
  // nobody's. The cases go in the same write; the last run and what it laid
  // over describe a run over the old pin and go with it.
  await writeCoverageBytes(coverageFile, withCaseSections(bytes, {
    ...(cases === undefined ? {} : { index: cases }),
    ...(eyes === undefined ? {} : { eyes }),
  }));
  if (runs === undefined) await rm(commitRunsFile(coverageFile), { force: true });
  else await writeCommitRuns(commitRunsFile(coverageFile), runs);
  await writeOwnLayer(coverageFile, { pinned: { mainline: record.mainline, commit: record.commit }, ran: states });
  return { repinned: true, from: layer.pinned!.commit, to: record.commit, kept: [...kept], dropped };
}

/**
 * The rows of `own` that `tests` answer for, as a run of those tests would
 * have laid them: their test rows, and every module with only their
 * crossings. A module none of them entered is left out, so the milestone's
 * row of it stands.
 */
function ownSubset(own: TestCoverage, tests: ReadonlySet<string>): TestCoverage {
  const modules = own.modules.flatMap((module) => {
    const blocks = module.blocks.map((block) => ({
      ...block,
      testFiles: block.testFiles.filter((test) => tests.has(test)),
      ...(block.loadedBy === undefined ? {} : { loadedBy: block.loadedBy.filter((test) => tests.has(test)) }),
    }));
    const entered = blocks.some((block) => block.testFiles.length > 0 || (block.loadedBy?.length ?? 0) > 0);
    return entered ? [{ ...module, blocks }] : [];
  });
  return { ...own, tests: own.tests.filter((test) => tests.has(test.file)), modules };
}

/**
 * The milestone's case index with the cases of `tests` laid over it from the
 * record's own. Without either there is nothing this checkout's cases could
 * be laid on, and the record carries none.
 */
function repinnedCases(milestone: Uint8Array | undefined, own: Uint8Array | undefined, tests: ReadonlySet<string>): Uint8Array | undefined {
  if (own === undefined || openSetExecutionIndex(own) === undefined || tests.size === 0) return milestone;
  const index = decodeSetExecutionIndex(own);
  // Crossings name a case by its position, so the kept cases are renumbered.
  const at = new Map<number, number>();
  const cases = index.tests.filter((test, position) => {
    if (!tests.has(test.file)) return false;
    at.set(position, at.size);
    return true;
  });
  const fresh = encodeAsSetExecutionIndex({
    tests: cases,
    // A module no kept case entered keeps the milestone's layout of it.
    modules: index.modules.flatMap((module) => {
      const blocks = module.blocks.map((block) => ({
        ...block,
        crossings: block.crossings.flatMap((crossing) => {
          const test = at.get(crossing.test);
          return test === undefined ? [] : [{ ...crossing, test }];
        }),
      }));
      return blocks.some((block) => block.crossings.length > 0) ? [{ ...module, blocks }] : [];
    }),
  });
  return layerCaseIndex(milestone, fresh, { ran: tests, finished: tests, present: () => true }).merged;
}

/**
 * The Eyes section once the record stands on the milestone: the journals of
 * the cases of `tests` are the record's own, as a run of them would have laid
 * them, and every other case's are the milestone's. A case the repinned index
 * no longer holds has none, and a section that does not read is none.
 */
function repinnedEyes(
  milestone: Uint8Array | undefined,
  own: { readonly index?: Uint8Array; readonly eyes?: Uint8Array },
  merged: Uint8Array | undefined,
  tests: ReadonlySet<string>,
): Uint8Array | undefined {
  if (merged === undefined || openSetExecutionIndex(merged) === undefined) return undefined;
  const ran = own.index === undefined || openSetExecutionIndex(own.index) === undefined
    ? []
    : decodeSetExecutionIndex(own.index).tests.filter((test) => tests.has(test.file)).map((test) => test.id);
  const ours = new Set(ran);
  const held = readableEyes(own.eyes);
  const fresh = held === undefined ? undefined : {
    watched: held.watched.filter((id) => ours.has(id)),
    journals: held.journals.filter((row) => ours.has(row.case)),
  };
  return layEyes(milestone, fresh, merged, ran);
}

/**
 * The runs record once the record stands on `record`: the runs at its commit
 * as they were, its change now starting at the new milestone, each kept test
 * standing where it last ran, and every other test at the milestone, where
 * the publishing run ran the whole suite.
 */
function repinnedRuns(
  held: CommitRuns | undefined,
  commit: string | undefined,
  record: LastFetched,
  states: readonly OwnState[],
  recorded: readonly string[],
  kept: ReadonlySet<string>,
): CommitRuns | undefined {
  if (held === undefined) return undefined;
  const files = held.files.filter((file) => kept.has(file));
  const here = new Set(files);
  const milestone = recorded.filter((file) => !kept.has(file));
  const standing: StandingEntry[] = [];
  if (milestone.length > 0) standing.push({ commit: record.commit, files: milestone });
  for (const state of states) {
    const rest = state.files.filter((file) => !here.has(file));
    if (rest.length === 0) continue;
    const same = standing.find((entry) => entry.commit === state.commit && entry.assumed === undefined);
    if (same === undefined) standing.push({ commit: state.commit, files: rest });
    else standing.splice(standing.indexOf(same), 1, { commit: same.commit, files: [...same.files, ...rest].sort(codeUnitOrder) });
  }
  // At the snapshot's own commit, which repairs a runs record a crash left
  // naming another.
  return { ...held, ...(commit === undefined ? {} : { commit }), over: record.commit, files, standing };
}

/** Whether `older` is an ancestor of `newer` in `root`, or `undefined` when git cannot say. */
function ancestor(root: string, older: string, newer: string): boolean | undefined {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd: root, stdio: 'ignore' });
    return true;
  } catch (error) {
    return (error as { status?: number }).status === 1 ? false : undefined;
  }
}
