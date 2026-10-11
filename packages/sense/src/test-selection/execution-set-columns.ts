import { openBlob, openBytes, openWords, resident, type Bytes } from './columns.js';
import { durationWord, NO_DURATION, NO_OWNER, validSections, type Header, type Section } from './format-layout.js';
import { openCrossingSets, type CrossingSetsView } from './crossing-sets-read.js';
import { PRECONDITIONS_COLUMN, UNHEARD } from './case-precondition-column.js';
import { LINES_COLUMN, LINES_OFFSETS, type LinesTable } from './case-lines.js';
import type { ExecutionTest } from './reverse.js';

/** The version that recorded the set of cases that loaded each region, read as the flag its set implies. */
export const LOADED_SETS_FORMAT = 2;

/**
 * A set-spelled index as the columns it is stored in, every id still an id.
 *
 * Opening it reads and checks every column — each id names a string the
 * dictionary holds, each region a set the pool holds — and decodes no string,
 * so a reader that carries most of an index across pays for integers, and
 * makes a string of only what it reasons about.
 */
/** A case index's test columns, every string an id, as either spelling stores them. */
export interface TestColumns {
  readonly testId: Uint32Array;
  readonly testFile: Uint32Array;
  readonly testName: Uint32Array;
  /**
   * How each case settled: `0` it did not say, `1` it finished, `2` it stopped.
   * Absent in an index written before cases said how they settled.
   */
  readonly testStopped: Uint8Array | undefined;
  /** Absent in an index written before cases carried a duration. */
  readonly testDuration: Uint32Array | undefined;
  /** Absent in an index that listened to no case. */
  readonly testPreconditions: Uint32Array | undefined;
  /** The line that reached each region a case crossed; absent in an index written without cuts. */
  readonly testLines: LinesTable | undefined;
}

/** The string table: sorted by code unit, each string once. */
export interface StringTable {
  readonly blob: Uint8Array;
  readonly offsets: Uint32Array;
}

/**
 * A case index's module and region columns beside its test columns. A region's
 * `blockCalled` names the set of cases that crossed it after its module loaded,
 * and `sets.members` reads that set's case rows.
 */
export interface SetColumns extends TestColumns {
  readonly strings: StringTable;
  readonly moduleFile: Uint32Array;
  /** Where each module's regions begin, and one past the last module's. */
  readonly moduleBlocks: Uint32Array;
  readonly blockKind: Uint32Array;
  readonly blockName: Uint32Array;
  readonly blockPath: Uint32Array;
  readonly blockStart: Uint32Array;
  readonly blockEnd: Uint32Array;
  readonly blockSource: Uint8Array;
  readonly blockCalled: Uint32Array;
  /** `1` where the region ran while its module loaded, whichever version stored it. */
  readonly blockLoaded: Uint8Array;
  /**
   * Where the region around each region stands among its module's regions,
   * always before it, or {@link NO_OWNER}. Absent in an index written before
   * regions carried their owner, and in one whose producer does not write it.
   */
  readonly blockOwner: Uint32Array | undefined;
  readonly sets: CrossingSetsView;
}

export function stringTable(opened: OpenedSections): StringTable {
  const offsets = columnWords(opened, 'strings.off');
  const blob = columnBlob(opened, 'strings.blob', offsets);
  for (let id = 0; id + 1 < offsets.length; id += 1) {
    if (offsets[id + 1]! < offsets[id]! || offsets[id + 1]! > blob.length) throw invalid();
  }
  return { blob, offsets };
}

/** The test columns, each id checked against a table of `strings` strings. */
export function testColumns(opened: OpenedSections, strings: number): TestColumns {
  const words = (name: string): Uint32Array => named(columnWords(opened, name), strings);
  const testId = words('tests.id');
  const testFile = words('tests.file');
  const testName = words('tests.name');
  // Written since a case carries how it settled; a file without it says nothing.
  const testStopped = opened.found.has('tests.stopped') ? columnBytes(opened, 'tests.stopped') : undefined;
  // Written since a case carries its runner's duration; a file without it timed none.
  const testDuration = opened.found.has('tests.duration') ? columnWords(opened, 'tests.duration') : undefined;
  // Written since a case carries the preconditions it named; a file without it listened to none.
  const testPreconditions = opened.found.has(PRECONDITIONS_COLUMN) ? columnWords(opened, PRECONDITIONS_COLUMN) : undefined;
  const testCount = testId.length;
  if (testFile.length !== testCount || testName.length !== testCount) throw invalid();
  if (testDuration !== undefined && testDuration.length !== testCount) throw invalid();
  if (testPreconditions !== undefined && testPreconditions.length !== testCount) throw invalid();
  for (let test = 0; test < testCount && testStopped !== undefined; test += 1) {
    if ((testStopped[test] ?? 0) > STOPPED) throw invalid();
  }
  for (const id of testPreconditions ?? []) if (id !== UNHEARD && id >= strings) throw invalid();
  // Written since a cut case carries the line that reached each region; a file without it cut none.
  const testLines = opened.found.has(LINES_COLUMN) ? linesTable(opened, testCount) : undefined;
  return { testId, testFile, testName, testStopped, testDuration, testPreconditions, testLines };
}

