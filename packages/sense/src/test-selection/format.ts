import type {
  CoverageBlock,
  CoverageModule,
  CoveragePrecondition,
  CoverageTest,
  TestCoverage,
} from './index.js';
import {
  KINDS,
  MODEL,
  NO_OWNER,
  blob,
  column,
  kindId,
  sections,
} from './format-layout.js';
import { openTestCoverage } from './format-view.js';

/**
 * The logical model, written to a snapshot and read back out of one.
 *
 * A query never comes through here: it opens the file and reads the columns it
 * needs. The objects are for the callers that want all of it — a merge folding
 * two records together, a caller handed a snapshot it did not record.
 */

/**
 * One versioned snapshot: interned strings, dense block columns, and a CSR
 * block-to-test relation. No path or block object is repeated in the file.
 */
export function encodeTestCoverage(coverage: TestCoverage): Buffer {
  if (coverage.version !== MODEL) {
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
    'strings.blob': blob(stringBlob, stringOffsets),
    'strings.off': column(stringOffsets),
    'snapshot.instrumentation': column(instrumentation),
    'snapshot.commit': column(commit),
    'tests.path': column(testPaths),
    'tests.complete': column(testComplete),
    'tests.preconditions': column(testPreconditions),
    'preconditions.name': column(preconditionName),
    'preconditions.digest': column(preconditionDigest),
    'modules.path': column(modulePaths),
    'modules.source': column(moduleSource),
    'modules.instrumented': column(moduleInstrumented),
    'modules.blocks': column(moduleBlocks),
    'blocks.ordinal': column(blockOrdinal),
    'blocks.kind': column(blockKind),
    'blocks.owner': column(blockOwner),
    'blocks.digest': column(blockDigest),
    'blocks.name': column(blockName),
    'blocks.path': column(blockPath),
    'blocks.start': column(blockStart),
    'blocks.end': column(blockEnd),
    'blocks.source': column(blockSource),
    'blocks.tests': column(blockTests),
    'crossings.test': column(crossingTest),
  });
}


/** Decode the snapshot for callers that explicitly ask for the logical model. */
export function decodeTestCoverage(bytes: Uint8Array): TestCoverage {
  const view = openTestCoverage(bytes);
  // One string object per id rather than one per use. A path is named again by
  // every region of its module and again by every crossing that entered one —
  // eight million uses of eight thousand distinct files in a repository-sized
  // snapshot — and decoding each use on its own is most of what the model
  // costs to build and nearly three quarters of what it costs to hold.
  //
  // The view does not do this. A query asks for a handful of strings and must
  // not accumulate them; a decode asks for all of them by definition, so the
  // table is bounded by the dictionary and is discarded with the model.
  const held = new Map<number, string>();
  const string = (id: number): string => {
    const found = held.get(id);
    if (found !== undefined) return found;
    const value = view.string(id);
    held.set(id, value);
    return value;
  };
  // Every column once. A decode is the read the columns materialize for, and
  // asking a column by the row inside these loops would decompress its run
  // again for every row of it.
  const testPath = view.testPath.all();
  const testComplete = view.testComplete.all();
  const testPreconditions = view.testPreconditions.all();
  const preconditionName = view.preconditionName.all();
  const preconditionDigest = view.preconditionDigest.all();
  const tests: CoverageTest[] = [];
  for (let test = 0; test < testPath.length; test += 1) {
    const preconditions: CoveragePrecondition[] = [];
    for (let input = testPreconditions[test]!; input < testPreconditions[test + 1]!; input += 1) {
      preconditions.push({
        name: string(preconditionName[input]!),
        digest: string(preconditionDigest[input]!),
      });
    }
    tests.push({
      file: string(testPath[test]!),
      complete: testComplete[test] === 1,
      preconditions,
    });
  }
  const modulePath = view.modulePath.all();
  const moduleSource = view.moduleSource.all();
  const moduleInstrumented = view.moduleInstrumented.all();
  const moduleBlocks = view.moduleBlocks.all();
  const blockOrdinal = view.blockOrdinal.all();
  const blockKind = view.blockKind.all();
  const blockOwner = view.blockOwner.all();
  const blockDigest = view.blockDigest.all();
  const blockName = view.blockName.all();
  const blockPath = view.blockPath.all();
  const blockStart = view.blockStart.all();
  const blockEnd = view.blockEnd.all();
  const blockSource = view.blockSource.all();
  const blockTests = view.blockTests.all();
  const crossingTest = view.crossingTest.all();
  const modules: CoverageModule[] = [];
  for (let module = 0; module < modulePath.length; module += 1) {
    const blocks: CoverageBlock[] = [];
    for (let block = moduleBlocks[module]!; block < moduleBlocks[module + 1]!; block += 1) {
      const testFiles: string[] = [];
      for (let crossing = blockTests[block]!; crossing < blockTests[block + 1]!; crossing += 1) {
        testFiles.push(string(testPath[crossingTest[crossing]!]!));
      }
      blocks.push({
        ordinal: blockOrdinal[block]!,
        kind: KINDS[blockKind[block]!]!,
        ...(blockOwner[block] === NO_OWNER ? {} : { owner: blockOwner[block]! }),
        digest: string(blockDigest[block]!),
        name: string(blockName[block]!),
        path: string(blockPath[block]!),
        startLine: blockStart[block]!,
        endLine: blockEnd[block]!,
        source: blockSource[block] === 1,
        testFiles,
      });
    }
    modules.push({
      file: string(modulePath[module]!),
      sourceDigest: string(moduleSource[module]!),
      instrumented: moduleInstrumented[module] === 1,
      blocks,
    });
  }
  return {
    version: MODEL,
    instrumentation: view.instrumentation,
    ...(view.commit === undefined ? {} : { commit: view.commit }),
    tests,
    modules,
  };
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

/**
 * The snapshot in the order a snapshot is written in, and the snapshot itself
 * when it already stands in that order.
 *
 * Which is nearly always. What reaches an encode came out of a merge that
 * folded two ordered snapshots together, or off a disk it was written to in
 * this order, and the sorting here is a proof rather than a change. A pass that
 * rebuilt regardless would allocate the whole model a second time — every module,
 * every region, and a set per region to walk its crossings through — which at a
 * repository's scale is the encode's peak and half its time, spent to arrive at
 * the objects it was handed.
 */
function normalize(coverage: TestCoverage): TestCoverage {
  const tests = settle(ordered(coverage.tests, (test) => test.file), settledTest);
  const modules = settle(ordered(coverage.modules, (module) => module.file), settledModule);
  return tests === coverage.tests && modules === coverage.modules
    ? coverage
    : { ...coverage, tests, modules };
}

/** Each value settled, and the list itself when every one of them already was. */
function settle<T>(values: readonly T[], of: (value: T) => T): readonly T[] {
  let next: T[] | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const held = of(value);
    if (held === value) next?.push(value);
    else {
      next ??= values.slice(0, index);
      next.push(held);
    }
  }
  return next ?? values;
}

