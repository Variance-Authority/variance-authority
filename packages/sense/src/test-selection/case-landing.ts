/**
 * The case index beside a snapshot, laid one run at a time.
 *
 * Two writers lay runs on it. A reporter lays the run it just folded from its
 * case journals; a landing lays the runs of the shards it folded into the
 * snapshot, from the index each shard's seam left beside its own snapshot.
 * Both go through {@link layCaseRun}, so a shard landed on a laptop leaves the
 * index, its last run and its before layer as the same run recorded there
 * would have.
 */

import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layerBefore, layerCaseIndex } from './case-layer.js';
import { openSetExecutionIndex } from './execution-set-format.js';
import { busyIndex, withIndexLock, type IndexLock } from './index-lock.js';
import { codeUnitOrder, isMissing } from './instrumented-modules.js';
import { writeCoverageBytes } from './record-location.js';
import type { CoverageTest } from './index.js';

/** What a run tells the case index about the files it was handed. */
export interface LaidRun {
  /** Every test file the run was handed, and whether it ran to the end. */
  readonly tests: readonly Pick<CoverageTest, 'file' | 'complete'>[];
  /** The commit the run was made at, as the snapshot carries it. */
  readonly commit?: string;
}

/**
 * The run that wrote the case index last. Its cases are in the index itself,
 * as that run left them, so this names them and holds nothing else.
 */
export interface LastCaseRun {
  readonly commit?: string;
  /**
   * The commit the cases in the before layer were recorded at: the commit of
   * the run that wrote the index before the first run at this one. Absent
   * when that run named none, and when a run at this commit ran a file again,
   * because that file's before is then this commit's own.
   */
  readonly before?: string;
  readonly at: string;
  /** Every test file the runs at this commit announced, so a run can tell whether it ran one again. */
  readonly files: readonly string[];
  /** The cases the last run recorded, by id. */
  readonly cases: readonly string[];
}

/**
 * The two layers kept beside a case index: the run that wrote it last, and what
 * the index held for that run's files before it landed.
 */
export function caseLayerFiles(file: string): { readonly last: string; readonly before: string } {
  const stem = file.endsWith('.bin') ? file.slice(0, -'.bin'.length) : file;
  return { last: `${stem}.last.json`, before: `${stem}.before.bin` };
}

/**
 * Lay one run's case index over the index `lock` is held on, and name the run
 * in the two layers beside it.
 *
 * `fresh` is the run's own index: the cases it recorded and the regions they
 * called. The files the run finished are replaced, every other case is carried
 * — see {@link layerCaseIndex}. A run at the commit the last one was made at is
 * one more invocation of the same suite, not a new change, so what the runs
 * before it retired stays under what this one retired.
 */
export async function layCaseRun(
  lock: IndexLock,
  fresh: Uint8Array,
  root: string,
  run: LaidRun,
): Promise<void> {
  if (!lock.held) throw new Error(`a case index is laid under its lock, and ${lock.file}'s was released`);
  const file = lock.file;
  const layers = caseLayerFiles(file);
  const ran = new Set(run.tests.map((test) => test.file));
  const { merged, last, before: retired } = layerCaseIndex(await readIfThere(file), fresh, {
    ran,
    finished: new Set(run.tests.filter((test) => test.complete).map((test) => test.file)),
    present: (test) => existsSync(resolve(root, test)),
  });
  const prior = await readLastRun(layers.last);
  const again = run.commit !== undefined && prior?.commit === run.commit;
  const before = again ? layerBefore(await readIfThere(layers.before), retired, ran) : retired;
  const at = again ? (prior.files.some((test) => ran.has(test)) ? undefined : prior.before) : prior?.commit;
  await writeCoverageBytes(file, merged);
  const files = [...ran].sort(codeUnitOrder);
  const named: LastCaseRun = {
    ...(run.commit === undefined ? {} : { commit: run.commit }),
    ...(before === undefined || at === undefined ? {} : { before: at }),
    at: new Date().toISOString(),
    files: again ? [...new Set([...prior.files, ...files])].sort(codeUnitOrder) : files,
    cases: last,
  };
  await writeCoverageBytes(layers.last, Buffer.from(`${JSON.stringify(named, null, 2)}\n`));
  // Absent is not empty: with no index to take them from, there is no before.
  if (before === undefined) await rm(layers.before, { force: true });
  else await writeCoverageBytes(layers.before, before);
}