function linesTable(opened: OpenedSections, testCount: number): LinesTable {
  const offsets = columnWords(opened, LINES_OFFSETS);
  if (offsets.length !== testCount + 1) throw invalid();
  const blob = columnBlob(opened, LINES_COLUMN, offsets);
  for (let test = 0; test < testCount; test += 1) {
    if (offsets[test + 1]! < offsets[test]! || offsets[test + 1]! > blob.length) throw invalid();
  }
  return { blob, offsets };
}

export function setColumns(opened: OpenedSections): SetColumns {
  const words = (name: string): Uint32Array => columnWords(opened, name);
  const flags = (name: string): Uint8Array => columnBytes(opened, name);
  const table = stringTable(opened);
  const strings = Math.max(table.offsets.length - 1, 0);
  const tests = testColumns(opened, strings);
  const testCount = tests.testId.length;

  const moduleFile = named(words('modules.file'), strings);
  const moduleBlocks = words('modules.blocks');
  const blockKind = named(words('blocks.kind'), strings);
  const blockName = named(words('blocks.name'), strings);
  const blockPath = named(words('blocks.path'), strings);
  const blockStart = words('blocks.start');
  const blockEnd = words('blocks.end');
  const blockSource = flags('blocks.source');
  const blockCalled = words('blocks.calledSet');
  const loadedSets = opened.header.version === LOADED_SETS_FORMAT;
  const stored = loadedSets ? words('blocks.loadedSet') : flags('blocks.loaded');
  if (moduleBlocks.length !== moduleFile.length + 1) throw invalid();
  const blockCount = blockKind.length;
  if ([blockName, blockPath, blockStart, blockEnd, blockSource, blockCalled, stored]
    .some((column) => column.length !== blockCount)) throw invalid();
  for (let module = 0; module < moduleFile.length; module += 1) {
    if (moduleBlocks[module + 1]! < moduleBlocks[module]! || moduleBlocks[module + 1]! > blockCount) throw invalid();
  }
  // Written since a region carries its owner; a file without it names no region around any.
  const blockOwner = opened.found.has('blocks.owner') ? words('blocks.owner') : undefined;
  if (blockOwner !== undefined && blockOwner.length !== blockCount) throw invalid();
  for (let module = 0; module < moduleFile.length && blockOwner !== undefined; module += 1) {
    const first = moduleBlocks[module]!;
    for (let block = first; block < moduleBlocks[module + 1]!; block += 1) {
      const owner = blockOwner[block]!;
      if (owner !== NO_OWNER && owner >= block - first) throw invalid();
    }
  }

  const setOffsets = words('sets.off');
  const sets = openCrossingSets({ bytes: columnBlob(opened, 'sets.blob', setOffsets), offsets: setOffsets, testCount });
  for (const set of blockCalled) if (set >= sets.size) throw invalid();
  // A flag reads as set only where it is 1, so a byte above it is copied as the 0 it reads as.
  const blockLoaded = loadedSets
    ? Uint8Array.from(stored, (set) => (members(sets, set, testCount).length > 0 ? 1 : 0))
    : stored.some((flag) => flag > 1) ? Uint8Array.from(stored, (flag) => (flag === 1 ? 1 : 0)) : stored as Uint8Array;
  return {
    strings: table,
    ...tests,
    moduleFile, moduleBlocks,
    blockKind, blockName, blockPath, blockStart, blockEnd, blockSource, blockCalled, blockLoaded, blockOwner,
    sets,
  };
}

/** The tests in `set`, refused when the pool does not hold it or it names a test the index does not. */
export function members(sets: CrossingSetsView, set: number, testCount: number): Uint32Array {
  if (set < 0 || set >= sets.size) throw invalid();
  const found = sets.members(set);
  if (found.some((test) => test >= testCount)) throw invalid();
  return found;
}

function named(column: Uint32Array, strings: number): Uint32Array {
  for (const id of column) if (id >= strings) throw invalid();
  return column;
}

export interface OpenedSections {
  readonly file: Bytes;
  readonly bytes: Uint8Array;
  readonly header: Header;
  readonly base: number;
  readonly found: ReadonlyMap<string, Section>;
}

export function sectionsOf(bytes: Uint8Array): OpenedSections {
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

export function columnWords(opened: OpenedSections, name: string): Uint32Array {
  const section = opened.found.get(name);
  if (section === undefined) throw invalid();
  if (section.rows !== undefined) return openWords(stored(opened, name), section.rows).all();
  if (section.length % 4 !== 0) throw invalid();
  const bytes = whole(opened, name);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, section.length / 4);
}

export function columnBytes(opened: OpenedSections, name: string): Uint8Array {
  const section = opened.found.get(name);
  if (section === undefined) throw invalid();
  return section.rows === undefined ? whole(opened, name) : openBytes(stored(opened, name), section.rows).all();
}

export function columnBlob(opened: OpenedSections, name: string, offsets: Uint32Array): Uint8Array {
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

export function fail(): never {
  throw invalid();
}

export function invalid(): Error {
  return new Error('not a variance-authority execution index');
}
