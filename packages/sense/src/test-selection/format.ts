import type {
  CoverageBlock,
  CoverageModule,
  CoveragePrecondition,
  CoverageTest,
  TestCoverage,
} from './index.js';
import { validateCoverageColumns } from './format-validation.js';

const VERSION = 3;
const ALIGNMENT = 8;
const NO_OWNER = 0xffff_ffff;

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
  if (coverage.version !== VERSION) {
    throw new Error(`unsupported test coverage version: ${coverage.version}`);
  }
  const normalized = normalize(coverage);
  const strings = dictionary(normalized);
  const stringIds = new Map(strings.map((value, index) => [value, index]));
  const stringId = (value: string): number => stringIds.get(value)!;
  const testIds = new Map(normalized.tests.map((value, index) => [value.file, index]));
  if (testIds.size !== normalized.tests.length) throw new Error('duplicate test coverage observation');
  const blockCount = normalized.modules.reduce((total, module) => total + module.blocks.length, 0);
  const crossingCount = normalized.modules.reduce(
    (total, module) => total + module.blocks.reduce((sum, block) => sum + block.testFiles.length, 0),
    0,
  );
  const preconditionCount = normalized.tests.reduce(
    (total, test) => total + test.preconditions.length,
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

  const instrumentation = Uint32Array.of(stringId(normalized.instrumentation));
  // Empty rather than a sentinel id: an index recorded outside a checkout has no
  // position, and a zero-length column is how the file says so without inventing
  // a commit that would later be diffed against.
  const commit =
    normalized.commit === undefined
      ? new Uint32Array(0)
      : Uint32Array.of(stringId(normalized.commit));
  const testPaths = Uint32Array.from(normalized.tests, (test) => stringId(test.file));
  const testComplete = Uint8Array.from(normalized.tests, (test) => test.complete ? 1 : 0);
  const testPreconditions = new Uint32Array(normalized.tests.length + 1);
  const preconditionName = new Uint32Array(preconditionCount);
  const preconditionDigest = new Uint32Array(preconditionCount);
  let preconditionIndex = 0;
  for (const [testIndex, test] of normalized.tests.entries()) {
    testPreconditions[testIndex] = preconditionIndex;
    for (const precondition of test.preconditions) {
      preconditionName[preconditionIndex] = stringId(precondition.name);
      preconditionDigest[preconditionIndex] = stringId(precondition.digest);
      preconditionIndex += 1;
    }
  }
  testPreconditions[normalized.tests.length] = preconditionIndex;

  const modulePaths = new Uint32Array(normalized.modules.length);
  const moduleSource = new Uint32Array(normalized.modules.length);
  const moduleInstrumented = new Uint8Array(normalized.modules.length);
  const moduleBlocks = new Uint32Array(normalized.modules.length + 1);
  const blockOrdinal = new Uint32Array(blockCount);
  const blockKind = new Uint8Array(blockCount);
  const blockOwner = new Uint32Array(blockCount);
  const blockDigest = new Uint32Array(blockCount);
  const blockName = new Uint32Array(blockCount);
  const blockPath = new Uint32Array(blockCount);
  const blockStart = new Uint32Array(blockCount);
  const blockEnd = new Uint32Array(blockCount);
  const blockSource = new Uint8Array(blockCount);
  const blockTests = new Uint32Array(blockCount + 1);
  const crossingTest = new Uint32Array(crossingCount);

  let blockIndex = 0;
  let crossingIndex = 0;
  for (const [moduleIndex, module] of normalized.modules.entries()) {
    modulePaths[moduleIndex] = stringId(module.file);
    moduleSource[moduleIndex] = stringId(module.sourceDigest);
    moduleInstrumented[moduleIndex] = module.instrumented ? 1 : 0;
    moduleBlocks[moduleIndex] = blockIndex;
    for (const block of module.blocks) {
      blockOrdinal[blockIndex] = block.ordinal;
      blockKind[blockIndex] = kindId(block.kind);
      blockOwner[blockIndex] = block.owner ?? NO_OWNER;
      blockDigest[blockIndex] = stringId(block.digest);
      blockName[blockIndex] = stringId(block.name);
      blockPath[blockIndex] = stringId(block.path);
      blockStart[blockIndex] = block.startLine;
      blockEnd[blockIndex] = block.endLine;
      blockSource[blockIndex] = block.source ? 1 : 0;
      blockTests[blockIndex] = crossingIndex;
      for (const testFile of block.testFiles) {
        const test = testIds.get(testFile);
        if (test === undefined) {
          throw new Error(`coverage crossing names an unobserved test: ${testFile}`);
        }
        crossingTest[crossingIndex++] = test;
      }
      blockIndex += 1;
    }
  }
  moduleBlocks[normalized.modules.length] = blockIndex;
  blockTests[blockCount] = crossingIndex;

  return sections({
    'strings.blob': stringBlob,
    'strings.off': bytes(stringOffsets),
    'snapshot.instrumentation': bytes(instrumentation),
    'snapshot.commit': bytes(commit),
    'tests.path': bytes(testPaths),
    'tests.complete': bytes(testComplete),
    'tests.preconditions': bytes(testPreconditions),
    'preconditions.name': bytes(preconditionName),
    'preconditions.digest': bytes(preconditionDigest),
    'modules.path': bytes(modulePaths),
    'modules.source': bytes(moduleSource),
    'modules.instrumented': bytes(moduleInstrumented),
    'modules.blocks': bytes(moduleBlocks),
    'blocks.ordinal': bytes(blockOrdinal),
    'blocks.kind': bytes(blockKind),
    'blocks.owner': bytes(blockOwner),
    'blocks.digest': bytes(blockDigest),
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
  const tests: CoverageTest[] = [];
  for (let test = 0; test < view.testPath.length; test += 1) {
    const preconditions: CoveragePrecondition[] = [];
    for (
      let input = view.testPreconditions[test]!;
      input < view.testPreconditions[test + 1]!;
      input += 1
    ) {
      preconditions.push({
        name: view.string(view.preconditionName[input]!),
        digest: view.string(view.preconditionDigest[input]!),
      });
    }
    tests.push({
      file: view.string(view.testPath[test]!),
      complete: view.testComplete[test] === 1,
      preconditions,
    });
  }
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
        ...(view.blockOwner[block] === NO_OWNER ? {} : { owner: view.blockOwner[block]! }),
        digest: view.string(view.blockDigest[block]!),
        name: view.string(view.blockName[block]!),
        path: view.string(view.blockPath[block]!),
        startLine: view.blockStart[block]!,
        endLine: view.blockEnd[block]!,
        source: view.blockSource[block] === 1,
        testFiles,
      });
    }
    modules.push({
      file: view.string(view.modulePath[module]!),
      sourceDigest: view.string(view.moduleSource[module]!),
      instrumented: view.moduleInstrumented[module] === 1,
      blocks,
    });
  }
  return {
    version: 3,
    instrumentation: view.instrumentation,
    ...(view.commit === undefined ? {} : { commit: view.commit }),
    tests,
    modules,
  };
}

