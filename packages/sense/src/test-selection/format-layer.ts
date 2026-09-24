import { readFile } from 'node:fs/promises';
import { codeUnitOrder } from './instrumented-modules.js';
import { encodeTestCoverage, settledTest } from './format.js';
import { carriedSources } from './carried-sources.js';
import { wholeCoverage } from './format-view.js';
import { layeredDictionary } from './format-dictionary.js';
import { layeredRows } from './format-layer-rows.js';
import { CrossingSets } from './crossing-sets.js';
import { openCrossingSets } from './crossing-sets-read.js';
import { NO_OWNER, blob, column, kindId, sections } from './format-layout.js';
import { samePreconditions } from './merge.js';
import { NO_LINE } from './written-lines.js';
import type { CoverageTest, TestCoverage } from './index.js';

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
    blockStart, blockEnd, blockSource, blockSet, blockLoadedSet, crossings,
  } = columns;
  const previousSets = openCrossingSets(crossings);

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


  const { order, objects, stale } = layeredRows({
    view,
    columns,
    previousSets,
    previousTestRows,
    currentTests,
    retired,
    current,
    onDisk,
  });

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
    rows: order,
    objects,
    tests,
    instrumentation: current.instrumentation,
    commit: current.commit,
    columns: { modulePath, moduleSource, moduleBlocks, blockName, blockPath, blockDigest },
  });

  let blockCount = 0;
  for (const row of order) {
    if (row < 0) {
      blockCount += objects[~row]!.blocks.length;
      continue;
    }
    blockCount += moduleBlocks[row + 1]! - moduleBlocks[row]!;
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

  const outPath = new Uint32Array(order.length);
  const outSource = new Uint32Array(order.length);
  const outInstrumented = new Uint8Array(order.length);
  const outBlocks = new Uint32Array(order.length + 1);
  const outOrdinal = new Uint32Array(blockCount);
  const outKind = new Uint8Array(blockCount);
  const outOwner = new Uint32Array(blockCount);
  const outBlockDigest = new Uint32Array(blockCount);
  const outBlockName = new Uint32Array(blockCount);
  const outBlockPath = new Uint32Array(blockCount);
  const outStart = new Uint32Array(blockCount);
  const outEnd = new Uint32Array(blockCount);
  const outBlockSource = new Uint8Array(blockCount);
  const outSet = new Uint32Array(blockCount);
  const outLoadedSet = new Uint32Array(blockCount);

  // The new pool, filled in the order the regions are written — which is the
  // order an encode of the merged model would have filled it in, and is what
  // makes the two agree byte for byte rather than merely set for set.
  const outSets = new CrossingSets(tests.length);
  // A carried set is remapped once however many regions name it. The pool holds
  // thousands where the snapshot holds millions of regions, so this is the whole
  // of what the crossings cost a layer.
  const setRemap = new Int32Array(previousSets.size).fill(-1);
  let members = new Uint32Array(64);
  const widen = (need: number): void => {
    if (need > members.length) members = new Uint32Array(1 << (32 - Math.clz32(need - 1)));
  };
  const carriedSet = (from: number): number => {
    const already = setRemap[from]!;
    if (already >= 0) return already;
    const held = previousSets.members(from);
    widen(held.length);
    let count = 0;
    for (const test of held) if (retiredTest[test] === 0) members[count++] = testRemap[test]!;
    const id = outSets.intern(members.subarray(0, count));
    setRemap[from] = id;
    return id;
  };

  let block = 0;
  for (const [at, row] of order.entries()) {
    outBlocks[at] = block;
    if (row < 0) {
      const module = objects[~row]!;
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
        outStart[block] = held.startLine ?? NO_LINE;
        outEnd[block] = held.endLine ?? NO_LINE;
        outBlockSource[block] = held.source ? 1 : 0;
        widen(held.testFiles.length);
        for (const [order, file] of held.testFiles.entries()) {
          const to = testIndex.get(file);
          if (to === undefined) throw new Error(`coverage crossing names an unobserved test: ${file}`);
          members[order] = to;
        }
        outSet[block] = outSets.intern(members.subarray(0, held.testFiles.length));
        const loadedBy = held.loadedBy ?? [];
        widen(loadedBy.length);
        for (const [order, file] of loadedBy.entries()) {
          const to = testIndex.get(file);
          if (to === undefined) throw new Error(`coverage crossing names an unobserved test: ${file}`);
          members[order] = to;
        }
        outLoadedSet[block] = outSets.intern(members.subarray(0, loadedBy.length));
        block += 1;
      }
      continue;
    }
    const from = row;
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
      outSet[block] = carriedSet(blockSet[held]!);
      // The same remap the crossings go through, and the same cache: a region
      // whose loaders are its crossers names one id, and that id is remapped
      // once for both of them.
      outLoadedSet[block] = carriedSet(blockLoadedSet[held]!);
      block += 1;
    }
  }
  outBlocks[order.length] = block;
  const pool = outSets.pool();

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
    'blocks.set': column(outSet),
    'blocks.loadedSet': column(outLoadedSet),
    'sets.blob': blob(pool.bytes, pool.offsets),
    'sets.off': column(pool.offsets),
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
