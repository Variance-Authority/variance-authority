import { openBlob, openBytes, openWords, resident, type Bytes } from './columns.js';
import {
  blob,
  column,
  durationWord,
  NO_DURATION,
  sections,
  validSections,
  type Header,
  type Section,
} from './format-layout.js';
import { openCrossingSets, type CrossingSetsView } from './crossing-sets-read.js';
import { CrossingSets, type CrossingSetsPool, type SetId } from './crossing-sets.js';
import { codeUnitOrder, intern } from '@variance-authority/core/segment';
import type { ExecutionBlock, ExecutionIndex, ExecutionModule, ExecutionTest } from './reverse.js';

/**
 * A journey-only execution index: every crossing has measured distance zero.
 *
 * Version 3 records load time as one flag per region ({@link
 * ExecutionBlock.loaded}); version 2 recorded the set of cases that loaded each
 * region, and is still read, as the flag its set implies.
 *
 * `tests.stopped` and `tests.duration` joined version 3 without a new number:
 * each is one optional column a reader looks for by name, and a file without
 * it — the addon's journeys among them — reads as cases that said nothing.
 */
export const SET_EXECUTION_FORMAT = 3;

const LOADED_SETS_FORMAT = 2;

export interface SetExecutionModule {
  readonly file: string;
  readonly blocks: readonly Omit<ExecutionBlock, 'crossings'>[];
  /** Tests that called into each block, as ids in {@link SetExecutionIndex.sets}. */
  readonly called: Uint32Array;
  /** `1` where the block ran while its module evaluated, in any test file. */
  readonly loaded: Uint8Array;
}

export interface SetExecutionIndex {
  readonly tests: readonly ExecutionTest[];
  readonly modules: readonly SetExecutionModule[];
  readonly sets: CrossingSetsPool;
}

/**
 * Store a journey relation as interned test sets rather than one row per crossing.
 *
 * A region has one set, the tests that called it, and one flag for having run
 * while its module evaluated. The representation therefore grows with regions
 * plus distinct sets, not with the test-by-region product that exhausted Jest's
 * parent-process heap.
 *
 * Module rows are written in code-unit order of path, the order the string
 * table is sorted in, so a reader finds one module by a binary search rather
 * than a table of every path. The native fold and stitch write the same order.
 */
export function encodeSetExecutionIndex(index: SetExecutionIndex): Buffer {
  const { strings, id } = intern(dictionary(index));
  const modules = [...index.modules].sort((left, right) => codeUnitOrder(left.file, right.file));
  const encoded = strings.map((value) => Buffer.from(value, 'utf8'));
  const stringOffsets = new Uint32Array(strings.length + 1);
  let byteOffset = 0;
  for (const [at, bytes] of encoded.entries()) {
    stringOffsets[at] = byteOffset;
    byteOffset += bytes.length;
  }
  stringOffsets[strings.length] = byteOffset;

  const blockCount = index.modules.reduce((total, module) => total + module.blocks.length, 0);
  const moduleFile = new Uint32Array(modules.length);
  const moduleBlocks = new Uint32Array(modules.length + 1);
  const blockKind = new Uint32Array(blockCount);
  const blockName = new Uint32Array(blockCount);
  const blockPath = new Uint32Array(blockCount);
  const blockStart = new Uint32Array(blockCount);
  const blockEnd = new Uint32Array(blockCount);
  const blockSource = new Uint8Array(blockCount);
  const blockCalled = new Uint32Array(blockCount);
  const blockLoaded = new Uint8Array(blockCount);

  let block = 0;
  for (const [moduleAt, module] of modules.entries()) {
    if (module.called.length !== module.blocks.length || module.loaded.length !== module.blocks.length) {
      throw new Error('journey set columns do not match the region inventory');
    }
    moduleFile[moduleAt] = id(module.file);
    moduleBlocks[moduleAt] = block;
    for (const [at, held] of module.blocks.entries()) {
      blockKind[block] = id(held.kind);
      blockName[block] = id(held.name);
      blockPath[block] = id(held.path);
      blockStart[block] = held.startLine;
      blockEnd[block] = held.endLine;
      blockSource[block] = held.source ? 1 : 0;
      blockCalled[block] = module.called[at]!;
      blockLoaded[block] = module.loaded[at]!;
      block += 1;
    }
  }
  moduleBlocks[modules.length] = block;

  return sections({
    'strings.blob': blob(Buffer.concat(encoded), stringOffsets),
    'strings.off': column(stringOffsets),
    'tests.id': column(Uint32Array.from(index.tests, (test) => id(test.id))),
    'tests.file': column(Uint32Array.from(index.tests, (test) => id(test.file))),
    'tests.name': column(Uint32Array.from(index.tests, (test) => id(test.name))),
    'tests.stopped': column(stoppedColumn(index.tests)),
    'tests.duration': column(durationColumn(index.tests)),
    'modules.file': column(moduleFile),
    'modules.blocks': column(moduleBlocks),
    'blocks.kind': column(blockKind),
    'blocks.name': column(blockName),
    'blocks.path': column(blockPath),
    'blocks.start': column(blockStart),
    'blocks.end': column(blockEnd),
    'blocks.source': column(blockSource),
    'blocks.calledSet': column(blockCalled),
    'blocks.loaded': column(blockLoaded),
    'sets.blob': blob(index.sets.bytes, index.sets.offsets),
    'sets.off': column(index.sets.offsets),
  }, SET_EXECUTION_FORMAT);
}

