import type { CoverageBlock, CoverageModule, TestCoverage } from './index.js';

const VERSION = 1;
const ALIGNMENT = 8;

interface Section {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
  readonly width: 1 | 4;
}

interface Header {
  readonly version: number;
  readonly sections: readonly Section[];
}

const KINDS = [
  'module',
  'function',
  'branch',
  'continuation',
  'resume',
  'loop',
  'case',
  'handler',
] as const;

/**
 * One versioned snapshot: interned strings, dense block columns, and a CSR
 * block-to-test relation. No path or block object is repeated in the file.
 */
export function encodeTestCoverage(coverage: TestCoverage): Buffer {
  const strings = dictionary(coverage);
  const stringIds = new Map(strings.map((value, index) => [value, index]));
  const stringId = (value: string): number => stringIds.get(value)!;
  const tests = [...new Set([
    ...coverage.testFiles,
    ...coverage.modules.flatMap((module) => module.blocks.flatMap((block) => block.testFiles)),
  ])].sort(codeUnitOrder);
  const testIds = new Map(tests.map((value, index) => [value, index]));
  const blockCount = coverage.modules.reduce((total, module) => total + module.blocks.length, 0);
  const crossingCount = coverage.modules.reduce(
    (total, module) => total + module.blocks.reduce((sum, block) => sum + block.testFiles.length, 0),
    0,
  );

  const stringBytes = strings.map((value) => Buffer.from(value, 'utf8'));
  const stringBlob = Buffer.concat(stringBytes);
  const stringOffsets = new Uint32Array(strings.length + 1);
  let byteOffset = 0;
  for (const [index, bytes] of stringBytes.entries()) {
    stringOffsets[index] = byteOffset;
    byteOffset += bytes.length;
  }
  stringOffsets[strings.length] = byteOffset;

  const modulePaths = new Uint32Array(coverage.modules.length);
  const moduleBlocks = new Uint32Array(coverage.modules.length + 1);
  const blockOrdinal = new Uint32Array(blockCount);
  const blockKind = new Uint8Array(blockCount);
  const blockName = new Uint32Array(blockCount);
  const blockPath = new Uint32Array(blockCount);
  const blockStart = new Uint32Array(blockCount);
  const blockEnd = new Uint32Array(blockCount);
  const blockSource = new Uint8Array(blockCount);
  const blockTests = new Uint32Array(blockCount + 1);
  const crossingTest = new Uint32Array(crossingCount);
  const testPaths = Uint32Array.from(tests, stringId);

  let blockIndex = 0;
  let crossingIndex = 0;
  for (const [moduleIndex, module] of coverage.modules.entries()) {
    modulePaths[moduleIndex] = stringId(module.file);
    moduleBlocks[moduleIndex] = blockIndex;
    for (const block of module.blocks) {
      blockOrdinal[blockIndex] = block.ordinal;
      blockKind[blockIndex] = kindId(block.kind);
      blockName[blockIndex] = stringId(block.name);
      blockPath[blockIndex] = stringId(block.path);
      blockStart[blockIndex] = block.startLine;
      blockEnd[blockIndex] = block.endLine;
      blockSource[blockIndex] = block.source ? 1 : 0;
      blockTests[blockIndex] = crossingIndex;
      for (const testFile of block.testFiles) crossingTest[crossingIndex++] = testIds.get(testFile)!;
      blockIndex += 1;
    }
  }
  moduleBlocks[coverage.modules.length] = blockIndex;
  blockTests[blockCount] = crossingIndex;

  return sections({
    'strings.blob': stringBlob,
    'strings.off': bytes(stringOffsets),
    'tests.path': bytes(testPaths),
    'modules.path': bytes(modulePaths),
    'modules.blocks': bytes(moduleBlocks),
    'blocks.ordinal': bytes(blockOrdinal),
    'blocks.kind': bytes(blockKind),
    'blocks.name': bytes(blockName),
    'blocks.path': bytes(blockPath),
    'blocks.start': bytes(blockStart),
    'blocks.end': bytes(blockEnd),
    'blocks.source': bytes(blockSource),
    'blocks.tests': bytes(blockTests),
    'crossings.test': bytes(crossingTest),
  });
}

/** Decode the snapshot for callers that explicitly ask for the logical model. */
export function decodeTestCoverage(bytes: Uint8Array): TestCoverage {
  const view = openTestCoverage(bytes);
  const modules: CoverageModule[] = [];
  for (let module = 0; module < view.modulePath.length; module += 1) {
    const blocks: CoverageBlock[] = [];
    for (let block = view.moduleBlocks[module]!; block < view.moduleBlocks[module + 1]!; block += 1) {
      const testFiles: string[] = [];
      for (let crossing = view.blockTests[block]!; crossing < view.blockTests[block + 1]!; crossing += 1) {
        testFiles.push(view.string(view.testPath[view.crossingTest[crossing]!]!));
      }
      blocks.push({
        ordinal: view.blockOrdinal[block]!,
        kind: KINDS[view.blockKind[block]!] ?? 'unknown',
        name: view.string(view.blockName[block]!),
        path: view.string(view.blockPath[block]!),
        startLine: view.blockStart[block]!,
        endLine: view.blockEnd[block]!,
        source: view.blockSource[block] === 1,
        testFiles,
      });
    }
    modules.push({ file: view.string(view.modulePath[module]!), blocks });
  }
  const testFiles = Array.from(view.testPath, (path) => view.string(path));
  return { version: 1, testFiles, modules };
}

