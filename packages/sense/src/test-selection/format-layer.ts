import { readFile } from 'node:fs/promises';
import { codeUnitOrder } from './instrumented-modules.js';
import { encodeTestCoverage, settledModule, settledTest } from './format.js';
import { openTestCoverage, type TestCoverageView } from './format-view.js';
import {
  KINDS,
  NO_OWNER,
  blob,
  column,
  kindId,
  sections,
} from './format-layout.js';
import {
  addressOf,
  lostCrossings,
  readSources,
  recutRows,
  reusableBlock,
  samePreconditions,
  withoutRetired,
  type CarriedModule,
} from './merge.js';
import type { CoverageBlock, CoverageModule, CoverageTest, TestCoverage } from './index.js';

/**
 * The merge and the encode as one pass, over the columns the previous snapshot
 * is already stored in.
 *
 * `encodeTestCoverage(mergeCoverage(decodeTestCoverage(bytes), current))` is the
 * read-modify-write every run after the first ends with, and at a repository's
 * scale almost all of it is spent making objects nobody reads. A run that
 * re-records ten modules of two hundred thousand decodes six hundred thousand
 * regions into a model, merges ten of them, and encodes the model back — the
 * other 99.995% of the index is materialized and re-serialized to arrive at the
 * bytes it was read from.
 *
 * So a module the run did not touch is never made an object here. Its rows are
 * copied column to column as integers, its strings are copied blob to blob as
 * bytes, and the only thing that happens to either is the renumbering the new
 * dictionary implies. Objects are made for exactly what the merge has to reason
 * about: the tests, the modules `current` re-recorded, and the carried modules
 * whose text moved on disk.
 *
 * The output is **byte-identical** to the composition it replaces, which is what
 * the gate test in `format-layer.test.ts` asserts across every case the merge
 * distinguishes. That is the contract: this is an optimization of a function
 * that already exists, and the day the two disagree this one is wrong.
 */
