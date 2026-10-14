/**
 * The case sections of a record, laid one run at a time.
 *
 * Two writers lay runs on them. A reporter lays the run it just folded from its
 * case journals; a landing lays the runs of the shards it folded into the
 * record, from the cases each shard's seam kept in its own record. Both go
 * through {@link layCases}, so a shard landed on a laptop leaves the index, its
 * last run and its before layer as the same run recorded there would have.
 */

import { combineCaseRuns, lastCaseRunOf, spelledLast, type LastCaseRun } from './case-last.js';
export { lastCaseRunOf, type LastCaseRun } from './case-last.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { layerCaseIndex } from './case-layer.js';
import { CaseLayerState } from './case-layer-state.js';
import { caseSectionsAt, type CaseSections } from './case-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeAsSetExecutionIndex, openSetExecutionIndex, type OpenedSetExecutionIndex } from './execution-set-format.js';
import { combineRecordedEyes, layEyes, readableEyes, type EyesSection } from './eyes-record.js';
import { editsBetween } from './region-edit.js';
import type { TestCoverageView } from './format-view.js';
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
 * touched keep none. A module whose text is not known on both sides, or not
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
  state?: CaseLayerState,
  present: (file: string) => boolean = (file) => existsSync(resolve(root, file)),
  opened?: OpenedSetExecutionIndex,
): CaseSections {
  const ran = new Set(run.tests.map((test) => test.file));
  const recorded = textsOf(run);
  const edits = editsBetween(root, cacheRoot, [stands, run.commit]);
  const prior = lastCaseRunOf(previous);
  const again = run.commit !== undefined && prior?.commit === run.commit;
  const session = state ?? new CaseLayerState(previous.index, previous.before);
  const ownFiles = new Set((opened ?? openSetExecutionIndex(fresh))?.tests.map((test) => test.file));
  const unbasedShard = again && prior.began === true && !prior.files.some((test) => ran.has(test) || ownFiles.has(test)) && ![...ran, ...ownFiles].some((file) => session.hasFile(file));
  const layers = layerCaseIndex(state === undefined ? previous.index : undefined, fresh, {
    ran,
    finished: new Set(run.tests.filter((test) => test.complete).map((test) => test.file)),
    present,
    ...(unbasedShard ? { unbased: true } : {}),
    edit: (file) => {
      const [from, to] = [held?.get(file), recorded.get(file)];
      return from === undefined || to === undefined ? undefined : edits(file, from, to);
    },
    sameText: (file) => recorded.has(file) && recorded.get(file) === held?.get(file),
    ...(base === undefined ? {} : {
      base: base.index,
      sameBeforeText: new Set([...recorded.keys(), ...(base.recorded?.keys() ?? [])].filter((file) => {
        const text = recorded.get(file) ?? base.recorded?.get(file);
        return text !== undefined && text === base.texts?.get(file);
      })),
    }),
  }, session, opened);
  const { cases, last, announced, retired, unlined } = layers;
  // FIXME: a run at the same commit that is not a later shard of one landing
  // — a second local invocation, or a second landing — has only the index the
  // earlier run laid, whose modules that run recorded are cut to this commit's
  // text, so its before of them is not the base's. `beforeTexts` names that
  // text, and a reader leaves those modules unmeasured rather than compare
  // them; keeping the base's cut of every module would keep a second index.
  const before = session.retire(state === undefined ? previous.before : undefined, retired, ran, again, unbasedShard);
  const beforeTexts = textsOfBefore(
    before?.files(),
    retired?.modules.map((module) => module.file),
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
  const sections: CaseSections = {
    get index() { return layers.merged; },
    last: spelledLast(named),
    ...(journals === undefined ? {} : { eyes: journals }),
  };
  if (before !== undefined) Object.defineProperty(sections, 'before', { enumerable: true, get: before.bytes });
  return sections;
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
  before: readonly string[] | undefined,
  retired: readonly string[] | undefined,
  cut: ModuleTexts | undefined,
  kept: Readonly<Record<string, string>> | undefined,
  unlined: ReadonlySet<string>,
): Record<string, string> | undefined {
  if (before === undefined || (cut === undefined && kept === undefined)) return undefined;
  const modules = before;
  const ownRegions = new Set(retired ?? []);
  const texts: Record<string, string> = {};
  for (const file of modules) {
    const text = unlined.has(file) ? undefined : ownRegions.has(file) ? cut?.get(file) : kept?.[file];
    if (text !== undefined) texts[file] = text;
  }
  return texts;
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
 * before layer when `previous` names no last run — see {@link layCases}. It
 * is also where a text the landing did not keep is looked for, with `cacheRoot`
 * the layer the kept texts are in.
 *
 * `present` supplies whether a held test path remains present. Artifact
 * combination supplies a policy that keeps named records; source landing asks
 * the checkout.
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
  cacheRoot?: string,
  present: (file: string) => boolean = (file) => existsSync(resolve(root, file)),
  artifacts?: true,
): { readonly landing: CaseLanding; readonly sections: CaseSections } {
  const state = new CaseLayerState(artifacts === true ? undefined : previous.index, artifacts === true ? undefined : previous.before);
  let sections: CaseSections = artifacts === true ? {} : previous;
  const recordedSections: CaseSections[] = [];
  const texts = new Map(held ?? []);
  const recorded = new Map<string, string>();
  // Every shard's before is cut from the index the landing began with.
  const base = previous.index === undefined ? undefined : { index: previous.index, ...(held === undefined ? {} : { texts: held }) };
  let laid = 0;
  const namedBefore: Uint8Array[] = [];
  const ran = new Set<string>();
  for (const shard of shards) {
    const kept = caseSectionsAt(shard.path);
    if (artifacts === true) recordedSections.push(kept);
    if (artifacts === true && kept.before !== undefined) namedBefore.push(kept.before);
    const fresh = layableIndex(kept.index);
    if (artifacts === true && kept.index !== undefined && fresh === undefined) throw new Error('cannot combine a recorded case index this build cannot read');
    if (artifacts === true) {
      if (fresh !== undefined) {
        state.layIndex(fresh.opened, { ran: new Set(), finished: new Set(), present: () => true, artifacts: true });
        sections = { get index() { return state.finish(); } };
        laid += 1;
      }
      continue;
    }
    const run = shard.coverage ?? lastRunOf(kept) ?? (fresh === undefined ? undefined : indexRunOf(fresh.tests));
    if (run === undefined) continue;
    if (fresh !== undefined) {
      // A section this build cannot read is laid as a shard that opened none.
      sections = layCases(sections, fresh.bytes, root, run, readableEyes(kept.eyes), texts, stands, base && { ...base, recorded: new Map(recorded) }, cacheRoot, state, present, fresh.opened);
      for (const [file, text] of textsOf(run)) {
        texts.set(file, text);
        recorded.set(file, text);
      }
      for (const id of lastCaseRunOf(sections)?.cases ?? []) ran.add(id);
      laid += 1;
    } else if (run.tests.some((test) => test.complete)) {
      const removed = Object.values(previous).some((part) => part !== undefined);
      return { landing: { unanswered: record, shard: shard.path, removed }, sections: {} };
    }
  }
  if (artifacts === true) {
    const { before: _before, ...current } = sections;
    sections = current;
    if (namedBefore.length === 1) sections = { ...sections, before: namedBefore[0]! };
    else if (namedBefore.length > 1) {
      const before = new CaseLayerState();
      for (const bytes of namedBefore) {
        const cut = layableIndex(bytes);
        if (cut === undefined) throw new Error('cannot combine a recorded before case index this build cannot read');
        before.layIndex(cut.opened ?? openSetExecutionIndex(cut.bytes)!, { ran: new Set(), finished: new Set(), present: () => true, artifacts: true });
      }
      sections = { ...sections, before: before.finish() };
    }
    let ids: readonly string[] | undefined;
    const cases = () => ids ??= state.cases();
    const last = combineCaseRuns(recordedSections, cases);
    const eyes = combineRecordedEyes(recordedSections.flatMap((part) => part.eyes === undefined ? [] : [part.eyes]), cases);
    sections = { ...sections, ...(last === undefined ? {} : { last }), ...(eyes === undefined ? {} : { eyes }) };
  }
  return { landing: { laid: record, shards: laid }, sections: artifacts !== true && laid > 1 ? lastOfEveryShard(sections, ran) : sections };
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

/**
 * The shard's index spelled as sets, with its cases, when it has one this build can read.
 *
 * FIXME: a shard whose index is spelled as rows, or as sets by a build before
 * `blocks.owner`, is laid with no owners, so a region born in it takes none
 * of its owner's cases.
 */
function layableIndex(bytes: Uint8Array | undefined): { readonly bytes: Uint8Array; readonly tests: readonly ExecutionTest[]; readonly opened: OpenedSetExecutionIndex } | undefined {
  if (bytes === undefined) return undefined;
  try {
    const opened = openSetExecutionIndex(bytes);
    if (opened !== undefined) return { bytes, get tests() { return opened.tests; }, opened };
    const rows = decodeExecutionIndex(bytes);
    const encoded = encodeAsSetExecutionIndex(rows);
    return { bytes: encoded, tests: rows.tests, opened: openSetExecutionIndex(encoded)! };
  } catch {
    return undefined;
  }
}
