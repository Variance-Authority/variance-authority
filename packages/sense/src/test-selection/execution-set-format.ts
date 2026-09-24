import { openBlob, openBytes, openWords, resident, type Bytes } from './columns.js';
import { blob, column, sections, validSections, type Header, type Section } from './format-layout.js';
import { openCrossingSets } from './crossing-sets-read.js';
import type { CrossingSetsPool, SetId } from './crossing-sets.js';
import { intern } from '@variance-authority/core/segment';
import type { ExecutionBlock, ExecutionIndex, ExecutionModule, ExecutionTest } from './reverse.js';

/**
 * A journey-only execution index: every crossing has measured distance zero.
 *
 * Version 3 records load time as one flag per region ({@link
 * ExecutionBlock.loaded}); version 2 recorded the set of cases that loaded each
 * region, and is still read, as the flag its set implies.
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
 */
export function encodeSetExecutionIndex(index: SetExecutionIndex): Buffer {
  const { strings, id } = intern(dictionary(index));
  const encoded = strings.map((value) => Buffer.from(value, 'utf8'));
  const stringOffsets = new Uint32Array(strings.length + 1);
  let byteOffset = 0;
  for (const [at, bytes] of encoded.entries()) {
    stringOffsets[at] = byteOffset;
    byteOffset += bytes.length;
  }
  stringOffsets[strings.length] = byteOffset;

  const blockCount = index.modules.reduce((total, module) => total + module.blocks.length, 0);
  const moduleFile = new Uint32Array(index.modules.length);
  const moduleBlocks = new Uint32Array(index.modules.length + 1);
  const blockKind = new Uint32Array(blockCount);
  const blockName = new Uint32Array(blockCount);
  const blockPath = new Uint32Array(blockCount);
  const blockStart = new Uint32Array(blockCount);
  const blockEnd = new Uint32Array(blockCount);
  const blockSource = new Uint8Array(blockCount);
  const blockCalled = new Uint32Array(blockCount);
  const blockLoaded = new Uint8Array(blockCount);

  let block = 0;
  for (const [moduleAt, module] of index.modules.entries()) {
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
  moduleBlocks[index.modules.length] = block;

  return sections({
    'strings.blob': blob(Buffer.concat(encoded), stringOffsets),
    'strings.off': column(stringOffsets),
    'tests.id': column(Uint32Array.from(index.tests, (test) => id(test.id))),
    'tests.file': column(Uint32Array.from(index.tests, (test) => id(test.file))),
    'tests.name': column(Uint32Array.from(index.tests, (test) => id(test.name))),
    'tests.stopped': column(stoppedColumn(index.tests)),
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

/** Read the compact journey spelling into the runner-independent object model. */
export function decodeSetExecutionIndex(bytes: Uint8Array): ExecutionIndex {
  const opened = sectionsOf(bytes);
  const version = opened.header.version;
  if (version !== SET_EXECUTION_FORMAT && version !== LOADED_SETS_FORMAT) {
    throw new Error(`unsupported execution index version: ${opened.header.version}`);
  }
  const words = (name: string): Uint32Array => columnWords(opened, name);
  const flags = (name: string): Uint8Array => columnBytes(opened, name);
  const stringOffsets = words('strings.off');
  const stringBlob = columnBlob(opened, 'strings.blob', stringOffsets);
  const decoder = new TextDecoder();
  const strings: string[] = [];
  for (let id = 0; id + 1 < stringOffsets.length; id += 1) {
    const from = stringOffsets[id]!;
    const to = stringOffsets[id + 1]!;
    if (to < from || to > stringBlob.length) throw invalid();
    strings.push(decoder.decode(stringBlob.subarray(from, to)));
  }
  const string = (id: number): string => strings[id] ?? fail();

  const testId = words('tests.id');
  const testFile = words('tests.file');
  const testName = words('tests.name');
  // Written since a case carries how it settled; a file without it says nothing.
  const testStopped = opened.found.has('tests.stopped') ? flags('tests.stopped') : undefined;
  if (testFile.length !== testId.length || testName.length !== testId.length) throw invalid();
  const tests: ExecutionTest[] = [];
  for (let at = 0; at < testId.length; at += 1) {
    tests.push({
      id: string(testId[at]!),
      file: string(testFile[at]!),
      name: string(testName[at]!),
      ...stoppedFrom(testStopped, at),
    });
  }

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
  const modules: ExecutionModule[] = [];
  for (let module = 0; module < moduleFile.length; module += 1) {
    const first = moduleBlocks[module]!;
    const last = moduleBlocks[module + 1]!;
    if (last < first || last > blockCount) throw invalid();
    const blocks: ExecutionBlock[] = [];
    for (let block = first; block < last; block += 1) {
      const called = members(sets, blockCalled[block]!, tests.length);
      const loaded = version === LOADED_SETS_FORMAT
        ? members(sets, blockLoaded[block]!, tests.length).length > 0
        : blockLoaded[block] === 1;
      blocks.push({
        kind: string(blockKind[block]!),
        name: string(blockName[block]!),
        path: string(blockPath[block]!),
        startLine: blockStart[block]!,
        endLine: blockEnd[block]!,
        source: blockSource[block] === 1,
        ...(loaded ? { loaded: true as const } : {}),
        crossings: Array.from(called, (test) => ({ test, distance: 0 })),
      });
    }
    modules.push({ file: string(moduleFile[module]!), blocks });
  }
  return { tests, modules };
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
  sets: ReturnType<typeof openCrossingSets>,
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

function fail(): never {
  throw invalid();
}

function invalid(): Error {
  return new Error('not a variance-authority execution index');
}
