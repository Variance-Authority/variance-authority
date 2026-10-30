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
import { codeUnitOrder } from '@variance-authority/core/segment';
import { layerBefore, layerCaseIndex } from './case-layer.js';
import { layReadings } from './case-readings.js';
import { caseSectionsAt, type CaseSections } from './case-record.js';
import { decodeExecutionIndex, decodeExecutionTests } from './execution-format.js';
import { encodeAsSetExecutionIndex, openSetExecutionIndex } from './execution-set-format.js';
import { layEyes, readableEyes, type EyesSection } from './eyes-record.js';
import { editsBetween } from './region-edit.js';
import type { TestCoverageView } from './format-view.js';
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

/** {@link textsOf} over a snapshot's columns. */
export function textsIn(coverage: TestCoverageView): ModuleTexts {
  const path = coverage.modulePath.all();
  const source = coverage.moduleSource.all();
  return new Map(Array.from(path, (file, module) => [coverage.string(file), coverage.string(source[module]!)]));
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
 * `held` is the text the snapshot names each module of `previous`'s index at,
 * which is the text it was cut from. A module the run recorded from another
 * text lands its held cases through the edit between the two: the regions the
 * edit left alone keep them, at the lines it places them, and the regions it
 * touched keep them only where the edit's reading spares their kind. A module whose text is not known on both sides, or not
 * found, is read as changed whole.
 *
 * `stands` is the commit the record's snapshot stands at. When `previous`
 * names no last run, as a record that crossed a checkout does, the cases it
 * holds were recorded with that snapshot, so the before layer is named at it.
 *
 * `base` is the index the run's before is cut from, and the texts its modules
 * were cut from, when that is not `previous`: a landing's later shards are laid
 * over the index its earlier ones laid, whose modules they recorded are already
 * cut to the shards' text. `recorded` is the text each module those earlier
 * shards recorded was recorded from.
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
  base?: { readonly index: Uint8Array; readonly texts?: ModuleTexts; readonly recorded?: ModuleTexts },
  cacheRoot?: string,
): CaseSections {
  const ran = new Set(run.tests.map((test) => test.file));
  const recorded = textsOf(run);
  const edits = editsBetween(root, cacheRoot, [stands, run.commit]);
  const sameText = (file: string): boolean => recorded.has(file) && recorded.get(file) === held?.get(file);
  const { merged, cases, last, announced, before: retired, unlined } = layerCaseIndex(previous.index, fresh, {
    ran,
    finished: new Set(run.tests.filter((test) => test.complete).map((test) => test.file)),
    present: (test) => existsSync(resolve(root, test)),
    edit: (file) => {
      const [from, to] = [held?.get(file), recorded.get(file)];
      return from === undefined || to === undefined ? undefined : edits(file, from, to);
    },
    sameText,
    ...(base === undefined ? {} : {
      base: base.index,
      sameBeforeText: new Set([...recorded.keys(), ...(base.recorded?.keys() ?? [])].filter((file) => {
        const text = recorded.get(file) ?? base.recorded?.get(file);
        return text !== undefined && text === base.texts?.get(file);
      })),
    }),
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
  const beforeTexts = textsOfBefore(
    before,
    retired,
    base === undefined ? held : base.texts,
    again ? prior.beforeTexts : undefined,
    new Set(unlined),
  );
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
  const readings = layReadings(previous.readings, previous.index, fresh, merged, new Set(cases()), sameText);
  return {
    index: merged,
    last: spelledLast(named, merged),
    // Absent is not empty: with no index to take them from, there is no before.
    ...(before === undefined ? {} : { before }),
    ...(journals === undefined ? {} : { eyes: journals }),
    ...(readings === undefined ? {} : { readings }),
  };
}

/**
 * The text each module of `before` was cut from: `cut`'s for the modules this
 * run retired, since `before` takes their regions from `retired`, and `kept`'s,
 * what the earlier runs at this commit named, for the rest. `undefined` when
 * neither names a text, or `before` is not spelled as sets, which only a
 * layer older than these texts is. A module `unlined` holds names none,
 * whichever run retired it: the landing's index cut it at another text than
 * `cut` names, and its lines could not be carried, so an earlier run at this
 * commit that kept it at those lines named a text they do not stand at.
 */
function textsOfBefore(
  before: Uint8Array | undefined,
  retired: Uint8Array | undefined,
  cut: ModuleTexts | undefined,
  kept: Readonly<Record<string, string>> | undefined,
  unlined: ReadonlySet<string>,
): Record<string, string> | undefined {
  if (before === undefined || (cut === undefined && kept === undefined)) return undefined;
  const modules = openSetExecutionIndex(before)?.modules;
  if (modules === undefined) return undefined;
  const ownRegions = new Set(retired === undefined ? [] : openSetExecutionIndex(retired)?.modules.map((module) => module.file));
  const texts: Record<string, string> = {};
  for (const { file } of modules) {
    const text = unlined.has(file) ? undefined : ownRegions.has(file) ? cut?.get(file) : kept?.[file];
    if (text !== undefined) texts[file] = text;
  }
  return texts;
}

/** The run that wrote the case index last, or `undefined` when none named itself or its name cannot be read. */
export function lastCaseRunOf(sections: CaseSections): LastCaseRun | undefined {
  if (sections.last === undefined) return undefined;
  try {
    const run = JSON.parse(Buffer.from(sections.last).toString('utf8')) as Omit<LastCaseRun, 'cases'> & {
      readonly cases: readonly string[] | { readonly references: readonly (number | string)[] };
    };
    if (run === null || !Array.isArray(run.files)) return undefined;
    if (Array.isArray(run.cases)) return run.cases.every((id) => typeof id === 'string') ? { ...run, cases: run.cases } : undefined;
    const references = (run.cases as { readonly references?: unknown } | undefined)?.references;
    if (!Array.isArray(references)) return undefined;
    const tests = references.some((id) => typeof id === 'number') ? decodeExecutionTests(sections.index!) : [];
    const cases = references.map((id: unknown) => {
      if (typeof id === 'string') return id;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || tests[id] === undefined) throw new Error('unresolved last-run case row');
      return tests[id]!.id;
    });
    return { ...run, cases };
  } catch {
    return undefined;
  }
}

/**
 * The cases the run that wrote `sections` last executed, by test file, each
 * file's in code-unit order: the ones it laid, which the runs record names of
 * the files that run finished only in part (`landings.ts`). The sections are
 * what `layCases` or `landCases` wrote, whose last-run layer names only cases
 * its index holds.
 */
export function casesRan(sections: CaseSections): ReadonlyMap<string, readonly string[]> {
  const last = new Set(lastCaseRunOf(sections)!.cases);
  const ran = new Map<string, string[]>();
  if (last.size === 0) return ran;
  for (const test of decodeExecutionTests(sections.index!)) {
    if (last.has(test.id)) ran.set(test.file, [...(ran.get(test.file) ?? []), test.id]);
  }
  for (const ids of ran.values()) ids.sort(codeUnitOrder);
  return ran;
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
   * Shards that finished a test file kept no cases this build can read, so
   * the record at `unanswered` can answer for none of those files' cases.
   * `removed` says whether it held any to drop.
   */
  | { readonly unanswered: string; readonly shards: readonly string[]; readonly removed: boolean }
  /**
   * `shards` shards kept cases the record at `unlaid` did not take: it held no
   * case index, and they did not finish `unfinished`, test files its snapshot
   * holds, so their cases alone would answer for those files too
   * ({@link unansweredOver}). The record still holds no index.
   */
  | { readonly unlaid: string; readonly shards: number; readonly unfinished: readonly string[] };

/**
 * Whether a run that kept no cases leaves the record none: it does once the
 * run finished a test file. The cases the record holds of that file are an
 * earlier run's, so the index cannot say which of them run a line now, and
 * dating them by this run would say it ran them. Every case section goes, not
 * that file's alone: an index is read as every case of the snapshot beside it,
 * by this build and by an older one, so an index holding no case of a file the
 * snapshot holds says that file's cases run no line. With no index a reader
 * says nothing is recorded. A run that finished no file changes nothing: a seam
 * keeps no cases for it either.
 */
export function dropsCasesWithoutAny(run: Pick<LaidRun, 'tests'>): boolean {
  return run.tests.some((test) => test.complete);
}

/**
 * The test files of `snapshot` that cases laid over `previous`, by runs of
 * `tests`, would answer for without having run them; empty when they answer
 * for none they did not run.
 *
 * An index is read as every case of the snapshot beside it. Laid over one, a
 * file the runs did not finish keeps the cases the index holds of it. Laid
 * over none, it would have none, and the runs' own cases would stand for the
 * whole suite. So over no index they are laid only once the runs finished
 * every test file `snapshot` holds that the checkout still has. With no
 * snapshot there is no other file to answer for.
 */
export function unansweredOver(
  previous: CaseSections,
  snapshot: readonly { readonly file: string }[] | undefined,
  tests: readonly Pick<CoverageTest, 'file' | 'complete'>[],
  root: string,
): readonly string[] {
  if (previous.index !== undefined || snapshot === undefined) return [];
  const finished = new Set(tests.flatMap((test) => (test.complete ? [test.file] : [])));
  return snapshot
    .flatMap(({ file }) => (finished.has(file) || !existsSync(resolve(root, file)) ? [] : [file]))
    .sort(codeUnitOrder);
}

/**
 * The case sections of `record` once a landing lays its shards' cases into it,
 * and what that did. Each shard is laid over `previous`, the sections the record
 * held, as the run it was, in the order the shards were named. Nothing is
 * written here: the landing writes the sections under the record's lock.
 */
export function landCases(
  record: string,
  previous: CaseSections,
  root: string,
  shards: readonly LandedShard[],
  held?: ModuleTexts,
  stands?: string,
  cacheRoot?: string,
  snapshot?: readonly { readonly file: string }[],
): { readonly landing: CaseLanding; readonly sections: CaseSections } {
  let sections = previous;
  // `held` is the text each module of `previous`'s index was cut from. A shard
  // laid moves the modules it recorded to its own text; the next is laid over that.
  const texts = new Map(held ?? []);
  const recorded = new Map<string, string>();
  // Every shard's before is cut from the index the landing began with, at
  // `held`: what the cases stood on before any shard ran.
  const base = previous.index === undefined ? undefined : { index: previous.index, ...(held === undefined ? {} : { texts: held }) };
  let laid = 0;
  const ran = new Set<string>();
  const tests: Pick<CoverageTest, 'file' | 'complete'>[] = [];
  for (const shard of shards) {
    // A shard's seam kept its cases in the shard's own record. One whose run
    // instrumented nothing is laid as the run its last-run section names, or
    // its index's files; one with neither holds nothing to lay.
    const kept = caseSectionsAt(shard.path);
    const fresh = layableIndex(kept.index);
    const run = shard.coverage ?? lastRunOf(kept) ?? (fresh === undefined ? undefined : indexRunOf(fresh.tests));
    if (run === undefined) continue;
    if (fresh !== undefined) {
      // A section this build cannot read is laid as a shard that opened none.
      // `stands`, the commit the snapshot stands at, names the before layer when
      // `previous` names no last run, and is where a text not kept is looked for.
      sections = layCases(sections, fresh.bytes, root, run, readableEyes(kept.eyes), texts, stands, base && { ...base, recorded: new Map(recorded) }, cacheRoot);
      for (const [file, text] of textsOf(run)) {
        texts.set(file, text);
        recorded.set(file, text);
      }
      for (const id of lastCaseRunOf(sections)?.cases ?? []) ran.add(id);
      tests.push(...run.tests);
      laid += 1;
    } else if (dropsCasesWithoutAny(run)) {
      // It finished a file and kept no cases, as a seam not asked for them does.
      // A shard that finished none is skipped: laying it would change nothing.
      const removed = Object.values(previous).some((part) => part !== undefined);
      return { landing: { unanswered: record, shards: [shard.path], removed }, sections: {} };
    }
  }
  // Over no index, the cases land only once the shards finished every test file
  // of `snapshot`, the record's snapshot; otherwise the landing names the rest.
  const unfinished = laid === 0 ? [] : unansweredOver(previous, snapshot, tests, root);
  if (unfinished.length > 0) return { landing: { unlaid: record, shards: laid, unfinished }, sections: previous };
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
  return { ...sections, last: spelledLast({ ...last, cases }, sections.index!) };
}

/** The last-run section: references into its index, with an exact identity for a case the index no longer holds. */
function spelledLast(named: LastCaseRun, index: Uint8Array): Buffer {
  const rows = new Map(decodeExecutionTests(index).map((test, at) => [test.id, at]));
  // References name this index's case rows, never files inferred from them.
  // An identity the index retired remains exact rather than disappearing.
  const references = named.cases.map((id) => rows.get(id) ?? id);
  return Buffer.from(`${JSON.stringify({ ...named, cases: { references } }, null, 2)}\n`);
}

/**
 * The run a shard's own last-run section names, every file of it finished;
 * `undefined` when it names none. A shard whose run instrumented nothing
 * finished every file it was handed: one it could not finish records that
 * file's row as coverage.
 */
function lastRunOf(kept: CaseSections): LaidRun | undefined {
  const last = lastCaseRunOf(kept);
  if (last === undefined) return undefined;
  return {
    tests: last.files.map((file) => ({ file, complete: true })),
    ...(last.commit === undefined ? {} : { commit: last.commit }),
  };
}

/**
 * A run of the files an index's cases are of, each finished, at no commit: a
 * shard's that names no last run, as a record that crossed a checkout does.
 * Those are the files its index answers for, and each case replaces its file's.
 */
function indexRunOf(tests: readonly ExecutionTest[]): LaidRun {
  return { tests: [...new Set(tests.map((test) => test.file))].sort(codeUnitOrder).map((file) => ({ file, complete: true })) };
}

/**
 * The shard's index spelled as sets, with its cases, when it has one this build can read.
 *
 * FIXME: a shard whose index is spelled as rows, or as sets by a build before
 * `blocks.owner`, is laid with no owners, so a region born in it takes none
 * of its owner's cases.
 */
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
