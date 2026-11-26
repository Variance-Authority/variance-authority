import type {
  FilePhases,
  CoverageBlock,
  CoverageModule,
  CoveragePrecondition,
  CoverageTest,
  TestCoverage,
} from './index.js';
import {
  BLOCK_KINDS,
  MODEL,
  NO_BLOB,
  NO_DURATION,
  NO_OWNER,
  PHASE_NAMES,
  durationWord,
  kindId,
  laneWord,
  startWords,
} from './format-layout.js';
import { native, nativeRefusal } from '../addon.js';
import type { NativeCoverageRows } from '../native-record.js';
import type { NativeRunCrossed } from '../native-run-crossings.js';
import { openTestCoverage } from './format-view.js';
import { stringTable } from './native-modules.js';
import { NO_LINE, writtenLines } from './written-lines.js';

/**
 * The logical model, written to a snapshot and read back out of one.
 *
 * A query never comes through here: it opens the file and reads the columns it
 * needs. The objects are for the callers that want all of it — a merge folding
 * two records together, a caller handed a snapshot it did not record.
 */

/**
 * One versioned snapshot: interned strings, dense block columns, and a pool of
 * interned test sets a region names one of. No path, block object or crossing
 * set is repeated in the file.
 *
 * The addon writes it: the order, the dictionary and the sets are its, as they
 * are for every other record it writes. This turns the objects into its columns.
 */
export function encodeTestCoverage(coverage: RunCoverage): Buffer {
  if (coverage.version !== MODEL) {
    throw new Error(`unsupported test coverage version: ${coverage.version}`);
  }
  const encode = native()?.encodeCoverage;
  if (encode === undefined) {
    throw new Error(`writing a coverage record requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `encodeCoverage`'}`);
  }
  return encode(coverageRows(coverage));
}

/**
 * Coverage as a run holds it before it is written: a region's crossers either
 * named in its `testFiles` and `loadedBy`, or, with `crossed`, left in the
 * columns the run's fold answered, which the addon reads in their place — every
 * region's `testFiles` is then empty and none has `loadedBy`.
 */
export type RunCoverage = TestCoverage & { readonly crossed?: NativeRunCrossed };

/** `coverage` as the columns the addon reads it from. */
export function coverageRows(coverage: RunCoverage): NativeCoverageRows {
  const { tests, modules, crossed } = coverage;
  const testPreconditions = new Uint32Array(tests.length + 1);
  const preconditionName: string[] = [];
  const preconditionDigest: string[] = [];
  for (const [index, test] of tests.entries()) {
    testPreconditions[index] = preconditionName.length;
    for (const precondition of test.preconditions) {
      preconditionName.push(precondition.name);
      preconditionDigest.push(precondition.digest);
    }
  }
  testPreconditions[tests.length] = preconditionName.length;

  const blockCount = modules.reduce((total, module) => total + module.blocks.length, 0);
  const moduleBlocks = new Uint32Array(modules.length + 1);
  const blockOrdinal = new Uint32Array(blockCount);
  const blockKind = new Uint8Array(blockCount);
  const blockOwner = new Uint32Array(blockCount);
  // A region's strings are handed over once each: a path is named by every region of its module.
  const blockDigest = new Uint32Array(blockCount);
  const blockName = new Uint32Array(blockCount);
  const blockPath = new Uint32Array(blockCount);
  const { strings: blockStrings, at: blockString } = stringTable();
  const blockStart = new Uint32Array(blockCount);
  const blockEnd = new Uint32Array(blockCount);
  const blockSource = new Uint8Array(blockCount);
  // A crosser is named once, and a region names it by its index.
  const { strings: members, at: member } = stringTable();
  const calledOffsets = new Uint32Array(blockCount + 1);
  const called: number[] = [];
  const loadedOffsets = new Uint32Array(blockCount + 1);
  const loaded: number[] = [];
  let blockIndex = 0;
  for (const [moduleIndex, module] of modules.entries()) {
    moduleBlocks[moduleIndex] = blockIndex;
    for (const block of module.blocks) {
      blockOrdinal[blockIndex] = block.ordinal;
      blockKind[blockIndex] = kindId(block.kind);
      blockOwner[blockIndex] = block.owner ?? NO_OWNER;
      blockDigest[blockIndex] = blockString(block.digest);
      blockName[blockIndex] = blockString(block.name);
      blockPath[blockIndex] = blockString(block.path);
      blockStart[blockIndex] = block.startLine ?? NO_LINE;
      blockEnd[blockIndex] = block.endLine ?? NO_LINE;
      blockSource[blockIndex] = block.source ? 1 : 0;
      calledOffsets[blockIndex] = called.length;
      loadedOffsets[blockIndex] = loaded.length;
      if (crossed === undefined) {
        for (const testFile of block.testFiles) called.push(member(testFile));
        for (const testFile of block.loadedBy ?? []) loaded.push(member(testFile));
      }
      blockIndex += 1;
    }
  }
  moduleBlocks[modules.length] = blockIndex;
  calledOffsets[blockCount] = called.length;
  loadedOffsets[blockCount] = loaded.length;

  return {
    instrumentation: coverage.instrumentation,
    ...(coverage.commit === undefined ? {} : { commit: coverage.commit }),
    testPath: tests.map((test) => test.file),
    testComplete: Uint8Array.from(tests, (test) => test.complete ? 1 : 0),
    testDuration: Uint32Array.from(tests, (test) => durationWord(test.duration)),
    testPhases: phaseWords(tests.map((test) => test.phases)),
    testStart: Uint32Array.from(tests.flatMap((test) => startWords(test.start))),
    testLane: Uint32Array.from(tests, (test) => laneWord(test.lane)),
    testPreconditions,
    preconditionName,
    preconditionDigest,
    modulePath: modules.map((module) => module.file),
    moduleSource: modules.map((module) => module.sourceDigest),
    moduleBlob: modules.map((module) => module.sourceBlob ?? null),
    moduleInstrumented: Uint8Array.from(modules, (module) => module.instrumented ? 1 : 0),
    moduleBlocks,
    blockOrdinal,
    blockKind,
    blockOwner,
    blockDigest,
    blockName,
    blockPath,
    blockStrings,
    blockStart,
    blockEnd,
    blockSource,
    members,
    calledOffsets,
    called: Uint32Array.from(called),
    loadedOffsets,
    loaded: Uint32Array.from(loaded),
    ...(crossed === undefined ? {} : { crossed }),
  };
}