export interface TestCoverageView {
  readonly instrumentation: string;
  /** The commit this snapshot was recorded at; absent when it has no position. */
  readonly commit: string | undefined;
  readonly testPath: Uint32Array;
  readonly testComplete: Uint8Array;
  readonly testPreconditions: Uint32Array;
  readonly preconditionName: Uint32Array;
  readonly preconditionDigest: Uint32Array;
  readonly modulePath: Uint32Array;
  readonly moduleSource: Uint32Array;
  readonly moduleInstrumented: Uint8Array;
  readonly moduleBlocks: Uint32Array;
  readonly blockOrdinal: Uint32Array;
  readonly blockKind: Uint8Array;
  readonly blockOwner: Uint32Array;
  readonly blockDigest: Uint32Array;
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
  if (!validSections(header.sections, raw.length - base)) throw invalid();
  const found = new Map(header.sections.map((section) => [section.name, section]));
  const section = (name: string): Section => {
    const value = found.get(name);
    if (value === undefined) throw invalid();
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
  const instrumentation = u32('snapshot.instrumentation');
  const commit = u32('snapshot.commit');
  const testPath = u32('tests.path');
  const testComplete = u8('tests.complete');
  const testPreconditions = u32('tests.preconditions');
  const preconditionName = u32('preconditions.name');
  const preconditionDigest = u32('preconditions.digest');
  const modulePath = u32('modules.path');
  const moduleSource = u32('modules.source');
  const moduleInstrumented = u8('modules.instrumented');
  const moduleBlocks = u32('modules.blocks');
  const blockOrdinal = u32('blocks.ordinal');
  const blockKind = u8('blocks.kind');
  const blockOwner = u32('blocks.owner');
  const blockDigest = u32('blocks.digest');
  const blockName = u32('blocks.name');
  const blockPath = u32('blocks.path');
  const blockStart = u32('blocks.start');
  const blockEnd = u32('blocks.end');
  const blockSource = u8('blocks.source');
  const blockTests = u32('blocks.tests');
  const crossingTest = u32('crossings.test');
  validateCoverageColumns({
    stringOffsets, stringBytes: stringBlob.length, instrumentation, commit,
    testPath, testComplete, testPreconditions, preconditionName, preconditionDigest,
    modulePath, moduleSource, moduleInstrumented, moduleBlocks,
    blockOrdinal, blockKind, blockOwner, blockDigest, blockName, blockPath,
    blockStart, blockEnd, blockSource, blockTests, crossingTest,
    kindCount: KINDS.length, noOwner: NO_OWNER,
  });

  const stringAt = (id: number): string => {
    const start = stringOffsets[id];
    const end = stringOffsets[id + 1];
    if (start === undefined || end === undefined || end > stringBlob.length) throw invalid();
    return decoder.decode(stringBlob.subarray(start, end));
  };

  return {
    instrumentation: (() => {
      const value = instrumentation[0];
      if (value === undefined) throw invalid();
      return stringAt(value);
    })(),
    commit: commit.length === 0 ? undefined : stringAt(commit[0]!),
    testPath,
    testComplete,
    testPreconditions,
    preconditionName,
    preconditionDigest,
    modulePath,
    moduleSource,
    moduleInstrumented,
    moduleBlocks,
    blockOrdinal,
    blockKind,
    blockOwner,
    blockDigest,
    blockName,
    blockPath,
    blockStart,
    blockEnd,
    blockSource,
    blockTests,
    crossingTest,
    string: stringAt,
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
      width: name.endsWith('.kind') ||
          name.endsWith('.complete') ||
          name.endsWith('.instrumented') ||
          name === 'blocks.source' ||
          name.endsWith('.blob')
        ? 1
        : 4,
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
  values.add(coverage.instrumentation);
  if (coverage.commit !== undefined) values.add(coverage.commit);
  for (const test of coverage.tests) {
    values.add(test.file);
    for (const precondition of test.preconditions) {
      values.add(precondition.name);
      values.add(precondition.digest);
    }
  }
  for (const module of coverage.modules) {
    values.add(module.file);
    values.add(module.sourceDigest);
    for (const block of module.blocks) {
      values.add(block.name);
      values.add(block.path);
      values.add(block.digest);
      for (const testFile of block.testFiles) values.add(testFile);
    }
  }
  return [...values].sort(codeUnitOrder);
}

function normalize(coverage: TestCoverage): TestCoverage {
  const tests = coverage.tests
    .map((test): CoverageTest => ({
      ...test,
      preconditions: uniquePreconditions(test.preconditions),
    }))
    .sort((left, right) => codeUnitOrder(left.file, right.file));
  const modules = coverage.modules
    .map((module): CoverageModule => ({
      ...module,
      blocks: [...module.blocks]
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((block): CoverageBlock => ({
          ...block,
          testFiles: [...new Set(block.testFiles)].sort(codeUnitOrder),
        })),
    }))
    .sort((left, right) => codeUnitOrder(left.file, right.file));
  return { ...coverage, tests, modules };
}

function uniquePreconditions(
  preconditions: readonly CoveragePrecondition[],
): readonly CoveragePrecondition[] {
  const keyed = new Map(preconditions.map((value) => [`${value.name}\0${value.digest}`, value]));
  return [...keyed.values()].sort((left, right) =>
    codeUnitOrder(left.name, right.name) || codeUnitOrder(left.digest, right.digest),
  );
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

function validSections(sections: readonly Section[], available: number): boolean {
  if (!Array.isArray(sections) || sections.length === 0) return false;
  if (new Set(sections.map((section) => section.name)).size !== sections.length) return false;
  const ordered = [...sections].sort((left, right) => left.offset - right.offset);
  let end = 0;
  for (const section of ordered) {
    if (
      typeof section.name !== 'string' ||
      !Number.isSafeInteger(section.offset) ||
      !Number.isSafeInteger(section.length) ||
      section.offset < end ||
      section.offset % ALIGNMENT !== 0 ||
      section.length < 0 ||
      section.length > available - section.offset ||
      (section.width !== 1 && section.width !== 4)
    ) return false;
    end = section.offset + section.length;
  }
  return ordered[0]?.offset === 0;
}

function invalid(): Error {
  return new Error('not a variance-authority test coverage artifact');
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