/** A set-spelled index opened at its sets: regions name set ids, and no crossing is made an object. */
export interface OpenedSetExecutionIndex {
  readonly tests: readonly ExecutionTest[];
  readonly modules: readonly SetExecutionModule[];
  readonly sets: CrossingSetsView;
}

/**
 * Open the compact spelling without decoding a crossing, for a reader that
 * works on sets — the layering a run does over the index it replaces. Returns
 * nothing for the row spelling, which has no sets to hand over.
 */
export function openSetExecutionIndex(bytes: Uint8Array): OpenedSetExecutionIndex | undefined {
  const opened = sectionsOf(bytes);
  const version = opened.header.version;
  if (version !== SET_EXECUTION_FORMAT && version !== LOADED_SETS_FORMAT) return undefined;
  return openedSets(opened);
}

/** Read the compact journey spelling into the runner-independent object model. */
export function decodeSetExecutionIndex(bytes: Uint8Array): ExecutionIndex {
  const opened = sectionsOf(bytes);
  const version = opened.header.version;
  if (version !== SET_EXECUTION_FORMAT && version !== LOADED_SETS_FORMAT) {
    throw new Error(`unsupported execution index version: ${opened.header.version}`);
  }
  const { tests, modules, sets } = openedSets(opened);
  return {
    tests,
    modules: modules.map((module): ExecutionModule => ({
      file: module.file,
      blocks: module.blocks.map((block, at): ExecutionBlock => ({
        ...block,
        ...(module.loaded[at] === 1 ? { loaded: true as const } : {}),
        crossings: Array.from(members(sets, module.called[at]!, tests.length), (test) => ({ test, distance: 0 })),
      })),
    })),
  };
}

/**
 * A journey-only index in the set spelling, whatever built it: the spelling a
 * run is laid over the index beside a snapshot in, so a seam that builds its
 * cases as rows is laid by the same body as one that folds them to sets.
 *
 * Lossless for an index whose crossings are all at distance zero, which is
 * every index a case journal becomes. A crossing marked as run while its module
 * loaded is the region's load flag here, as the set spelling records it, and
 * names no case. A measured depth has no place in the set spelling, so an index
 * with one is refused rather than flattened.
 */