/** One shard a landing folded: where its snapshot is, and the runs it names. */
export interface LandedShard {
  readonly path: string;
  readonly coverage: LaidRun;
}

/** What a landing did to the case index beside the snapshot it wrote. */
export type CaseLanding =
  /** `shards` case indexes were laid over the one at `laid`, in the order they were named. */
  | { readonly laid: string; readonly shards: number }
  /**
   * A shard that finished a test file left no case index this build can lay, so
   * no index can answer for that file's cases. `removed` says whether one was
   * there to remove.
   */
  | { readonly unanswered: string; readonly shard: string; readonly removed: boolean }
  /** Another process held the index, which was left as it was. */
  | { readonly busy: string; readonly reason: string };

/**
 * Keep the case index beside `record` answering for the snapshot a landing
 * wrote there.
 *
 * Each shard's seam left its cases at `<shard>.cases.bin`, as it does beside
 * any snapshot it records. They are laid over the index in the order the
 * shards were named, each as the run it was.
 *
 * A shard that finished a test file and left no index this build can open
 * recorded cases nobody can read back. The index cannot say which cases of
 * that file walk a line, and the cases it still holds for that file are an
 * earlier run's. So the index and its two layers are removed, and a reader says
 * nothing is recorded rather than answer from cases the snapshot beside it
 * replaced. A shard that finished no file is skipped: its seam writes no index
 * for such a run either, and laying it would change nothing.
 */
export async function landCaseIndexes(
  record: string,
  root: string,
  shards: readonly LandedShard[],
): Promise<CaseLanding> {
  const file = `${record}.cases.bin`;
  const runs: { readonly fresh: Uint8Array; readonly coverage: LaidRun }[] = [];
  for (const shard of shards) {
    const fresh = await layableIndex(`${shard.path}.cases.bin`);
    if (fresh !== undefined) runs.push({ fresh, coverage: shard.coverage });
    else if (shard.coverage.tests.some((test) => test.complete)) return removeCaseIndex(file, record, shard.path);
  }
  if (runs.length === 0) return { laid: file, shards: 0 };

  const written = await withIndexLock(file, async (lock) => {
    for (const run of runs) await layCaseRun(lock, run.fresh, root, run.coverage);
  });
  return written.held ? { laid: file, shards: runs.length } : { busy: file, reason: busyIndex(file) };
}

async function removeCaseIndex(file: string, record: string, shard: string): Promise<CaseLanding> {
  const layers = caseLayerFiles(file);
  const stale = [file, layers.last, layers.before, `${record}.cases.json`].filter((path) => existsSync(path));
  if (stale.length === 0) return { unanswered: file, shard, removed: false };
  const removed = await withIndexLock(file, async () => {
    await Promise.all(stale.map((path) => rm(path, { force: true })));
  });
  return removed.held ? { unanswered: file, shard, removed: true } : { busy: file, reason: busyIndex(file) };
}

/** The shard's index when it is there and in the spelling a run is laid from. */
async function layableIndex(file: string): Promise<Uint8Array | undefined> {
  const bytes = await readIfThere(file);
  if (bytes === undefined) return undefined;
  try {
    return openSetExecutionIndex(bytes) === undefined ? undefined : bytes;
  } catch {
    return undefined;
  }
}

/** The run that wrote the index last, or `undefined` when none named itself or its name cannot be read. */
async function readLastRun(file: string): Promise<LastCaseRun | undefined> {
  const bytes = await readIfThere(file);
  if (bytes === undefined) return undefined;
  try {
    return JSON.parse(bytes.toString('utf8')) as LastCaseRun;
  } catch {
    return undefined;
  }
}

async function readIfThere(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
