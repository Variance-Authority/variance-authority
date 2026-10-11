import { blob, column, NO_OWNER, sections } from './format-layout.js';
import { type CrossingSetsView } from './crossing-sets-read.js';
import { CrossingSets, type CrossingSetsPool } from './crossing-sets.js';
import { codeUnitOrder, intern } from '@variance-authority/core/segment';
import { linesColumn, type CaseLines, type LinesTable } from './case-lines.js';
import { preconditionSection, preconditionStrings, preconditionWords, preconditionsFrom } from './case-precondition-column.js';
import {
  columnWords,
  durationColumn,
  durationFrom,
  fail,
  LOADED_SETS_FORMAT,
  members,
  sectionsOf,
  setColumns,
  stoppedColumn,
  stoppedFrom,
  stringTable,
  testColumns,
  type OpenedSections,
  type SetColumns,
  type StringTable,
  type TestColumns,
} from './execution-set-columns.js';
import type { ExecutionBlock, ExecutionIndex, ExecutionModule, ExecutionTest } from './reverse.js';

/** What `openSetColumns` hands back, for a reader that walks every case of a large record without decoding it. */
export type { SetColumns, StringTable, TestColumns } from './execution-set-columns.js';

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
 * `blocks.owner` joined the same way, and a file without it names no region
 * around any.
 */
export const SET_EXECUTION_FORMAT = 3;

export interface SetExecutionModule {
  readonly file: string;
  readonly blocks: readonly Omit<ExecutionBlock, 'crossings'>[];
  /** Tests that called into each block, as ids in {@link SetExecutionIndex.sets}. */
  readonly called: Uint32Array;
  /** `1` where the block ran while its module evaluated, in any test file. */
  readonly loaded: Uint8Array;
  /**
   * Where the region around each block stands among `blocks`, always before
   * it, or {@link NO_OWNER}: the owner a coverage row names by ordinal. Absent
   * where the index recorded none.
   */
  readonly owner?: Uint32Array;
}

export interface SetExecutionIndex {
  readonly tests: readonly ExecutionTest[];
  readonly modules: readonly SetExecutionModule[];
  readonly sets: CrossingSetsPool;
  /**
   * The line that reached each region, by case, each module named by its place
   * in `modules`; absent, or a case's entry absent, where it was not recorded.
   */
  readonly lines?: readonly (CaseLines | undefined)[];
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
  const order = Array.from(index.modules.keys()).sort((left, right) => codeUnitOrder(index.modules[left]!.file, index.modules[right]!.file));
  const modules = order.map((at) => index.modules[at]!);
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
  const blockOwner = modules.some((module) => module.owner !== undefined) ? new Uint32Array(blockCount) : undefined;