export function encodeAsSetExecutionIndex(index: ExecutionIndex): Buffer {
  const sets = new CrossingSets(index.tests.length);
  sets.intern([]);
  const modules = index.modules.map((module): SetExecutionModule => {
    const called = new Uint32Array(module.blocks.length);
    const loaded = new Uint8Array(module.blocks.length);
    const blocks = module.blocks.map(({ crossings, loaded: load, ...block }, at) => {
      const cases: number[] = [];
      if (load === true) loaded[at] = 1;
      for (const crossing of crossings) {
        if (crossing.distance !== 0) {
          throw new Error(`${module.file} has a case at depth ${crossing.distance}, and the set spelling records no depth`);
        }
        if (crossing.loaded === true) loaded[at] = 1;
        else cases.push(crossing.test);
      }
      called[at] = sets.intern(cases);
      return block;
    });
    return { file: module.file, blocks, called, loaded };
  });
  return encodeSetExecutionIndex({ tests: index.tests, modules, sets: sets.pool() });
}

/**
 * What a finalize could not charge to a case, as the artifact carries it: the
 * finalize's own answer, read by a process that runs after it.
 */
export interface JourneyGaps {
  /** Modules a case ran that no record holds: a change there selects nothing. */
  readonly unrecorded: readonly string[];
  /** Part files that ran code under no journey a case handed out. */
  readonly unclaimed: readonly string[];
  /** Heads that wrote at least one part in the run. */
  readonly heads: readonly string[];
  /** Heads that wrote parts in the run before and none in this one; absent with no run before. */
  readonly silent?: readonly string[];
}

/**
 * The gaps a journey artifact carries, or nothing when it was written without
 * them: an artifact that was never asked is not one that found nothing.
 */
export function journeyGaps(bytes: Uint8Array): JourneyGaps | undefined {
  const opened = sectionsOf(bytes);
  const version = opened.header.version;
  if (version !== SET_EXECUTION_FORMAT && version !== LOADED_SETS_FORMAT) return undefined;
  if (!opened.found.has('gaps.unrecorded')) return undefined;
  const strings = stringsOf(opened);
  const named = (name: string): string[] => Array.from(columnWords(opened, name), (id) => strings[id] ?? fail());
  return {
    unrecorded: named('gaps.unrecorded'),
    unclaimed: named('gaps.unclaimed'),
    heads: named('gaps.heads'),
    ...(opened.found.has('gaps.silent') ? { silent: named('gaps.silent') } : {}),
  };
}

function stringsOf(opened: OpenedSections): string[] {
  const stringOffsets = columnWords(opened, 'strings.off');
  const stringBlob = columnBlob(opened, 'strings.blob', stringOffsets);
  const decoder = new TextDecoder();
  const strings: string[] = [];
  for (let id = 0; id + 1 < stringOffsets.length; id += 1) {
    const from = stringOffsets[id]!;
    const to = stringOffsets[id + 1]!;
    if (to < from || to > stringBlob.length) throw invalid();
    strings.push(decoder.decode(stringBlob.subarray(from, to)));
  }
  return strings;
}

/**
 * The cases an execution index names, read off its test columns alone. Both
 * spellings lay the cases out the same way, so this answers for either without
 * opening a region or a crossing: `rows` are the versions of the row spelling,
 * which owns them.
 */
export function executionTestsOf(bytes: Uint8Array, rows: readonly number[]): readonly ExecutionTest[] {
  const opened = sectionsOf(bytes);
  const version = opened.header.version;
  if (version !== SET_EXECUTION_FORMAT && version !== LOADED_SETS_FORMAT && !rows.includes(version)) {
    throw new Error(`unsupported execution index version: ${version}`);
  }
  return testsOf(opened, stringsOf(opened));
}