export function layerTestCoverage(
  previous: Uint8Array | undefined,
  current: TestCoverage,
  onDisk: ReadonlyMap<string, string> = new Map(),
): Buffer {
  if (previous === undefined) return encodeTestCoverage(current);
  // Undecodable counts as nothing to merge with, which is the bargain
  // `existingCoverage` already makes on this path: the alternative is a
  // truncated write stopping every later run from recording anything.
  const opened = readable(previous);
  if (opened === undefined) return encodeTestCoverage(current);
  const { view, columns } = opened;
  if (view.instrumentation !== current.instrumentation) return encodeTestCoverage(current);

  const {
    testPath, testComplete, testPreconditions, preconditionName, preconditionDigest,
    modulePath, moduleSource, moduleInstrumented, moduleBlocks,
    blockOrdinal, blockKind, blockOwner, blockDigest, blockName, blockPath,
    blockStart, blockEnd, blockSource, blockTests, crossingTest,
  } = columns;

  // The tests, as objects. A snapshot holds thousands of them against millions
  // of regions, and every rule the merge applies is about a test.
  const previousCount = testPath.length;
  const previousTestRows: CoverageTest[] = [];
  for (let test = 0; test < previousCount; test += 1) {
    const preconditions = [];
    for (let at = testPreconditions[test]!; at < testPreconditions[test + 1]!; at += 1) {
      preconditions.push({
        name: view.string(preconditionName[at]!),
        digest: view.string(preconditionDigest[at]!),
      });
    }
    previousTestRows.push({
      file: view.string(testPath[test]!),
      complete: testComplete[test] === 1,
      preconditions,
    });
  }
  const previousTests = new Map(previousTestRows.map((test) => [test.file, test]));
  const currentTests = new Map(current.tests.map((test) => [test.file, test]));
  const retired = new Set(current.tests.flatMap((test) => {
    const before = previousTests.get(test.file);
    return test.complete || (before !== undefined && !samePreconditions(before, test))
      ? [test.file]
      : [];
  }));

  // The modules, as paths. One string per module rather than one per region,
  // name and structural path both — the difference between twenty thousand
  // strings and six hundred thousand.
  const moduleCount = modulePath.length;
  const previousFile: string[] = [];
  for (let module = 0; module < moduleCount; module += 1) {
    previousFile.push(view.string(modulePath[module]!));
  }
  const firstPrevious = new Map<string, number>();
  for (let module = 0; module < moduleCount; module += 1) {
    if (!firstPrevious.has(previousFile[module]!)) firstPrevious.set(previousFile[module]!, module);
  }
  const currentFiles = new Set(current.modules.map((module) => module.file));

  /** One previous region as the object model holds it, crossings and all. */
  const blockAt = (at: number): CoverageBlock => {
    const testFiles: string[] = [];
    for (let crossing = blockTests[at]!; crossing < blockTests[at + 1]!; crossing += 1) {
      testFiles.push(previousTestRows[crossingTest[crossing]!]!.file);
    }
    return {
      ordinal: blockOrdinal[at]!,
      kind: KINDS[blockKind[at]!]!,
      ...(blockOwner[at] === NO_OWNER ? {} : { owner: blockOwner[at]! }),
      digest: view.string(blockDigest[at]!),
      name: view.string(blockName[at]!),
      path: view.string(blockPath[at]!),
      startLine: blockStart[at]!,
      endLine: blockEnd[at]!,
      source: blockSource[at] === 1,
      testFiles,
    };
  };
  const moduleAt = (at: number): CoverageModule => {
    const blocks: CoverageBlock[] = [];
    for (let block = moduleBlocks[at]!; block < moduleBlocks[at + 1]!; block += 1) {
      blocks.push(blockAt(block));
    }
    return {
      file: previousFile[at]!,
      sourceDigest: view.string(moduleSource[at]!),
      instrumented: moduleInstrumented[at] === 1,
      blocks,
    };
  };

  // The modules this run re-recorded: the crossings the previous rows still
  // carry, folded onto the rows that came in.
  const stale = new Set<string>();
  const rerecorded = current.modules.map((module): CoverageModule => {
    const at = firstPrevious.get(module.file);
    const byAddress = new Map<string, CoverageBlock>();
    for (const block of module.blocks) {
      const key = addressOf(block);
      if (!byAddress.has(key)) byAddress.set(key, block);
    }
    const surviving = new Map<CoverageBlock, readonly string[]>();
    if (at !== undefined) {
      const instrumented = moduleInstrumented[at] === 1;
      for (let before = moduleBlocks[at]!; before < moduleBlocks[at + 1]!; before += 1) {
        const key = `${view.string(blockName[before]!)}\0${view.string(blockPath[before]!)}`;
        const block = byAddress.get(key);
        if (
          block !== undefined && module.instrumented && instrumented &&
          reusableBlock(block, { kind: KINDS[blockKind[before]!]! })
        ) {
          const files: string[] = [];
          for (let crossing = blockTests[before]!; crossing < blockTests[before + 1]!; crossing += 1) {
            files.push(previousTestRows[crossingTest[crossing]!]!.file);
          }
          surviving.set(block, files);
          continue;
        }
        for (let crossing = blockTests[before]!; crossing < blockTests[before + 1]!; crossing += 1) {
          const file = previousTestRows[crossingTest[crossing]!]!.file;
          if (!currentTests.has(file)) stale.add(file);
        }
      }
    }
    return {
      file: module.file,
      sourceDigest: module.sourceDigest,
      instrumented: module.instrumented,
      blocks: module.blocks.map((block) => ({
        ...block,
        testFiles: [...new Set([
          ...(surviving.get(block) ?? []).filter((test) => !retired.has(test)),
          ...block.testFiles,
        ])].sort(codeUnitOrder),
      })),
    };
  });

  /**
   * The output's module order: an object for what the run touched or what moved
   * on disk, and a row number for everything else.
   *
   * A row number is the whole of what a carried module costs here. What follows
   * reads it, and only it, until the columns are written.
   */
  interface Row {
    readonly file: string;
    readonly module?: CoverageModule;
    readonly at?: number;
  }
  const rows: Row[] = rerecorded.map((module) => ({ file: module.file, module }));
  for (let module = 0; module < moduleCount; module += 1) {
    const file = previousFile[module]!;
    if (currentFiles.has(file)) continue;
    // Text that moved is the one reason a carried module becomes an object: its
    // rows are lines of text nobody has any more, and they are cut again.
    const now = onDisk.get(file);
    if (now === undefined) {
      rows.push({ file, at: module });
      continue;
    }
    const held = moduleAt(module);
    const recut = recutRows(held, now);
    const lost = recut === 'mislaid'
      ? [...new Set(held.blocks.flatMap((block) => block.testFiles))]
      : recut === undefined ? [] : lostCrossings(held, recut);
    for (const test of lost) if (!currentTests.has(test)) stale.add(test);
    if (recut === undefined || recut === 'mislaid') rows.push({ file, at: module });
    else rows.push({ file, module: settledModule(withoutRetired(recut, retired)) });
  }
  rows.sort((left, right) => codeUnitOrder(left.file, right.file));

  const tests = [
    ...previousTestRows
      .filter((test) => !currentTests.has(test.file))
      .map((test) => (stale.has(test.file) ? { ...test, complete: false } : test)),
    ...current.tests,
  ].sort((left, right) => codeUnitOrder(left.file, right.file)).map(settledTest);
  const testIndex = new Map(tests.map((test, at) => [test.file, at]));
  const testRemap = new Uint32Array(previousCount);
  const retiredTest = new Uint8Array(previousCount);
  for (let test = 0; test < previousCount; test += 1) {
    testRemap[test] = testIndex.get(previousTestRows[test]!.file)!;
    retiredTest[test] = retired.has(previousTestRows[test]!.file) ? 1 : 0;
  }

  // Which previous strings the output still names. No string is made to answer
  // that: marking is a pass over the id columns, and an id is an integer.
  const stored = view.dictionary();
  const previousOffsets = stored.offsets;
  const previousBlob = Buffer.isBuffer(stored.blob)
    ? stored.blob
    : Buffer.from(stored.blob.buffer, stored.blob.byteOffset, stored.blob.byteLength);
  const strings = previousOffsets.length - 1;
  const marked = new Uint8Array(strings);
  for (const row of rows) {
    if (row.at === undefined) continue;
    marked[modulePath[row.at]!] = 1;
    marked[moduleSource[row.at]!] = 1;
    for (let block = moduleBlocks[row.at]!; block < moduleBlocks[row.at + 1]!; block += 1) {
      marked[blockName[block]!] = 1;
      marked[blockPath[block]!] = 1;
      marked[blockDigest[block]!] = 1;
    }
  }
  const survivors: number[] = [];
  for (let id = 0; id < strings; id += 1) if (marked[id] === 1) survivors.push(id);

  // Everything the object-backed side names. Small, because the object-backed
  // side is what this run actually looked at.
  const freshValues = new Set<string>();
  freshValues.add(current.instrumentation);
  if (current.commit !== undefined) freshValues.add(current.commit);
  for (const test of tests) {
    freshValues.add(test.file);
    for (const precondition of test.preconditions) {
      freshValues.add(precondition.name);
      freshValues.add(precondition.digest);
    }
  }
  for (const row of rows) {
    if (row.module === undefined) continue;
    freshValues.add(row.module.file);
    freshValues.add(row.module.sourceDigest);
    for (const block of row.module.blocks) {
      freshValues.add(block.name);
      freshValues.add(block.path);
      freshValues.add(block.digest);
    }
  }
  const fresh = [...freshValues].sort(codeUnitOrder);
  const freshBytes = fresh.map((value) => Buffer.from(value, 'utf8'));

  /**
   * UTF-8 byte order is code point order, and code point order is UTF-16 code
   * unit order for everything below U+E000. Above it the two disagree, because a
   * surrogate pair sorts under U+E000 by code unit and over it by code point.
   * Nothing a snapshot holds — a repository path, a declaration name, a hex
   * digest — reaches that far, but "nothing does" is not a proof, so it is
   * checked, and the comparison falls back to the strings themselves when the
   * check fails.
   */
  const ascends = below(previousBlob) && freshBytes.every(below);
  const decoder = new TextDecoder();
  const order = ascends
    ? (id: number, bytes: Buffer): number =>
      previousBlob.compare(bytes, 0, bytes.length, previousOffsets[id]!, previousOffsets[id + 1]!)
    : (id: number, bytes: Buffer): number =>
      codeUnitOrder(view.string(id), decoder.decode(bytes));

  /**
   * The new dictionary, as a merge of two ordered runs.
   *
   * The survivors in id order are already in dictionary order — the dictionary
   * they came out of was sorted, and a subsequence of a sorted list is sorted —
   * so the run that dominates the result is compared and copied as bytes, and
   * never becomes a string at all.
   */
  const dictionary: (number | Buffer)[] = [];
  const remap = new Uint32Array(strings);
  const freshIds = new Map<string, number>();
  let survivor = 0;
  let entrant = 0;
  let blobLength = 0;
  while (survivor < survivors.length || entrant < fresh.length) {
    const side = survivor >= survivors.length ? 1
      : entrant >= fresh.length ? -1
      : order(survivors[survivor]!, freshBytes[entrant]!);
    if (side <= 0) {
      const id = survivors[survivor]!;
      remap[id] = dictionary.length;
      if (side === 0) {
        freshIds.set(fresh[entrant]!, dictionary.length);
        entrant += 1;
      }
      blobLength += previousOffsets[id + 1]! - previousOffsets[id]!;
      dictionary.push(id);
      survivor += 1;
    } else {
      freshIds.set(fresh[entrant]!, dictionary.length);
      blobLength += freshBytes[entrant]!.length;
      dictionary.push(freshBytes[entrant]!);
      entrant += 1;
    }
  }
  // Every string an object-backed row or a test names went into `fresh`, so the
  // small map answers every lookup and a map over the whole dictionary is never
  // built.
  const id = (value: string): number => freshIds.get(value)!;

  let blockCount = 0;
  let crossingCount = 0;
  for (const row of rows) {
    if (row.module !== undefined) {
      blockCount += row.module.blocks.length;
      for (const block of row.module.blocks) crossingCount += block.testFiles.length;
      continue;
    }
    const from = moduleBlocks[row.at!]!;
    const to = moduleBlocks[row.at! + 1]!;
    blockCount += to - from;
    for (let crossing = blockTests[from]!; crossing < blockTests[to]!; crossing += 1) {
      if (retiredTest[crossingTest[crossing]!] === 0) crossingCount += 1;
    }
  }

  const stringBlob = Buffer.allocUnsafe(blobLength);
  const stringOffsets = new Uint32Array(dictionary.length + 1);
  let offset = 0;
  for (const [at, value] of dictionary.entries()) {
    stringOffsets[at] = offset;
    if (typeof value === 'number') {
      offset += previousBlob.copy(stringBlob, offset, previousOffsets[value]!, previousOffsets[value + 1]!);
      continue;
    }
    stringBlob.set(value, offset);
    offset += value.length;
  }
  stringOffsets[dictionary.length] = offset;

  const preconditionCount = tests.reduce((sum, test) => sum + test.preconditions.length, 0);
  const testPaths = Uint32Array.from(tests, (test) => id(test.file));
  const outComplete = Uint8Array.from(tests, (test) => (test.complete ? 1 : 0));
  const outPreconditions = new Uint32Array(tests.length + 1);
  const outName = new Uint32Array(preconditionCount);
  const outDigest = new Uint32Array(preconditionCount);
  let precondition = 0;
  for (const [at, test] of tests.entries()) {
    outPreconditions[at] = precondition;
    for (const input of test.preconditions) {
      outName[precondition] = id(input.name);
      outDigest[precondition] = id(input.digest);
      precondition += 1;
    }
  }
  outPreconditions[tests.length] = precondition;

  const outPath = new Uint32Array(rows.length);
  const outSource = new Uint32Array(rows.length);
  const outInstrumented = new Uint8Array(rows.length);
  const outBlocks = new Uint32Array(rows.length + 1);
  const outOrdinal = new Uint32Array(blockCount);
  const outKind = new Uint8Array(blockCount);
  const outOwner = new Uint32Array(blockCount);
  const outBlockDigest = new Uint32Array(blockCount);
  const outBlockName = new Uint32Array(blockCount);
  const outBlockPath = new Uint32Array(blockCount);
  const outStart = new Uint32Array(blockCount);
  const outEnd = new Uint32Array(blockCount);
  const outBlockSource = new Uint8Array(blockCount);
  const outTests = new Uint32Array(blockCount + 1);
  const outCrossing = new Uint32Array(crossingCount);

  let block = 0;
  let crossing = 0;
  for (const [at, row] of rows.entries()) {
    outBlocks[at] = block;
    if (row.module !== undefined) {
      const module = row.module;
      outPath[at] = id(module.file);
      outSource[at] = id(module.sourceDigest);
      outInstrumented[at] = module.instrumented ? 1 : 0;
      for (const held of module.blocks) {
        outOrdinal[block] = held.ordinal;
        outKind[block] = kindId(held.kind);
        outOwner[block] = held.owner ?? NO_OWNER;
        outBlockDigest[block] = id(held.digest);
        outBlockName[block] = id(held.name);
        outBlockPath[block] = id(held.path);
        outStart[block] = held.startLine;
        outEnd[block] = held.endLine;
        outBlockSource[block] = held.source ? 1 : 0;
        outTests[block] = crossing;
        for (const file of held.testFiles) {
          const to = testIndex.get(file);
          if (to === undefined) throw new Error(`coverage crossing names an unobserved test: ${file}`);
          outCrossing[crossing] = to;
          crossing += 1;
        }
        block += 1;
      }
      continue;
    }
    const from = row.at!;
    outPath[at] = remap[modulePath[from]!]!;
    outSource[at] = remap[moduleSource[from]!]!;
    outInstrumented[at] = moduleInstrumented[from]!;
    for (let held = moduleBlocks[from]!; held < moduleBlocks[from + 1]!; held += 1) {
      outOrdinal[block] = blockOrdinal[held]!;
      outKind[block] = blockKind[held]!;
      outOwner[block] = blockOwner[held]!;
      outBlockDigest[block] = remap[blockDigest[held]!]!;
      outBlockName[block] = remap[blockName[held]!]!;
      outBlockPath[block] = remap[blockPath[held]!]!;
      outStart[block] = blockStart[held]!;
      outEnd[block] = blockEnd[held]!;
      outBlockSource[block] = blockSource[held]!;
      outTests[block] = crossing;
      for (let each = blockTests[held]!; each < blockTests[held + 1]!; each += 1) {
        const test = crossingTest[each]!;
        if (retiredTest[test] === 1) continue;
        outCrossing[crossing] = testRemap[test]!;
        crossing += 1;
      }
      block += 1;
    }
  }
  outBlocks[rows.length] = block;
  outTests[blockCount] = crossing;

  return sections({
    'strings.blob': blob(stringBlob, stringOffsets),
    'strings.off': column(stringOffsets),
    'snapshot.instrumentation': column(Uint32Array.of(id(current.instrumentation))),
    'snapshot.commit': column(
      current.commit === undefined ? new Uint32Array(0) : Uint32Array.of(id(current.commit)),
    ),
    'tests.path': column(testPaths),
    'tests.complete': column(outComplete),
    'tests.preconditions': column(outPreconditions),
    'preconditions.name': column(outName),
    'preconditions.digest': column(outDigest),
    'modules.path': column(outPath),
    'modules.source': column(outSource),
    'modules.instrumented': column(outInstrumented),
    'modules.blocks': column(outBlocks),
    'blocks.ordinal': column(outOrdinal),
    'blocks.kind': column(outKind),
    'blocks.owner': column(outOwner),
    'blocks.digest': column(outBlockDigest),
    'blocks.name': column(outBlockName),
    'blocks.path': column(outBlockPath),
    'blocks.start': column(outStart),
    'blocks.end': column(outEnd),
    'blocks.source': column(outBlockSource),
    'blocks.tests': column(outTests),
    'crossings.test': column(outCrossing),
  });
}