/** Sorted by a name, and unsorted only when some pair of them runs backwards. */
function ordered<T>(values: readonly T[], name: (value: T) => string): readonly T[] {
  const order = (left: T, right: T): number => codeUnitOrder(name(left), name(right));
  for (let index = 1; index < values.length; index += 1) {
    if (order(values[index - 1]!, values[index]!) > 0) return [...values].sort(order);
  }
  return values;
}

function settledModule(module: CoverageModule): CoverageModule {
  const blocks = settle(byOrdinal(module.blocks), settledBlock);
  return blocks === module.blocks ? module : { ...module, blocks };
}

function byOrdinal(blocks: readonly CoverageBlock[]): readonly CoverageBlock[] {
  for (let index = 1; index < blocks.length; index += 1) {
    if (blocks[index - 1]!.ordinal > blocks[index]!.ordinal) {
      return [...blocks].sort((left, right) => left.ordinal - right.ordinal);
    }
  }
  return blocks;
}

function settledBlock(block: CoverageBlock): CoverageBlock {
  const testFiles = distinct(block.testFiles);
  return testFiles === block.testFiles ? block : { ...block, testFiles };
}

/**
 * Crossings in code-unit order with no name twice.
 *
 * Strictly increasing is both of those at once, which is why the scan tests the
 * pair rather than sorting and then looking for neighbours that match.
 */
function distinct(values: readonly string[]): readonly string[] {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) return [...new Set(values)].sort(codeUnitOrder);
  }
  return values;
}

function settledTest(test: CoverageTest): CoverageTest {
  const preconditions = uniquePreconditions(test.preconditions);
  return preconditions === test.preconditions ? test : { ...test, preconditions };
}

function uniquePreconditions(
  preconditions: readonly CoveragePrecondition[],
): readonly CoveragePrecondition[] {
  const order = (left: CoveragePrecondition, right: CoveragePrecondition): number =>
    codeUnitOrder(left.name, right.name) || codeUnitOrder(left.digest, right.digest);
  let standing = true;
  for (let index = 1; index < preconditions.length && standing; index += 1) {
    standing = order(preconditions[index - 1]!, preconditions[index]!) < 0;
  }
  if (standing) return preconditions;
  const keyed = new Map(preconditions.map((value) => [`${value.name}\0${value.digest}`, value]));
  return [...keyed.values()].sort(order);
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