function testsOf(opened: OpenedSections, strings: readonly string[]): ExecutionTest[] {
  const words = (name: string): Uint32Array => columnWords(opened, name);
  const string = (id: number): string => strings[id] ?? fail();
  const testId = words('tests.id');
  const testFile = words('tests.file');
  const testName = words('tests.name');
  // Written since a case carries how it settled; a file without it says nothing.
  const testStopped = opened.found.has('tests.stopped') ? columnBytes(opened, 'tests.stopped') : undefined;
  // Written since a case carries its runner's duration; a file without it timed none.
  const testDuration = opened.found.has('tests.duration') ? words('tests.duration') : undefined;
  if (testFile.length !== testId.length || testName.length !== testId.length) throw invalid();
  if (testDuration !== undefined && testDuration.length !== testId.length) throw invalid();
  const tests: ExecutionTest[] = [];
  for (let at = 0; at < testId.length; at += 1) {
    tests.push({
      id: string(testId[at]!),
      file: string(testFile[at]!),
      name: string(testName[at]!),
      ...stoppedFrom(testStopped, at),
      ...durationFrom(testDuration, at),
    });
  }
  return tests;
}

function openedSets(opened: OpenedSections): OpenedSetExecutionIndex {
  const version = opened.header.version;
  const words = (name: string): Uint32Array => columnWords(opened, name);
  const flags = (name: string): Uint8Array => columnBytes(opened, name);
  const strings = stringsOf(opened);
  const string = (id: number): string => strings[id] ?? fail();
  const tests = testsOf(opened, strings);

  const moduleFile = words('modules.file');
  const moduleBlocks = words('modules.blocks');
  const blockKind = words('blocks.kind');
  const blockName = words('blocks.name');
  const blockPath = words('blocks.path');
  const blockStart = words('blocks.start');
  const blockEnd = words('blocks.end');
  const blockSource = flags('blocks.source');
  const blockCalled = words('blocks.calledSet');
  const blockLoaded = version === LOADED_SETS_FORMAT ? words('blocks.loadedSet') : flags('blocks.loaded');
  if (moduleBlocks.length !== moduleFile.length + 1) throw invalid();
  const blockCount = blockKind.length;
  if ([blockName, blockPath, blockStart, blockEnd, blockSource, blockCalled, blockLoaded]
    .some((column) => column.length !== blockCount)) throw invalid();

  const setOffsets = words('sets.off');
  const setBytes = columnBlob(opened, 'sets.blob', setOffsets);
  const sets = openCrossingSets({ bytes: setBytes, offsets: setOffsets, testCount: tests.length });
  const modules: SetExecutionModule[] = [];
  for (let module = 0; module < moduleFile.length; module += 1) {
    const first = moduleBlocks[module]!;
    const last = moduleBlocks[module + 1]!;
    if (last < first || last > blockCount) throw invalid();
    const blocks: Omit<ExecutionBlock, 'crossings'>[] = [];
    const called = new Uint32Array(last - first);
    const loaded = new Uint8Array(last - first);
    for (let block = first; block < last; block += 1) {
      if (blockCalled[block]! >= sets.size) throw invalid();
      called[block - first] = blockCalled[block]!;
      loaded[block - first] = (version === LOADED_SETS_FORMAT
        ? members(sets, blockLoaded[block]!, tests.length).length > 0
        : blockLoaded[block] === 1) ? 1 : 0;
      blocks.push({
        kind: string(blockKind[block]!),
        name: string(blockName[block]!),
        path: string(blockPath[block]!),
        startLine: blockStart[block]!,
        endLine: blockEnd[block]!,
        source: blockSource[block] === 1,
      });
    }
    modules.push({ file: string(moduleFile[module]!), blocks, called, loaded });
  }
  return { tests, modules, sets };
}

function dictionary(index: SetExecutionIndex): ReadonlySet<string> {
  const held = new Set<string>();
  for (const test of index.tests) {
    held.add(test.id);
    held.add(test.file);
    held.add(test.name);
  }
  for (const module of index.modules) {
    held.add(module.file);
    for (const block of module.blocks) {
      held.add(block.kind);
      held.add(block.name);
      held.add(block.path);
    }
  }
  return held;
}