/** `tests.phases` for these tests: {@link PHASE_NAMES} words each, a phase nobody reported as {@link NO_DURATION}. */
export function phaseWords(phases: readonly (FilePhases | undefined)[]): Uint32Array {
  const words = new Uint32Array(phases.length * PHASE_NAMES.length);
  for (const [test, held] of phases.entries()) {
    for (const [at, name] of PHASE_NAMES.entries()) words[test * PHASE_NAMES.length + at] = durationWord(held?.[name]);
  }
  return words;
}

/** The phases test `test` holds in a `tests.phases` column, as a field to spread: absent where none was reported. */
export function phasesAt(words: Uint32Array | undefined, test: number): { readonly phases?: FilePhases } {
  if (words === undefined) return {};
  const phases: Partial<Record<keyof FilePhases, number>> = {};
  let reported = false;
  for (const [at, name] of PHASE_NAMES.entries()) {
    const word = words[test * PHASE_NAMES.length + at] ?? NO_DURATION;
    if (word === NO_DURATION) continue;
    phases[name] = word;
    reported = true;
  }
  return reported ? { phases } : {};
}

/** The start test `test` holds in a `tests.start` column, as a field to spread: absent where none was given. */
export function startAt(words: Uint32Array | undefined, test: number): { readonly start?: number } {
  if (words === undefined) return {};
  const low = words[test * 2] ?? NO_DURATION;
  const high = words[test * 2 + 1] ?? NO_DURATION;
  return high === NO_DURATION ? {} : { start: high * 2 ** 32 + low };
}

/** The lane test `test` holds in a `tests.lane` column, as a field to spread: absent where none was given. */
export function laneAt(words: Uint32Array | undefined, test: number): { readonly lane?: number } {
  const lane = words?.[test] ?? NO_DURATION;
  return lane === NO_DURATION ? {} : { lane };
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
  const testDuration = view.testDuration?.all();
  const testPhases = view.testPhases?.all();
  const testStart = view.testStart?.all();
  const testLane = view.testLane?.all();
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
    const duration = testDuration?.[test] ?? NO_DURATION;
    tests.push({
      file: string(testPath[test]!),
      complete: testComplete[test] === 1,
      preconditions,
      ...(duration === NO_DURATION ? {} : { duration }),
      ...phasesAt(testPhases, test),
      ...startAt(testStart, test),
      ...laneAt(testLane, test),
    });
  }
  const modulePath = view.modulePath.all();
  const moduleSource = view.moduleSource.all();
  const moduleBlob = view.moduleBlob?.all();
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
  const blockSet = view.blockSet.all();
  const crossings = view.crossings;
  const blockLoadedSet = view.blockLoadedSet.all();
  const modules: CoverageModule[] = [];
  for (let module = 0; module < modulePath.length; module += 1) {
    const blocks: CoverageBlock[] = [];
    for (let block = moduleBlocks[module]!; block < moduleBlocks[module + 1]!; block += 1) {
      // Ascending test id, which is the order the tests were sorted into, which
      // is the order the crossings were in before they became a set.
      const testFiles: string[] = [];
      for (const test of crossings.members(blockSet[block]!)) {
        testFiles.push(string(testPath[test]!));
      }
      const loadedBy: string[] = [];
      for (const test of crossings.members(blockLoadedSet[block]!)) {
        loadedBy.push(string(testPath[test]!));
      }
      blocks.push({
        ordinal: blockOrdinal[block]!,
        kind: BLOCK_KINDS[blockKind[block]!]!,
        ...(blockOwner[block] === NO_OWNER ? {} : { owner: blockOwner[block]! }),
        digest: string(blockDigest[block]!),
        name: string(blockName[block]!),
        path: string(blockPath[block]!),
        ...writtenLines(blockStart[block]!, blockEnd[block]!),
        source: blockSource[block] === 1,
        testFiles,
        ...(loadedBy.length === 0 ? {} : { loadedBy }),
      });
    }
    modules.push({
      file: string(modulePath[module]!),
      sourceDigest: string(moduleSource[module]!),
      ...(moduleBlob === undefined || moduleBlob[module] === NO_BLOB ? {} : { sourceBlob: string(moduleBlob[module]!) }),
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
