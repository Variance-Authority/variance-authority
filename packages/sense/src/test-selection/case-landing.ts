/**
 * The case sections of a record, laid one run at a time.
 *
 * Two writers lay runs on them. A reporter lays the run it just folded from its
 * case journals; a landing lays the runs of the shards it folded into the
 * record, from the cases each shard's seam kept in its own record. Both go
 * through {@link layCases}, so a shard landed on a laptop leaves the index, its
 * last run and its before layer as the same run recorded there would have.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { layerBefore, layerCaseIndex } from './case-layer.js';
import { caseSectionsAt, type CaseSections } from './case-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeAsSetExecutionIndex, openSetExecutionIndex } from './execution-set-format.js';
import { layEyes, readableEyes, type EyesSection } from './eyes-record.js';
import { codeUnitOrder } from './instrumented-modules.js';
import type { CoverageTest } from './index.js';

/** What a run tells the case index about the files it was handed. */
export interface LaidRun {
  /** Every test file the run was handed, and whether it ran to the end. */
  readonly tests: readonly Pick<CoverageTest, 'file' | 'complete'>[];
  /** The commit the run was made at, as the snapshot carries it. */
  readonly commit?: string;
}

/** One run's own case index, and what the run tells the index about its files. */
export interface FreshCases {
  readonly fresh: Uint8Array;
  readonly run: LaidRun;
  /** The cases that opened Eyes journals and the journals they handed over; absent when no case composed Eyes. */
  readonly eyes?: EyesSection;
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
  /**
   * Files of `files` the before layer cannot answer for: a run at this commit
   * laid them over no index, or over one that began at this commit, and none
   * has run them since. What came before them is not known, which is not the
   * same as no case. Absent when every file has a base.
   */
  readonly unbased?: readonly string[];
  /**
   * True when the first run at this commit was laid over no index, so every
   * case in it began at this commit and a file first run here has no base.
   * Absent when an earlier commit's index was under it.
   */
  readonly began?: true;
  /** The cases the last run recorded, by id. */
  readonly cases: readonly string[];
}

/**
 * The case sections once one run's case index is laid over `previous`, the
 * sections of the record it lands in.
 *
 * `fresh` is the run's own index: the cases it recorded and the regions they
 * called. The files the run finished are replaced, every other case is carried
 * — see {@link layerCaseIndex}. A run at the commit the last one was made at is
 * one more invocation of the same suite, not a new change, so what the runs
 * before it retired stays under what this one retired.
 *
 * `eyes` are the run's Eyes, laid by {@link layEyes}: a case that ran has its
 * journals replaced by the run's, and has none when the run opened none.
 *
 * Nothing is written here. The caller writes the result into the record with
 * the coverage it lands, in one write under the record's lock, so the two
 * always answer for the same runs.
 */
export function layCases(
  previous: CaseSections,
  fresh: Uint8Array,
  root: string,
  run: LaidRun,
  eyes?: EyesSection,
): CaseSections {
  const ran = new Set(run.tests.map((test) => test.file));
  const { merged, last, before: retired } = layerCaseIndex(previous.index, fresh, {
    ran,
    finished: new Set(run.tests.filter((test) => test.complete).map((test) => test.file)),
    present: (test) => existsSync(resolve(root, test)),
  });
  const prior = lastCaseRunOf(previous);
  const again = run.commit !== undefined && prior?.commit === run.commit;
  const before = again ? layerBefore(previous.before, retired, ran) : retired;
  const at = again ? (prior.files.some((test) => ran.has(test)) ? undefined : prior.before) : prior?.commit;
  const files = [...ran].sort(codeUnitOrder);
  // A file laid over no index has no base; running it again at this commit
  // retires this commit's own cases of it, which are then its base. When the
  // index began at this commit, a file none of its runs ran before — the next
  // shard's — has none either, however many of the others have run again.
  const began = again && prior.began === true;
  const unbased = [
    ...(again ? (prior.unbased ?? []).filter((test) => !ran.has(test)) : []),
    ...(retired === undefined ? files : began ? files.filter((test) => !prior.files.includes(test)) : []),
  ].sort(codeUnitOrder);
  const named: LastCaseRun = {
    ...(run.commit === undefined ? {} : { commit: run.commit }),
    ...(before === undefined || at === undefined ? {} : { before: at }),
    at: new Date().toISOString(),
    files: again ? [...new Set([...prior.files, ...files])].sort(codeUnitOrder) : files,
    ...(unbased.length === 0 ? {} : { unbased }),
    ...(retired === undefined || began ? { began: true } : {}),
    cases: last,
  };
  const journals = layEyes(previous.eyes, eyes, merged, last);
  return {
    index: merged,
    last: Buffer.from(`${JSON.stringify(named, null, 2)}\n`),
    // Absent is not empty: with no index to take them from, there is no before.
    ...(before === undefined ? {} : { before }),
    ...(journals === undefined ? {} : { eyes: journals }),
  };
}