  let block = 0;
  for (const [moduleAt, module] of modules.entries()) {
    if (module.called.length !== module.blocks.length || module.loaded.length !== module.blocks.length ||
      (module.owner !== undefined && module.owner.length !== module.blocks.length)) {
      throw new Error('journey set columns do not match the region inventory');
    }
    if (module.owner?.some((owner, at) => owner !== NO_OWNER && owner >= at) === true) {
      throw new Error(`${module.file} names a region around one that does not come before it`);
    }
    blockOwner?.set(module.owner ?? new Uint32Array(module.blocks.length).fill(NO_OWNER), block);
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

  return writeSetColumns({
    strings: { blob: Buffer.concat(encoded), offsets: stringOffsets },
    testId: Uint32Array.from(index.tests, (test) => id(test.id)),
    testFile: Uint32Array.from(index.tests, (test) => id(test.file)),
    testName: Uint32Array.from(index.tests, (test) => id(test.name)),
    testStopped: stoppedColumn(index.tests),
    testDuration: durationColumn(index.tests),
    testPreconditions: preconditionWords(index.tests, id),
    moduleFile,
    moduleBlocks,
    blockKind,
    blockName,
    blockPath,
    blockStart,
    blockEnd,
    blockSource,
    blockCalled,
    blockLoaded,
    blockOwner,
    testLines: index.lines === undefined ? undefined : renamed(index.lines, order),
  }, index.sets);
}

/** Each case's lines with its modules named by the place they are written at. */
function renamed(lines: readonly (CaseLines | undefined)[], order: readonly number[]): (CaseLines | undefined)[] {
  const written = new Uint32Array(order.length);
  for (const [at, from] of order.entries()) written[from] = at;
  return lines.map((held) => held === undefined ? undefined : {
    ...held,
    segments: new Map([...held.segments].map(([module, segment]) => [written[module] ?? fail(), segment])),
  });
}

/** The columns an index is written from: every one {@link SetColumns} reads, none optional but the owner and lines columns. */
export interface WrittenSetColumns extends Omit<SetColumns, 'sets' | 'testStopped' | 'testDuration' | 'testPreconditions' | 'testLines'> {
  readonly testStopped: Uint8Array;
  readonly testDuration: Uint32Array;
  readonly testPreconditions: Uint32Array;
  /** Each case's lines, its modules named by their row; no column where no case recorded any. */
  readonly testLines?: readonly (CaseLines | undefined)[] | undefined;
}

/**
 * Write an index from its columns. Modules in code-unit order of path, and
 * every id naming a string of `columns.strings`, are the caller's to keep.
 */
export function writeSetColumns(columns: WrittenSetColumns, sets: CrossingSetsPool): Buffer {
  return sections({
    'strings.blob': blob(columns.strings.blob, columns.strings.offsets),
    'strings.off': column(columns.strings.offsets),
    'tests.id': column(columns.testId),
    'tests.file': column(columns.testFile),
    'tests.name': column(columns.testName),
    'tests.stopped': column(columns.testStopped),
    'tests.duration': column(columns.testDuration),
    ...preconditionSection(columns.testPreconditions),
    ...linesColumn(columns.testLines ?? []),
    'modules.file': column(columns.moduleFile),
    'modules.blocks': column(columns.moduleBlocks),
    'blocks.kind': column(columns.blockKind),
    'blocks.name': column(columns.blockName),
    'blocks.path': column(columns.blockPath),
    'blocks.start': column(columns.blockStart),
    'blocks.end': column(columns.blockEnd),
    'blocks.source': column(columns.blockSource),
    'blocks.calledSet': column(columns.blockCalled),
    'blocks.loaded': column(columns.blockLoaded),
    ...(columns.blockOwner === undefined ? {} : { 'blocks.owner': column(columns.blockOwner) }),
    'sets.blob': blob(sets.bytes, sets.offsets),
    'sets.off': column(sets.offsets),
  }, SET_EXECUTION_FORMAT);
}

/** A set-spelled index opened at its sets: regions name set ids, and no crossing is made an object. */
export interface OpenedSetExecutionIndex {
  readonly tests: readonly ExecutionTest[];
  readonly modules: readonly SetExecutionModule[];
  readonly sets: CrossingSetsView;
  /** Each case's lines, absent in an index written without cuts. */
  readonly lines?: LinesTable;
}

/**
 * Open the compact spelling without decoding a crossing, for a reader that
 * works on sets — the layering a run does over the index it replaces. Returns
 * nothing for the row spelling, which has no sets to hand over.
 */
export function openSetExecutionIndex(bytes: Uint8Array): OpenedSetExecutionIndex | undefined {
  const columns = openSetColumns(bytes);
  return columns === undefined ? undefined : openedSets(columns);
}

/**
 * The compact spelling as its columns, every one checked and no string
 * decoded; nothing for the row spelling. Takes a case index's own bytes, the
 * `index` section `caseSectionsAt` reads out of a record.
 */
export function openSetColumns(bytes: Uint8Array): SetColumns | undefined {
  const opened = sectionsOf(bytes);
  const version = opened.header.version;
  if (version !== SET_EXECUTION_FORMAT && version !== LOADED_SETS_FORMAT) return undefined;
  return setColumns(opened);
}

/** Read the compact journey spelling into the runner-independent object model. */
export function decodeSetExecutionIndex(bytes: Uint8Array): ExecutionIndex {
  const opened = sectionsOf(bytes);
  const version = opened.header.version;
  if (version !== SET_EXECUTION_FORMAT && version !== LOADED_SETS_FORMAT) {
    throw new Error(`unsupported execution index version: ${opened.header.version}`);
  }
  const { tests, modules, sets } = openedSets(setColumns(opened));
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
  return encodeOwnedSetExecutionIndex(index, []);
}

/**
 * {@link encodeAsSetExecutionIndex}, with the region around each region:
 * `owners[at]` holds those of `index.modules[at]`, as positions among its
 * blocks, and a module past its end names none. An `ExecutionIndex` is a plain
 * object a foreign producer writes and a reshaper spreads, and a position does
 * not survive either, so the owners travel beside it from the cut that
 * recorded them. They are matched by place, not by file: two cuts of one file
 * can reach one run.
 */
export function encodeOwnedSetExecutionIndex(
  index: ExecutionIndex,
  owners: readonly (Uint32Array | undefined)[],
  lines?: SetExecutionIndex['lines'],
): Buffer {
  const sets = new CrossingSets(index.tests.length);
  sets.intern([]);
  const modules = index.modules.map((module, place): SetExecutionModule => {
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
    const owner = owners[place];
    return { file: module.file, blocks, called, loaded, ...(owner === undefined ? {} : { owner }) };
  });
  return encodeSetExecutionIndex({ tests: index.tests, modules, sets: sets.pool(), ...(lines === undefined ? {} : { lines }) });
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
  return decodedStrings(stringTable(opened));
}

/** Every string of a table, decoded. */
function decodedStrings(table: StringTable): string[] {
  const decoder = new TextDecoder();
  const strings: string[] = [];
  for (let id = 0; id + 1 < table.offsets.length; id += 1) {
    strings.push(decoder.decode(table.blob.subarray(table.offsets[id]!, table.offsets[id + 1]!)));
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
  const columns = testColumns(opened, strings.length);
  const string = (id: number): string => strings[id] ?? fail();
  return Array.from(columns.testId, (_, at) => testAt(columns, at, string));
}

/** One case off the test columns. */
export function testAt(columns: TestColumns, at: number, string: (id: number) => string): ExecutionTest {
  return {
    id: string(columns.testId[at]!),
    file: string(columns.testFile[at]!),
    name: string(columns.testName[at]!),
    ...stoppedFrom(columns.testStopped, at),
    ...durationFrom(columns.testDuration, at),
    ...preconditionsFrom(columns.testPreconditions, at, string),
  };
}

/** One module off the module and region columns, its regions naming the sets they are stored with. */
export function moduleAt(columns: SetColumns, at: number, string: (id: number) => string): SetExecutionModule {
  const first = columns.moduleBlocks[at]!;
  const last = columns.moduleBlocks[at + 1]!;
  const blocks: Omit<ExecutionBlock, 'crossings'>[] = [];
  for (let block = first; block < last; block += 1) {
    blocks.push({
      kind: string(columns.blockKind[block]!),
      name: string(columns.blockName[block]!),
      path: string(columns.blockPath[block]!),
      startLine: columns.blockStart[block]!,
      endLine: columns.blockEnd[block]!,
      source: columns.blockSource[block] === 1,
    });
  }
  return {
    file: string(columns.moduleFile[at]!),
    blocks,
    called: columns.blockCalled.slice(first, last),
    loaded: columns.blockLoaded.slice(first, last),
    ...(columns.blockOwner === undefined ? {} : { owner: columns.blockOwner.slice(first, last) }),
  };
}

function openedSets(columns: SetColumns): OpenedSetExecutionIndex {
  const strings = decodedStrings(columns.strings);
  const string = (id: number): string => strings[id] ?? fail();
  return {
    tests: Array.from(columns.testId, (_, at) => testAt(columns, at, string)),
    modules: Array.from(columns.moduleFile, (_, at) => moduleAt(columns, at, string)),
    sets: columns.sets,
    ...(columns.testLines === undefined ? {} : { lines: columns.testLines }),
  };
}

function dictionary(index: SetExecutionIndex): ReadonlySet<string> {
  const held = new Set<string>();
  for (const test of index.tests) {
    held.add(test.id);
    held.add(test.file);
    held.add(test.name);
  }
  for (const text of preconditionStrings(index.tests)) held.add(text);
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