/** Whether these bytes hold no code point at or above U+E000. */
function below(bytes: Uint8Array): boolean {
  for (let at = 0; at < bytes.length; at += 1) if (bytes[at]! >= 0xee) return false;
  return true;
}

/**
 * The snapshot, or nothing when it is not one this build can read.
 *
 * Opening parses the index and proves nothing else, so every column is
 * materialized here — where a refusal still means "there was no index to merge
 * with" — rather than in the middle of a write that has already begun.
 */
function readable(bytes: Uint8Array):
  { view: TestCoverageView; columns: ReturnType<typeof held> } | undefined {
  try {
    const view = openTestCoverage(bytes);
    void view.instrumentation;
    return { view, columns: held(view) };
  } catch {
    return undefined;
  }
}

/** Every column of a snapshot, decompressed once and read as arrays from here on. */
function held(view: TestCoverageView) {
  return {
    testPath: view.testPath.all(),
    testComplete: view.testComplete.all(),
    testPreconditions: view.testPreconditions.all(),
    preconditionName: view.preconditionName.all(),
    preconditionDigest: view.preconditionDigest.all(),
    modulePath: view.modulePath.all(),
    moduleSource: view.moduleSource.all(),
    moduleInstrumented: view.moduleInstrumented.all(),
    moduleBlocks: view.moduleBlocks.all(),
    blockOrdinal: view.blockOrdinal.all(),
    blockKind: view.blockKind.all(),
    blockOwner: view.blockOwner.all(),
    blockDigest: view.blockDigest.all(),
    blockName: view.blockName.all(),
    blockPath: view.blockPath.all(),
    blockStart: view.blockStart.all(),
    blockEnd: view.blockEnd.all(),
    blockSource: view.blockSource.all(),
    blockTests: view.blockTests.all(),
    crossingTest: view.crossingTest.all(),
  };
}

