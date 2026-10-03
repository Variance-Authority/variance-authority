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
import type { CoverageModule, CoverageTest } from './index.js';
import type { ExecutionTest } from './reverse.js';

/** What a run tells the case index about the files it was handed. */
export interface LaidRun {
  /** Every test file the run was handed, and whether it ran to the end. */
  readonly tests: readonly Pick<CoverageTest, 'file' | 'complete'>[];
  /** The commit the run was made at, as the snapshot carries it. */
  readonly commit?: string;
  /** The text each module the run recorded was cut from, as its coverage names it; absent when the run measured nothing. */
  readonly modules?: readonly Pick<CoverageModule, 'file' | 'sourceDigest'>[];
}

/** The text each module of a case index was cut from, by file, as the coverage beside the index names it. */
export type ModuleTexts = ReadonlyMap<string, string>;

/** The text of each module `coverage` holds. */
export function textsOf(coverage: Pick<LaidRun, 'modules'> | undefined): ModuleTexts {
  return new Map((coverage?.modules ?? []).map((module) => [module.file, module.sourceDigest]));
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
   * the run that wrote the index before the first run at this one, or, when
   * the record crossed a checkout and names no such run, the commit its
   * snapshot stands at. Absent when neither names one, and when a run at this
   * commit ran a file again, because that file's before is then this commit's
   * own.
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
   * The text each module of the before layer was cut from, by file, as the
   * coverage beside the index it was cut from named it. A reader compares it
   * with the text at `before` and reads no region of a module cut from another
   * text, since those regions stand on lines that commit does not have. A
   * module it does not name was cut from a text nobody here knew. Absent when
   * no run named one, which says nothing either way.
   */
  readonly beforeTexts?: Readonly<Record<string, string>>;
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
 * `held` is the text each module of `previous`'s index was cut from. A module
 * the run recorded from that same text lands its held cases by address, as its
 * rows do; one whose text is not known on both sides lands them only where the
 * two cuts numbered alike.
 *
 * `stands` is the commit the record's snapshot stands at. When `previous`
 * names no last run, as a record that crossed a checkout does, the cases it
 * holds were recorded with that snapshot, so the before layer is named at it.
 *
 * `base` is the index the run's before is cut from, and the texts its modules
 * were cut from, when that is not `previous`: a landing's later shards are laid
 * over the index its earlier ones laid, whose modules they recorded are already
 * cut to the shards' text.
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
  held?: ModuleTexts,
  stands?: string,
  base?: { readonly index: Uint8Array; readonly texts?: ModuleTexts },
): CaseSections {
  const ran = new Set(run.tests.map((test) => test.file));
  const recorded = textsOf(run);
  const { merged, cases, last, announced, before: retired } = layerCaseIndex(previous.index, fresh, {
    ran,
    finished: new Set(run.tests.filter((test) => test.complete).map((test) => test.file)),
    present: (test) => existsSync(resolve(root, test)),
    sameText: (file) => recorded.has(file) && recorded.get(file) === held?.get(file),
    ...(base === undefined ? {} : { base: base.index }),
  });
  const prior = lastCaseRunOf(previous);
  const again = run.commit !== undefined && prior?.commit === run.commit;
  // FIXME: a run at the same commit that is not a later shard of one landing
  // — a second local invocation, or a second landing — has only the index the
  // earlier run laid, whose modules that run recorded are cut to this commit's
  // text, so its before of them is not the base's. `beforeTexts` names that
  // text, and a reader leaves those modules unmeasured rather than compare
  // them; keeping the base's cut of every module would keep a second index.
  const before = again ? layerBefore(previous.before, retired, ran) : retired;
  const beforeTexts = textsOfBefore(before, retired, base === undefined ? held : base.texts, again ? prior.beforeTexts : undefined);
  const at = again ? (prior.files.some((test) => ran.has(test)) ? undefined : prior.before) : prior === undefined ? stands : prior.commit;
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
    ...(beforeTexts === undefined ? {} : { beforeTexts }),
    ...(retired === undefined || began ? { began: true } : {}),
    cases: last,
  };
  const journals = layEyes(previous.eyes, eyes, cases, announced);
  return {
    index: merged,
    last: spelledLast(named),
    // Absent is not empty: with no index to take them from, there is no before.
    ...(before === undefined ? {} : { before }),
    ...(journals === undefined ? {} : { eyes: journals }),
  };
}

/**
 * The text each module of `before` was cut from: `cut`'s for the modules this
 * run retired, since `before` takes their regions from `retired`, and `kept`'s,
 * what the earlier runs at this commit named, for the rest. `undefined` when
 * neither names a text, or `before` is not spelled as sets, which only a
 * layer older than these texts is.
 */