/** The run that wrote the case index last, or `undefined` when none named itself or its name cannot be read. */
export function lastCaseRunOf(sections: CaseSections): LastCaseRun | undefined {
  if (sections.last === undefined) return undefined;
  try {
    return JSON.parse(Buffer.from(sections.last).toString('utf8')) as LastCaseRun;
  } catch {
    return undefined;
  }
}

/** One shard a landing folded: where its record is, and the runs it names. */
export interface LandedShard {
  readonly path: string;
  readonly coverage: LaidRun;
}

/** What a landing did to the cases of the record it wrote. */
export type CaseLanding =
  /** `shards` shards' cases were laid into the record at `laid`, in the order they were named. */
  | { readonly laid: string; readonly shards: number }
  /**
   * A shard that finished a test file kept no cases this build can read, so
   * the record at `unanswered` can answer for none of that file's cases.
   * `removed` says whether it held any to drop.
   */
  | { readonly unanswered: string; readonly shard: string; readonly removed: boolean };

/**
 * The case sections of `record` once a landing lays its shards' cases into it,
 * and what that did.
 *
 * Each shard's seam kept its cases in the shard's own record, as it does in any
 * record it writes. They are laid over `previous`, the sections the record held,
 * in the order the shards were named, each as the run it was. An index in the
 * row spelling is laid the same way, once it is spelled as sets.
 *
 * A shard that finished a test file and kept no cases recorded none, which is
 * what a seam does when it was not asked for them. The record cannot say which
 * cases of that file walk a line, and the cases it still has for that file are
 * an earlier run's. So every case section is dropped, and a reader says nothing
 * is recorded rather than answer from cases the coverage beside them replaced.
 * A shard that finished no file is skipped: its seam keeps no cases for such a
 * run either, and laying it would change nothing.
 *
 * Nothing is written here. The landing writes the sections into the record it
 * writes, under that record's lock.
 */
export function landCases(
  record: string,
  previous: CaseSections,
  root: string,
  shards: readonly LandedShard[],
): { readonly landing: CaseLanding; readonly sections: CaseSections } {
  let sections = previous;
  let laid = 0;
  for (const shard of shards) {
    const kept = caseSectionsAt(shard.path);
    const fresh = layableIndex(kept.index);
    if (fresh !== undefined) {
      // FIXME: each shard is laid as a run of its own, so the last-run layer
      // names only the last shard's cases, and `covering --cases last` after a
      // landing answers from that shard rather than from the whole fold.
      // FIXME: the shard's whole Eyes section is laid as its run's, as its
      // whole index is: journals its seed carried from the mainline for cases
      // it never ran land as fresh, and can stand in for a newer shard's.
      // A section this build cannot read is laid as a shard that opened none.
      sections = layCases(sections, fresh, root, shard.coverage, readableEyes(kept.eyes));
      laid += 1;
    } else if (shard.coverage.tests.some((test) => test.complete)) {
      const removed = Object.values(previous).some((part) => part !== undefined);
      return { landing: { unanswered: record, shard: shard.path, removed }, sections: {} };
    }
  }
  return { landing: { laid: record, shards: laid }, sections };
}

/** The shard's index spelled as sets, when it has one this build can read. */
function layableIndex(bytes: Uint8Array | undefined): Uint8Array | undefined {
  if (bytes === undefined) return undefined;
  try {
    return openSetExecutionIndex(bytes) === undefined ? encodeAsSetExecutionIndex(decodeExecutionIndex(bytes)) : bytes;
  } catch {
    return undefined;
  }
}
