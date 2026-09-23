/**
 * The half of an instrumented run that a page cannot hold: what the blocks *are*.
 *
 * A probe in a realm the recorder does not own can only report an ordinal. The names, the source spans
 * and the digests that make an ordinal mean something are produced by the
 * transform, in whichever Node process ran the bundler — and for a reported run
 * that process is not the one that later drives the code. A Storybook is built
 * on Monday and read on Tuesday; a Playwright suite runs against a dev server
 * that started before the test did.
 *
 * So the transform writes each module's record down and the run that drains the
 * counters joins the two by the id the module reports. One record per module, no
 * document that anybody owns, and no moment at which a process has to hold every
 * module at once — because a bundler with a persistent cache never has such a
 * moment, and a build of two hundred thousand files that re-transpiles ten is
 * the ordinary case rather than the exotic one.
 *
 * That join is the only thing this transport adds to
 * [spec 0028](../../../../docs/specs/0028-the-instrument.md): the probes and the
 * block ids are the ones Vitest already uses.
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, writeSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { INSTRUMENTATION_ID, type ModuleId } from '../instrument/index.js';
import { cacheLayers, defaultCacheRoot, seedFromBase } from './cache-layers.js';
import type { CoverageBlock } from './index.js';
import {
  UNNUMBERED,
  decodeRecord,
  frameRecord,
  framePath,
  frames,
  readSegmentHeader,
  segmentHeader,
  type Frame,
} from './record-format.js';

export type { ModuleId };

/** One module the transform saw, whether or not it could read it. */
export interface CapturedModule {
  /** Repository-relative, forward-slashed: the same path a coverage row carries. */
  readonly file: string;
  /** What the emitted code reports itself as: a number, or {@link file} unnumbered. */
  readonly id: ModuleId;
  readonly sourceDigest: string;
  /** False records module-level unknown evidence; consumers widen without consulting blocks. */
  readonly instrumented: boolean;
  readonly blocks: readonly CoverageBlock[];
}

/** Where a repository keeps the numbers it calls its modules by. */
export function moduleNamesFile(root: string, cacheRoot = defaultCacheRoot()): string {
  return resolve(cacheLayers(root, cacheRoot).top, 'names.bin');
}

/**
 * This checkout's table, with the repository's taken over first if it has none.
 *
 * The read path for the numbering: see {@link seedFromBase} for why a worktree
 * must own the table rather than read across it.
 */
export function openModuleNames(root: string, cacheRoot = defaultCacheRoot()): string {
  const layers = cacheLayers(root, cacheRoot);
  seedFromBase(layers, ['names.bin', 'names.bin.segments']);

  return resolve(layers.top, 'names.bin');
}

/**
 * A store is a directory of append-only segments, and a segment belongs to one
 * writing process.
 *
 * A transform writes one frame for the module it just transformed, to a file it
 * alone opened, and returns. That is the whole scheme, and every part of it is
 * forced by who does the writing: a build with a warm cache never holds the
 * modules it did not transform, a dev server has no end to write at, and ten
 * processes transpiling ten changed files out of two hundred thousand must not
 * have to agree about anything. Nothing owns the set, so nothing has to be
 * locked, merged, or rewritten to record one module.
 *
 * One store per build, because one path can be instrumented into two different
 * texts by two different transform chains, and different texts mean different
 * ordinals. A Storybook preview and the application a Playwright suite drives
 * get separate directories rather than one directory they would take turns
 * corrupting. Whoever owns the build names the store: a bundler plugin takes the
 * repository's cache and a label, and Jest takes its own cache directory and its
 * project id, which is Jest's own word for the thing a label means here.
 */
export function recordStore(root: string, label = 'build', cacheRoot = defaultCacheRoot()): string {
  return resolve(cacheLayers(root, cacheRoot).top, label);
}

/**
 * The same store as every layer this checkout may read it from, farthest first.
 *
 * A worktree's build transforms what its branch changed and nothing else, so on
 * its own its store answers for a handful of modules out of a repository's
 * hundreds of thousands. Beneath it sits the primary checkout's store for the
 * same label, which answers for the rest, and the two are one store read in
 * order rather than two stores that have to be reconciled.
 *
 * Farthest first is the whole of the precedence rule, because the rule already
 * exists: within a store *the later frame wins*, and a module the worktree
 * re-transformed is later than the base's record of it by construction. Passing
 * the base's segments ahead of this checkout's makes the branch's text win
 * without a second rule to get wrong — and it is a different question from two
 * *peer* stores disagreeing, which is not a matter of age and stays widened.
 */