function members(
  sets: CrossingSetsView,
  set: SetId,
  testCount: number,
): Uint32Array {
  if (set < 0 || set >= sets.size) throw invalid();
  const found = sets.members(set);
  if (found.some((test) => test >= testCount)) throw invalid();
  return found;
}

interface OpenedSections {
  readonly file: Bytes;
  readonly bytes: Uint8Array;
  readonly header: Header;
  readonly base: number;
  readonly found: ReadonlyMap<string, Section>;
}

function sectionsOf(bytes: Uint8Array): OpenedSections {
  if (bytes.length < 4) throw invalid();
  const headerLength = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32LE(0);
  if (headerLength <= 0 || headerLength + 4 > bytes.length) throw invalid();
  const header = JSON.parse(
    Buffer.from(bytes.buffer, bytes.byteOffset + 4, headerLength).toString('utf8').replace(/\0+$/u, ''),
  ) as Header;
  const base = 4 + headerLength;
  if (!validSections(header.sections, bytes.length - base)) throw invalid();
  return {
    file: resident(bytes),
    bytes,
    header,
    base,
    found: new Map(header.sections.map((section) => [section.name, section])),
  };
}

function stored(opened: OpenedSections, name: string): Bytes {
  const section = opened.found.get(name);
  if (section === undefined) throw invalid();
  const from = opened.base + section.offset;
  return { length: section.length, read: (first, last) => opened.file.read(from + first, from + last) };
}

function whole(opened: OpenedSections, name: string): Uint8Array {
  const section = opened.found.get(name);
  if (section === undefined) throw invalid();
  return opened.file.read(opened.base + section.offset, opened.base + section.offset + section.length);
}

function columnWords(opened: OpenedSections, name: string): Uint32Array {
  const section = opened.found.get(name);
  if (section === undefined) throw invalid();
  if (section.rows !== undefined) return openWords(stored(opened, name), section.rows).all();
  if (section.length % 4 !== 0) throw invalid();
  const bytes = whole(opened, name);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, section.length / 4);
}

function columnBytes(opened: OpenedSections, name: string): Uint8Array {
  const section = opened.found.get(name);
  if (section === undefined) throw invalid();
  return section.rows === undefined ? whole(opened, name) : openBytes(stored(opened, name), section.rows).all();
}

function columnBlob(opened: OpenedSections, name: string, offsets: Uint32Array): Uint8Array {
  const section = opened.found.get(name);
  if (section === undefined) throw invalid();
  return section.rows === undefined
    ? whole(opened, name)
    : openBlob(stored(opened, name), () => offsets).all();
}

/**
 * How each case settled, one byte per test: nothing said, finished, stopped.
 *
 * Three states, as `crossings.loaded` has, because a producer that cannot see
 * a case settle must not be read as one that saw it finish.
 */
const UNSETTLED = 0;
const FINISHED = 1;
const STOPPED = 2;

export function stoppedColumn(tests: readonly ExecutionTest[]): Uint8Array {
  return Uint8Array.from(tests, (test) =>
    test.stopped === undefined ? UNSETTLED : test.stopped ? STOPPED : FINISHED);
}

export function stoppedFrom(column: Uint8Array | undefined, at: number): { readonly stopped?: boolean } {
  const held = column?.[at];
  if (held === undefined || held === UNSETTLED) return {};
  if (held === FINISHED) return { stopped: false };
  if (held === STOPPED) return { stopped: true };
  throw invalid();
}

/**
 * Each case's duration as its runner reported it, one word per test in whole
 * milliseconds, {@link NO_DURATION} for a case no runner timed.
 */
export function durationColumn(tests: readonly ExecutionTest[]): Uint32Array {
  return Uint32Array.from(tests, (test) => durationWord(test.duration));
}

export function durationFrom(column: Uint32Array | undefined, at: number): { readonly duration?: number } {
  const held = column?.[at];
  return held === undefined || held === NO_DURATION ? {} : { duration: held };
}

function fail(): never {
  throw invalid();
}

function invalid(): Error {
  return new Error('not a variance-authority execution index');
}
