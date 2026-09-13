import { readFile } from 'node:fs/promises';
import { codeUnitOrder } from './instrumented-modules.js';
import { encodeTestCoverage, settledModule, settledTest } from './format.js';
import { openTestCoverage, wholeCoverage } from './format-view.js';
import { layeredDictionary, type LayeredRow } from './format-dictionary.js';
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
  crossedBlock,
  lostCrossings,
  recutRows,
  reusableBlock,
  withoutRetired,
} from './merge-carry.js';
import { readSources, samePreconditions, type CarriedModule } from './merge.js';
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
  const opened = wholeCoverage(previous);
  if (opened === undefined) return encodeTestCoverage(current);
  const { view, columns } = opened;
  if (view.instrumentation !== current.instrumentation) return encodeTestCoverage(current);

  const {
    testPath, testComplete, testPreconditions, preconditionName, preconditionDigest,
    modulePath, moduleSource, moduleInstrumented, moduleBlocks,
    blockOrdinal, blockKind, blockOwner, blockDigest, blockName, blockPath,
    blockStart, blockEnd, blockSource, blockTests, crossingTest,
    blockLoaded, loadedTest,
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

  /** What a previous region's two crossing lists hold, as the fold reads them. */
  interface Carried {
    readonly files: readonly string[];
    readonly loaded: readonly string[];
  }

  /** The tests that entered a previous region before their own file began. */
  const loadedOf = (at: number): readonly string[] => {
    const files: string[] = [];
    for (let early = blockLoaded[at]!; early < blockLoaded[at + 1]!; early += 1) {
      files.push(previousTestRows[loadedTest[early]!]!.file);
    }
    return files;
  };

  /** One previous region as the object model holds it, crossings and all. */
  const blockAt = (at: number): CoverageBlock => {
    const testFiles: string[] = [];
    for (let crossing = blockTests[at]!; crossing < blockTests[at + 1]!; crossing += 1) {
      testFiles.push(previousTestRows[crossingTest[crossing]!]!.file);
    }
    const loadedBy = loadedOf(at);
    return {
      ...(loadedBy.length === 0 ? {} : { loadedBy }),
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
    const surviving = new Map<CoverageBlock, Carried>();
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
          surviving.set(block, { files, loaded: loadedOf(before) });
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
      blocks: module.blocks.map((block) => {
        const held = surviving.get(block);
        const kept = (test: string): boolean => !retired.has(test);
        return crossedBlock(
          block,
          [...(held?.files ?? []).filter(kept), ...block.testFiles],
          [...(held?.loaded ?? []).filter(kept), ...(block.loadedBy ?? [])],
        );
      }),
    };
  });

  const rows: LayeredRow[] = rerecorded.map((module) => ({ file: module.file, module }));
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
    const recut = recutRows(held, now, current.instrumentation);
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

  const { remap, id, blob: stringBlob, offsets: stringOffsets } = layeredDictionary({
    view,
    rows,
    tests,
    instrumentation: current.instrumentation,
    commit: current.commit,
    columns: { modulePath, moduleSource, moduleBlocks, blockName, blockPath, blockDigest },
  });

  let blockCount = 0;
  let crossingCount = 0;
  let loadedCount = 0;
  for (const row of rows) {
    if (row.module !== undefined) {
      blockCount += row.module.blocks.length;
      for (const block of row.module.blocks) {
        crossingCount += block.testFiles.length;
        loadedCount += block.loadedBy?.length ?? 0;
      }
      continue;
    }
    const from = moduleBlocks[row.at!]!;
    const to = moduleBlocks[row.at! + 1]!;
    blockCount += to - from;
    for (let crossing = blockTests[from]!; crossing < blockTests[to]!; crossing += 1) {
      if (retiredTest[crossingTest[crossing]!] === 0) crossingCount += 1;
    }
    for (let early = blockLoaded[from]!; early < blockLoaded[to]!; early += 1) {
      if (retiredTest[loadedTest[early]!] === 0) loadedCount += 1;
    }
  }


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
  const outLoaded = new Uint32Array(blockCount + 1);
  const outEarly = new Uint32Array(loadedCount);

  let block = 0;
  let crossing = 0;
  let early = 0;
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
        outLoaded[block] = early;
        for (const file of held.loadedBy ?? []) {
          const to = testIndex.get(file);
          if (to === undefined) throw new Error(`coverage crossing names an unobserved test: ${file}`);
          outEarly[early] = to;
          early += 1;
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
      outLoaded[block] = early;
      for (let each = blockLoaded[held]!; each < blockLoaded[held + 1]!; each += 1) {
        const test = loadedTest[each]!;
        if (retiredTest[test] === 1) continue;
        outEarly[early] = testRemap[test]!;
        early += 1;
      }
      block += 1;
    }
  }
  outBlocks[rows.length] = block;
  outTests[blockCount] = crossing;
  outLoaded[blockCount] = early;

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
    'blocks.loaded': column(outLoaded),
    'loaded.test': column(outEarly),
  });
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