export function recordStores(
  root: string,
  label = 'build',
  cacheRoot = defaultCacheRoot(),
): readonly string[] {
  const layers = cacheLayers(root, cacheRoot);

  return layers.top === layers.base
    ? [resolve(layers.base, label)]
    : [resolve(layers.base, label), resolve(layers.top, label)];
}

/** One writer's segment of one store, from the first record it writes to exit. */
export interface RecordWriter {
  readonly store: string;
  /** The recipe every record in the segment was cut under. */
  readonly instrumentation: string;
  segment: number | undefined;
}

/**
 * Claim a segment of a store to append to.
 *
 * The writer is a value rather than something looked up per record, because the
 * segment is the writer's: a plugin is one build and a transformer is one Jest
 * worker, and each holds its own descriptor for as long as it transforms. The
 * file is opened by the first record and not before, so a build that instruments
 * nothing leaves nothing behind.
 */
export function openRecords(store: string, instrumentation = INSTRUMENTATION_ID): RecordWriter {
  return { store, instrumentation, segment: undefined };
}

/**
 * Write one module's record.
 *
 * Synchronous, and not as a concession: the write is one append of about a
 * kilobyte to a descriptor no other writer holds, so there is nothing to wait
 * for and nothing to race. A transform that must finish before it returns —
 * Jest's — needs that, and the one that need not loses nothing by it. Holding
 * the descriptor is what makes it cheap: reopening the segment for each record
 * costs sixteen times the write.
 *
 * A module transformed twice appends twice. The later frame is the one a reader
 * takes, because the later transform is the one that produced the text the
 * running code was cut from.
 */
export function writeRecord(writer: RecordWriter, module: CapturedModule): void {
  if (writer.segment === undefined) {
    mkdirSync(writer.store, { recursive: true });
    const name = `${process.pid.toString(16)}-${randomBytes(4).toString('hex')}.rec`;
    writer.segment = openSync(resolve(writer.store, name), 'a');
    writeSync(writer.segment, segmentHeader(writer.instrumentation));
  }
  writeSync(writer.segment, frameRecord(module));
}

/** A segment's bytes, and where its first frame starts. */
interface ReadSegment {
  readonly raw: Buffer;
  readonly from: number;
}

/**
 * Every segment of a store, oldest first.
 *
 * Oldest first is what makes *the later frame wins* mean anything across two
 * segments, and mtime is the only order two processes that never met left
 * behind. A segment cut by another probe recipe is skipped whole rather than
 * mixed, and so is a file that does not open as a segment at all.
 *
 * Read on each call and not held: a run reads its store once, when it turns its
 * journals into rows, and a cache of segments that are megabytes each would be a
 * cache a long-lived driver never stops paying for.
 */
async function readSegments(
  store: readonly string[],
  instrumentation: string,
): Promise<readonly ReadSegment[]> {
  const layers = await Promise.all(store.map((at) => readLayer(at, instrumentation)));

  // Each layer sorted within itself, and the layers concatenated in the order
  // they were given. Sorting the whole set by mtime would be wrong across
  // layers: the primary checkout may have recorded after the worktree did, and
  // a base frame is still the older claim about the text — older in lineage,
  // which is the order *the later frame wins* is about.
  return layers.flat();
}