export interface TestCoverageView {
  readonly testPath: Uint32Array;
  readonly modulePath: Uint32Array;
  readonly moduleBlocks: Uint32Array;
  readonly blockOrdinal: Uint32Array;
  readonly blockKind: Uint8Array;
  readonly blockName: Uint32Array;
  readonly blockPath: Uint32Array;
  readonly blockStart: Uint32Array;
  readonly blockEnd: Uint32Array;
  readonly blockSource: Uint8Array;
  readonly blockTests: Uint32Array;
  readonly crossingTest: Uint32Array;
  string(id: number): string;
}

/** Open typed-array views over a snapshot; only the small section index is parsed. */
export function openTestCoverage(input: Uint8Array): TestCoverageView {
  const raw = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (raw.length < 4) throw invalid();
  const headerLength = raw.readUInt32LE(0);
  if (headerLength > raw.length - 4) throw invalid();
  const header = JSON.parse(raw.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as Header;
  if (header.version !== VERSION) throw new Error(`unsupported test coverage version: ${header.version}`);
  const base = 4 + headerLength;
  const found = new Map(header.sections.map((section) => [section.name, section]));
  const section = (name: string): Section => {
    const value = found.get(name);
    if (value === undefined || base + value.offset + value.length > raw.length) throw invalid();
    return value;
  };
  const u8 = (name: string): Uint8Array => {
    const value = section(name);
    return new Uint8Array(raw.buffer, raw.byteOffset + base + value.offset, value.length);
  };
  const u32 = (name: string): Uint32Array => {
    const value = section(name);
    if (value.length % 4 !== 0) throw invalid();
    return new Uint32Array(raw.buffer, raw.byteOffset + base + value.offset, value.length / 4);
  };
  const stringBlob = u8('strings.blob');
  const stringOffsets = u32('strings.off');
  const decoder = new TextDecoder();

  return {
    testPath: u32('tests.path'),
    modulePath: u32('modules.path'),
    moduleBlocks: u32('modules.blocks'),
    blockOrdinal: u32('blocks.ordinal'),
    blockKind: u8('blocks.kind'),
    blockName: u32('blocks.name'),
    blockPath: u32('blocks.path'),
    blockStart: u32('blocks.start'),
    blockEnd: u32('blocks.end'),
    blockSource: u8('blocks.source'),
    blockTests: u32('blocks.tests'),
    crossingTest: u32('crossings.test'),
    string(id) {
      const start = stringOffsets[id];
      const end = stringOffsets[id + 1];
      if (start === undefined || end === undefined || end > stringBlob.length) throw invalid();
      return decoder.decode(stringBlob.subarray(start, end));
    },
  };
}

function sections(input: Readonly<Record<string, Buffer>>): Buffer {
  const chunks: Buffer[] = [];
  const index: Section[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(input)) {
    index.push({
      name,
      offset,
      length: value.length,
      width: name.endsWith('.kind') || name.endsWith('.source') || name.endsWith('.blob') ? 1 : 4,
    });
    chunks.push(value);
    offset += value.length;
    const padding = aligned(offset) - offset;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
    offset += padding;
  }
  const encoded = Buffer.from(JSON.stringify({ version: VERSION, sections: index }), 'utf8');
  const headerLength = aligned(4 + encoded.length) - 4;
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(headerLength);
  return Buffer.concat([prefix, encoded, Buffer.alloc(headerLength - encoded.length), ...chunks]);
}

function dictionary(coverage: TestCoverage): readonly string[] {
  const values = new Set<string>();
  for (const testFile of coverage.testFiles) values.add(testFile);
  for (const module of coverage.modules) {
    values.add(module.file);
    for (const block of module.blocks) {
      values.add(block.name);
      values.add(block.path);
      for (const testFile of block.testFiles) values.add(testFile);
    }
  }
  return [...values].sort(codeUnitOrder);
}

function kindId(kind: string): number {
  const id = KINDS.indexOf(kind as (typeof KINDS)[number]);
  if (id < 0) throw new Error(`unknown coverage block kind: ${kind}`);
  return id;
}

function bytes(array: Uint8Array | Uint32Array): Buffer {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function aligned(value: number): number {
  return Math.ceil(value / ALIGNMENT) * ALIGNMENT;
}

function invalid(): Error {
  return new Error('not a variance-authority test coverage artifact');
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