function textsOfBefore(
  before: Uint8Array | undefined,
  retired: Uint8Array | undefined,
  cut: ModuleTexts | undefined,
  kept: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (before === undefined || (cut === undefined && kept === undefined)) return undefined;
  const modules = openSetExecutionIndex(before)?.modules;
  if (modules === undefined) return undefined;
  const ownRegions = new Set(retired === undefined ? [] : openSetExecutionIndex(retired)?.modules.map((module) => module.file));
  const texts: Record<string, string> = {};
  for (const { file } of modules) {
    const text = ownRegions.has(file) ? cut?.get(file) : kept?.[file];
    if (text !== undefined) texts[file] = text;
  }
  return texts;
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

/**
 * One shard a landing folded: where its record is, and the runs it names.
 * `coverage` is absent for a shard whose run instrumented nothing, whose record
 * holds its cases and no coverage.
 */
export interface LandedShard {
  readonly path: string;
  readonly coverage?: LaidRun;
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
 * row spelling is laid the same way, once it is spelled as sets. The last-run
 * layer the landing leaves names every case the shards recorded, since together
 * they are the one run that landed.
 *
 * A shard that finished a test file and kept no cases recorded none, which is
 * what a seam does when it was not asked for them. The record cannot say which
 * cases of that file walk a line, and the cases it still has for that file are
 * an earlier run's. So every case section is dropped, and a reader says nothing
 * is recorded rather than answer from cases the coverage beside them replaced.
 * A shard that finished no file is skipped: its seam keeps no cases for such a
 * run either, and laying it would change nothing.
 *
 * A shard whose run instrumented nothing has no coverage to name its files, and
 * its cases are laid as the run its own last-run section names: the files it
 * ran, each finished, at its commit. Such a run finished every file it was
 * handed, since one that could not finish a file records that file's row as
 * coverage. One that names no last run, as a record that crossed a checkout
 * does, is laid as a run of the files its cases are of, at no commit: those
 * are the files its index answers for, and each case it holds replaces that
 * file's. A shard with neither coverage nor an index this build reads holds
 * nothing to lay.
 *
 * `held` is the text each module of `previous`'s index was cut from, which the
 * coverage beside it names. Each shard laid moves the modules it recorded to
 * its own text, and the next shard is laid over that. Its before layer is not:
 * every shard's is cut from `previous`'s index, at `held`, which is what the
 * cases stood on before any shard ran.
 *
 * `stands` is the commit the record's snapshot stands at, which names the
 * before layer when `previous` names no last run — see {@link layCases}.
 *
 * Nothing is written here. The landing writes the sections into the record it
 * writes, under that record's lock.
 */
export function landCases(
  record: string,
  previous: CaseSections,
  root: string,
  shards: readonly LandedShard[],
  held?: ModuleTexts,
  stands?: string,
): { readonly landing: CaseLanding; readonly sections: CaseSections } {
  let sections = previous;
  const texts = new Map(held ?? []);
  // Every shard's before is cut from the index the landing began with.
  const base = previous.index === undefined ? undefined : { index: previous.index, ...(held === undefined ? {} : { texts: held }) };
  let laid = 0;
  const ran = new Set<string>();
  for (const shard of shards) {
    const kept = caseSectionsAt(shard.path);
    const fresh = layableIndex(kept.index);
    const run = shard.coverage ?? lastRunOf(kept) ?? (fresh === undefined ? undefined : indexRunOf(fresh.tests));
    if (run === undefined) continue;
    if (fresh !== undefined) {
      // A section this build cannot read is laid as a shard that opened none.
      sections = layCases(sections, fresh.bytes, root, run, readableEyes(kept.eyes), texts, stands, base);
      for (const [file, text] of textsOf(run)) texts.set(file, text);
      for (const id of lastCaseRunOf(sections)?.cases ?? []) ran.add(id);
      laid += 1;
    } else if (run.tests.some((test) => test.complete)) {
      const removed = Object.values(previous).some((part) => part !== undefined);
      return { landing: { unanswered: record, shard: shard.path, removed }, sections: {} };
    }
  }
  return { landing: { laid: record, shards: laid }, sections: laid > 1 ? lastOfEveryShard(sections, ran) : sections };
}

/**
 * The sections with the last-run layer naming every case the landing's shards
 * recorded, not only the last shard's: the shards are one run, and `covering
 * --cases last` answers from the whole of it. A case a later shard's run
 * retired is not in the index, and is not named. The sections are what
 * `layCases` wrote, which always holds a last-run layer and an index it opened.
 */
function lastOfEveryShard(sections: CaseSections, ran: ReadonlySet<string>): CaseSections {
  const last = lastCaseRunOf(sections)!;
  const index = openSetExecutionIndex(sections.index!)!;
  const cases = index.tests.flatMap((test) => (ran.has(test.id) ? [test.id] : []));
  return { ...sections, last: spelledLast({ ...last, cases }) };
}

/** The last-run section's bytes. */
function spelledLast(named: LastCaseRun): Buffer {
  return Buffer.from(`${JSON.stringify(named, null, 2)}\n`);
}

/** The run a shard's own last-run section names, every file of it finished; `undefined` when it names none. */
function lastRunOf(kept: CaseSections): LaidRun | undefined {
  const last = lastCaseRunOf(kept);
  if (last === undefined) return undefined;
  return {
    tests: last.files.map((file) => ({ file, complete: true })),
    ...(last.commit === undefined ? {} : { commit: last.commit }),
  };
}

/** A run of the files an index's cases are of, each finished. */
function indexRunOf(tests: readonly ExecutionTest[]): LaidRun {
  return { tests: [...new Set(tests.map((test) => test.file))].sort(codeUnitOrder).map((file) => ({ file, complete: true })) };
}

/** The shard's index spelled as sets, with its cases, when it has one this build can read. */
function layableIndex(bytes: Uint8Array | undefined): { readonly bytes: Uint8Array; readonly tests: readonly ExecutionTest[] } | undefined {
  if (bytes === undefined) return undefined;
  try {
    const opened = openSetExecutionIndex(bytes);
    if (opened !== undefined) return { bytes, tests: opened.tests };
    const rows = decodeExecutionIndex(bytes);
    return { bytes: encodeAsSetExecutionIndex(rows), tests: rows.tests };
  } catch {
    return undefined;
  }
}