async function readLayer(store: string, instrumentation: string): Promise<readonly ReadSegment[]> {
  let names: string[];
  try {
    names = (await readdir(store)).filter((name) => name.endsWith('.rec'));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const read = await Promise.all(names.map(async (name) => {
    const file = resolve(store, name);
    const [status, raw] = await Promise.all([stat(file), readFile(file)]);
    const header = readSegmentHeader(raw);
    const segment: ReadSegment | undefined =
      header?.instrumentation === instrumentation ? { raw, from: header.frames } : undefined;
    return { file, mtimeMs: status.mtimeMs, segment };
  }));
  return read
    .filter((entry) => entry.segment !== undefined)
    .sort((left, right) => left.mtimeMs - right.mtimeMs || codeUnitOrder(left.file, right.file))
    .map((entry) => entry.segment!);
}

/** What one store last said about one id. */
interface Answer {
  readonly raw: Buffer;
  readonly frame: Frame;
}

/**
 * The frames a store holds for the ids asked for, one per id.
 *
 * Two frames under one id are the same module written twice — the id is a
 * number this repository assigned to one path, so there is no second path it
 * could also mean — and the later one wins, because the later transform is the
 * one that produced the text the running code was cut from.
 */
async function readStore(
  store: readonly string[],
  wanted: ReadonlySet<ModuleId>,
  instrumentation: string,
): Promise<ReadonlyMap<ModuleId, CapturedModule>> {
  const answers = new Map<ModuleId, Answer>();
  for (const segment of await readSegments(store, instrumentation)) {
    for (const frame of frames(segment.raw, segment.from)) {
      const id = frame.id === UNNUMBERED ? framePath(segment.raw, frame) : frame.id;
      if (id === undefined || !wanted.has(id)) continue;
      answers.set(id, { raw: segment.raw, frame });
    }
  }
  const found = new Map<ModuleId, CapturedModule>();
  for (const [id, answer] of answers) {
    const module = decodeRecord(answer.raw, answer.frame);
    if (module !== undefined) found.set(id, module);
  }
  return found;
}

/**
 * Read one module's record, or `undefined` when the store cannot answer for it.
 *
 * A store with no segment for it, a segment from another probe recipe, and a
 * record whose bytes do not check out are the same answer on purpose: each
 * means this run has no block universe it may attribute to, and
 * [spec 0027](../../../../docs/specs/0027-a-test-is-selected-by-what-it-executed.md)
 * spends that as a full run rather than as a partial index.
 */
export async function readRecord(
  store: string | readonly string[],
  id: ModuleId,
  instrumentation = INSTRUMENTATION_ID,
): Promise<CapturedModule | undefined> {
  return (await readStore(layersOf(store), new Set([id]), instrumentation)).get(id);
}

/** One store named as a path, or as the layers it is read from, farthest first. */
function layersOf(store: string | readonly string[]): readonly string[] {
  return typeof store === 'string' ? [store] : store;
}

/**
 * Every record the ids name, read across every store this run can see.
 *
 * When two stores answer for one module and disagree about the text it was cut
 * from, or about the regions they cut from one text — two projects whose
 * transforms differ share the source digest and still number its regions
 * apart — the module is recorded as not instrumented: its ordinals mean two
 * things, and a consumer that widens on unknown evidence is right where a
 * consumer that picked one of them would be wrong half the time. Agreement is
 * the ordinary case — two builds of one repository share most of their source
 * and instrument it identically — and costs nothing.
 */
export async function readRecords(
  stores: readonly (string | readonly string[])[],
  ids: Iterable<ModuleId>,
  instrumentation = INSTRUMENTATION_ID,
): Promise<ReadonlyMap<ModuleId, CapturedModule>> {
  const wanted = new Set(ids);
  const held = await Promise.all(
    stores.map((store) => readStore(layersOf(store), wanted, instrumentation)),
  );
  const found = new Map<ModuleId, CapturedModule>();
  for (const id of wanted) {
    const answers = held
      .map((store) => store.get(id))
      .filter((module): module is CapturedModule => module !== undefined);
    const first = answers[0];
    if (first === undefined) continue;
    found.set(
      id,
      // TODO: read disagreeing inventories at the regions they share, as the native journey fold does, rather than at the whole file.
      answers.every((module) => module.sourceDigest === first.sourceDigest && sameRegions(module, first))
        ? first
        : {
            file: first.file,
            id: first.id,
            sourceDigest: first.sourceDigest,
            instrumented: false,
            blocks: [],
          },
    );
  }
  return found;
}

function sameRegions(left: CapturedModule, right: CapturedModule): boolean {
  return left.blocks === right.blocks ||
    (left.blocks.length === right.blocks.length &&
      JSON.stringify(left.blocks) === JSON.stringify(right.blocks));
}

/** Strip a bundler's query suffix: `Button.tsx?v=1` is `Button.tsx`. */
export function cleanId(id: string): string {
  return id.split('?')[0] ?? id;
}

/**
 * Product source, as every runner seam defaults to reading it.
 *
 * A `*.config.[cm]?[jt]s` file is read by a loader rather than by the test
 * environment, so the setup shim that installs the counter factory has never run
 * where one evaluates: instrumented, its first probe throws and takes the run
 * with it. The precise exclusion is the resolved config's own `globalSetup` list
 * (`vitest.ts`); this is the backstop for what no config names, itself first.
 */
export function defaultInclude(file: string): boolean {
  return (
    isAbsolute(file) &&
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    !/\.config\.[cm]?[jt]s$/.test(basename(file)) &&
    !file.split(sep).includes('node_modules') &&
    !file.split(sep).includes('dist')
  );
}

export function projectPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

/** What one test file's run counted, per module, under the ids the modules reported. */
export interface ReadJournal {
  readonly testFile: string;
  readonly modules: ReadonlyArray<{
    readonly id: ModuleId;
    readonly hits: readonly number[];
    /** Entered while the module was evaluating: every file that consumed the module owns it. */
    readonly shared: readonly number[];
    /** Entered before the file's first test ran: a consequence of loading, not of a test. */
    readonly loaded: readonly number[];
  }>;
}

/** The ordinals of one journal row a fold reads: what the file hit, or what it had hit before its first test. */
export type JournalOrdinals = (module: ReadJournal['modules'][number]) => readonly number[];

/**
 * Which test files crossed each ordinal of each module, folded from every
 * journal of one run.
 *
 * An ordinal a file hit on its own is that file's. An ordinal hit while the
 * module was evaluating is every file's that consumed the module: a worker
 * that keeps its module graph between files evaluates a module once, in
 * whichever file's window came first, and every later file that entered the
 * module read what that evaluation made. A file that never entered the module
 * did not consume it, and under isolation — where each file evaluates the
 * module itself and holds its own window — that is every other file in the
 * run. Crediting them would put a top-level edit in front of the whole suite.
 *
 * `ordinalsOf` picks which ordinals of a row are folded. The default is what
 * the file entered; {@link loadedOf} folds what it had entered before its
 * first test under the same crediting, because what a module did while
 * evaluating happened before the first test of every file that consumed it.
 */
export function crossingsOf(
  journals: readonly ReadJournal[],
  ordinalsOf: JournalOrdinals = (module) => module.hits,
): ReadonlyMap<ModuleId, ReadonlyMap<number, ReadonlySet<string>>> {
  const consumers = new Map<ModuleId, Set<string>>();
  for (const journal of journals) {
    for (const module of journal.modules) {
      const holders = consumers.get(module.id) ?? new Set<string>();
      holders.add(journal.testFile);
      consumers.set(module.id, holders);
    }
  }
  const observed = new Map<ModuleId, Map<number, Set<string>>>();
  for (const journal of journals) {
    for (const module of journal.modules) {
      const byOrdinal = observed.get(module.id) ?? new Map<number, Set<string>>();
      const shared = new Set(module.shared);
      for (const ordinal of ordinalsOf(module)) {
        const tests = byOrdinal.get(ordinal) ?? new Set<string>();
        if (shared.has(ordinal)) for (const test of consumers.get(module.id)!) tests.add(test);
        else tests.add(journal.testFile);
        byOrdinal.set(ordinal, tests);
      }
      observed.set(module.id, byOrdinal);
    }
  }
  return observed;
}

/** Which test files each ordinal had been entered for before their first test ran. */
export function loadedOf(
  journals: readonly ReadJournal[],
): ReadonlyMap<ModuleId, ReadonlyMap<number, ReadonlySet<string>>> {
  return crossingsOf(journals, (module) => module.loaded);
}

export function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * A total order over ids, so a fold that has both kinds produces one sequence.
 *
 * Numbers first and in numeric order, paths after them. Nothing reads meaning
 * into the order — it exists so that two processes folding the same run write
 * the same bytes.
 */
export function idOrder(left: ModuleId, right: ModuleId): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'number') return -1;
  if (typeof right === 'number') return 1;
  return codeUnitOrder(left, right);
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