/**
 * The read-modify-write a run ends with: the index on disk, this run laid over
 * it, and the bytes to put back.
 *
 * One function because the two halves share a file. Reading the snapshot to
 * decide which carried modules need their text re-read, and then reading it
 * again to merge, is the decode this is here to remove — so the carried module
 * list is taken off the same three columns the layer will use, and the model is
 * never built.
 *
 * A file that is not there, or is not one this build can read, is nothing to
 * merge with. That is {@link existingCoverage}'s bargain and the reasoning is
 * its own: refusing would let a truncated write stop every later run from
 * recording anything, and this is a runner's teardown, where the sentence is
 * easiest to miss.
 */
export async function layeredCoverage(
  file: string,
  current: TestCoverage,
  root: string,
): Promise<Buffer> {
  let previous: Buffer;
  try {
    previous = await readFile(file);
  } catch {
    return encodeTestCoverage(current);
  }
  return layerTestCoverage(previous, current, await carriedSources(root, previous, current));
}

/**
 * The text the carried rows will be re-cut from, named off the columns.
 *
 * Three columns of one row per module, against the twenty-odd a merge would
 * have had to decode to answer the same question. The snapshot is opened twice
 * over a whole write — here and in the layer — and the second open decompresses
 * these three again, which is a few milliseconds of an index whose block
 * columns are thirty times larger and are read exactly once.
 */
async function carriedSources(
  root: string,
  previous: Uint8Array,
  current: TestCoverage,
): Promise<ReadonlyMap<string, string>> {
  let carried: CarriedModule[];
  try {
    const view = openTestCoverage(previous);
    if (view.instrumentation !== current.instrumentation) return new Map();
    const path = view.modulePath.all();
    const source = view.moduleSource.all();
    const instrumented = view.moduleInstrumented.all();
    const recorded = new Set(current.modules.map((module) => module.file));
    carried = [];
    for (let module = 0; module < path.length; module += 1) {
      // A module recorded as unread is not re-cut at all: that row says this
      // build never measured the module, and cutting regions out of its text
      // would answer an unknown with a table of regions no run ever entered.
      if (instrumented[module] !== 1) continue;
      const held = view.string(path[module]!);
      if (recorded.has(held)) continue;
      carried.push({ file: held, sourceDigest: view.string(source[module]!) });
    }
  } catch {
    return new Map();
  }
  return readSources(root, carried);
}
