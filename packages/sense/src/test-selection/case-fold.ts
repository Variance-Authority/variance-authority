import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FreshCases, LaidRun } from './case-landing.js';
import type { ModuleId } from '../instrument/index.js';
import { CrossingSets } from './crossing-sets.js';
import { scanJournal, type JournalVisitor } from './crossing-fold.js';
import { encodeSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';
import {
  codeUnitOrder,
  isMissing,
  projectPath,
  type CapturedModule,
} from './instrumented-modules.js';
import {
  AMBIENT,
  caseIds,
  caseKey,
  inCaseOrder,
  keptOwners,
  settledAcross,
  unpackCase,
  unpackFrames,
  type CaseCoordinate,
} from './cases.js';
import { UNTIMED, type CaseDurations } from './case-durations.js';
import eyesFrames from './eyes-frame.cjs';
import type { EyesSection, RecordedEyes } from './eyes-record.js';
import { heardAcross, preconditionsHeard, type Said } from './case-precondition-column.js';
import preconditions from './case-preconditions.cjs';
import type { ExecutionTest } from './reverse.js';
import { isWritten } from './written-lines.js';
import type { Reading } from './readings.js';

/** What the first, allocation-free pass over a case-journal directory learned. */
export interface CaseRun {
  readonly root: string;
  readonly paths: readonly string[];
  readonly tests: readonly ExecutionTest[];
  /** Test row for each non-ambient frame in stable replay order. */
  readonly frameTests: Uint32Array;
  /** The instrument records the fold must load before it can place ordinals. */
  readonly moduleIds: readonly ModuleId[];
  /** Half-open test-row range for each test file; test ordering makes it contiguous. */
  readonly testsByFile: ReadonlyMap<string, readonly [number, number]>;
  /** The cases that opened Eyes journals and what they handed over; absent when none did. */
  readonly eyes?: EyesSection;
}

export interface CaseFold {
  readonly bytes: Buffer;
  /** The number of times every journal was replayed: one per module slice. */
  readonly passes: number;
  /** Logical test-to-region pairs represented by the compact sets. */
  readonly crossings: number;
}

interface Coordinate extends CaseCoordinate {
  /** How the case settled across its frames, by `settledAcross`. */
  stopped?: boolean;
  /** What the case said it arranged, across its frames; absent where no frame listened. */
  said?: Said;
  /** Every frame written under this coordinate, in replay order. */
  readonly frames: number[];
}

/**
 * Name every case and module id without decoding a module row into an object.
 *
 * Only coordinates survive this pass. Journal module rows are stepped over by
 * `scanJournal`; the fold replays them later in slices rather than retaining the
 * run's test-by-region product.
 */
export async function inspectCaseRun(
  directory: string,
  root: string,
  durations: CaseDurations = UNTIMED,
): Promise<CaseRun> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) names = [];
    else throw error;
  }
  const paths = [...names].sort(codeUnitOrder).map((name) => resolve(directory, name));
  const coordinates = new Map<string, Coordinate>();
  const moduleIds = new Set<ModuleId>();
  // What Eyes handed each case, by coordinate key, in the order it arrived.
  const looked = new Map<string, Omit<RecordedEyes, 'case'>[]>();
  let frame = 0;
  for (const path of paths) {
    for (const bytes of unpackFrames(await readFile(path))) {
      const eyes = eyesFrames.decodeEyesFrame(bytes);
      if (eyes !== undefined) {
        const coordinate = unpackCase(eyes.case);
        const located = { ...coordinate, file: projectPath(root, coordinate.file) };
        const key = caseKey(located);
        // A case that watched is a case, whether or not it crossed anything.
        if (!coordinates.has(key)) coordinates.set(key, { ...caseOf(located), frames: [] });
        const rows = looked.get(key) ?? [];
        if (eyes.journal !== undefined) rows.push({ attempt: eyes.attempt, journal: eyes.journal });
        looked.set(key, rows);
        continue;
      }
      scanJournal(bytes, {
        test(packed) {
          const coordinate = unpackCase(packed);
          if (coordinate.name !== AMBIENT || coordinate.id !== AMBIENT) {
            // A case is written when it settles, so work that outlived it
            // arrives as a second frame under the same coordinate: one case.
            const located = { ...coordinate, file: projectPath(root, coordinate.file) };
            const key = caseKey(located);
            const held = coordinates.get(key);
            const said = preconditions.saidOf(packed);
            if (held === undefined) {
              coordinates.set(key, {
                ...caseOf(located),
                ...settledAcross(coordinate.stopped, undefined),
                ...(said === undefined ? {} : { said }),
                frames: [frame],
              });
            } else {
              held.frames.push(frame);
              const settled = settledAcross(held.stopped, coordinate.stopped).stopped;
              if (settled !== undefined) held.stopped = settled;
              const heard = heardAcross(held.said, said);
              if (heard !== undefined) held.said = heard;
            }
            frame += 1;
          }
        },
        wants(id) {
          moduleIds.add(id);
          return false;
        },
        module() { /* refused above */ },
      });
    }
  }

  const ordered = inCaseOrder(coordinates.values());
  const ids = caseIds(ordered);
  const frameTests = new Uint32Array(frame);
  const tests = ordered.map((coordinate, at): ExecutionTest => {
    for (const written of coordinate.frames) frameTests[written] = at;
    const duration = durations(coordinate.file, coordinate.name, coordinate.id);
    return {
      id: ids.get(caseKey(coordinate))!,
      file: coordinate.file,
      name: coordinate.name,
      ...(coordinate.stopped === undefined ? {} : { stopped: coordinate.stopped }),
      ...(duration === undefined ? {} : { duration }),
      ...preconditionsHeard(root, coordinate.said),
    };
  });
  const testsByFile = new Map<string, readonly [number, number]>();
  for (let first = 0; first < tests.length;) {
    let last = first + 1;
    while (last < tests.length && tests[last]!.file === tests[first]!.file) last += 1;
    testsByFile.set(tests[first]!.file, [first, last]);
    first = last;
  }
  const eyes = looked.size === 0 ? undefined : {
    watched: [...looked.keys()].map((key) => ids.get(key)!),
    journals: [...looked].flatMap(([key, rows]) => rows.map((row) => ({ case: ids.get(key)!, ...row }))),
  };
  return { root, paths, tests, frameTests, moduleIds: [...moduleIds], testsByFile, ...(eyes === undefined ? {} : { eyes }) };
}

/** A frame's case coordinate, without how this frame settled. */
function caseOf({ file, name, id, project }: CaseCoordinate): CaseCoordinate {
  return { file, name, id, ...(project === undefined ? {} : { project }) };
}

const DEFAULT_BUDGET = 128 * 1_048_576;
/**
 * A run's case journals as the case index a reporter lays into its record, or
 * `undefined` when the run has none to lay.
 *
 * The bounded fold is the writer: it reads the journals a slice at a time and
 * holds one relation per region, where materializing every case's crossings as
 * objects first cost the reporter 8.6 times the time and 20 times the heap on a
 * 200-case run over a thousand ambient modules — the heap arriving at the end
 * of a worker-heavy run, when the machine has least of it.
 *
 * A run that recorded no case and finished no test file has none, and leaves
 * the record's cases as they were. Absent is not empty: such a run — projects
 * that loaded none of this seam's modules, so no case wrote a frame and no file
 * wrote a journal — did not learn that no case walks any line. Laid over the
 * record anyway, it would name itself the last run with no case and put the
 * cases of every file it was handed in the before layer, as though it had
 * replaced them; laid where none was, it would answer *which cases walk this
 * line* with none.
 *
 * A file that finished did learn, even when none of its cases entered
 * anything: its cases walk no line, and what an earlier run recorded for them
 * is retired. The run already carries that answer — a test is `complete` only
 * when its file wrote a journal and ran to the end — so it is read from
 * `run.tests`, not worked out again from the case journals. The cases decide
 * and the modules do not: the fold keeps a module only when a case entered it.
 *
 * The caller hands the result to `landRun`, which lays it under the record's
 * lock in the same write as the coverage.
 */
export async function freshCases(
  directory: string,
  root: string,
  modules: ReadonlyMap<ModuleId, CapturedModule>,
  run: CaseRunTests,
  readings: ReadonlyMap<ModuleId, Reading> = new Map(),
): Promise<FreshCases | undefined> {
  const finished = run.tests.some((test) => test.complete);
  const inspected = await inspectCaseRun(directory, root, run.durations);
  if (inspected.tests.length === 0 && !finished) return undefined;
  const fresh = (await foldCaseRun(inspected, modules, DEFAULT_BUDGET, readings)).bytes;
  return {
    fresh,
    run: { tests: run.tests, ...(run.commit === undefined ? {} : { commit: run.commit }) },
    ...(inspected.eyes === undefined ? {} : { eyes: inspected.eyes }),
  };
}

/** What a run tells the case index about itself. */
export interface CaseRunTests extends LaidRun {
  /** Each case's duration as the runner reported it; absent, no case is timed. */
  readonly durations?: CaseDurations;
}

/**
 * Fold case journals into compact binary bytes under a fixed relation budget.
 *
 * The inventory and final set pool are the output's own shape. The transient
 * test-by-region relation is limited to one module slice and journals remain on
 * disk, replayed once per slice.
 */
export async function foldCaseRun(
  run: CaseRun,
  modules: ReadonlyMap<ModuleId, CapturedModule>,
  budget = DEFAULT_BUDGET,
  readings: ReadonlyMap<ModuleId, Reading> = new Map(),
): Promise<CaseFold> {
  const shaped = [...modules.entries()].sort(([leftId, left], [rightId, right]) =>
    codeUnitOrder(left.file, right.file) || codeUnitOrder(leftId, rightId),
  );
  const rowOf = new Map<ModuleId, number>();
  const moduleBlocks = new Uint32Array(shaped.length + 1);
  const ordinalOffsets = new Uint32Array(shaped.length + 1);
  for (const [row, [id, module]] of shaped.entries()) {
    rowOf.set(id, row);
    moduleBlocks[row + 1] = moduleBlocks[row]! + module.blocks.length;
    let span = 0;
    for (const block of module.blocks) if (block.ordinal + 1 > span) span = block.ordinal + 1;
    ordinalOffsets[row + 1] = ordinalOffsets[row]! + span;
  }
  const ordinalBlocks = new Int32Array(ordinalOffsets.at(-1) ?? 0);
  ordinalBlocks.fill(-1);
  for (const [row, [, module]] of shaped.entries()) {
    for (const [at, block] of module.blocks.entries()) {
      ordinalBlocks[ordinalOffsets[row]! + block.ordinal] = moduleBlocks[row]! + at;
    }
  }

  const blockCount = moduleBlocks.at(-1) ?? 0;
  const calledSets = new Uint32Array(blockCount);
  // One flag per region and no test: what ran while a module evaluated ran for
  // whichever case imported it first, and the file graph names who loaded it.
  const loaded = new Uint8Array(blockCount);
  const moduleEntered = new Uint8Array(shaped.length);
  const sets = new CrossingSets(run.tests.length);
  const empty = sets.intern([]);
  calledSets.fill(empty);
  if (blockCount === 0 || run.tests.length === 0) {
    return {
      bytes: encodeSetExecutionIndex({ tests: run.tests, modules: [], sets: sets.pool() }),
      passes: 0,
      crossings: 0,
    };
  }

  const words = (run.tests.length + 31) >>> 5;
  const perBlock = words * 8;
  const limit = Math.max(budget, perBlock);
  const scratch = new Uint32Array(run.tests.length);
  let crossings = 0;
  let passes = 0;
  let first = 0;
  while (first < shaped.length) {
    let last = first;
    let held = 0;
    while (last < shaped.length) {
      const cost = (moduleBlocks[last + 1]! - moduleBlocks[last]!) * perBlock;
      if (last > first && held + cost > limit) break;
      held += cost;
      last += 1;
    }
    const firstBlock = moduleBlocks[first]!;
    const localBlocks = moduleBlocks[last]! - firstBlock;
    const called = new Uint32Array(localBlocks * words);
    let caseFrame = 0;
    let testFirst = 0;
    let testLast = 0;
    let moduleRow = -1;
    // A joined reading's ordinals, read in its file's record: see `joinReadings`.
    let lands: readonly (number | undefined)[] | undefined;

    const visit: JournalVisitor = {
      test(packed) {
        const coordinate = unpackCase(packed);
        if (coordinate.name === AMBIENT && coordinate.id === AMBIENT) {
          const range = run.testsByFile.get(projectPath(run.root, coordinate.file));
          testFirst = range?.[0] ?? 0;
          testLast = range?.[1] ?? 0;
        } else {
          const test = run.frameTests[caseFrame++];
          if (test === undefined) throw new Error('case journal replay changed while it was being folded');
          testFirst = test;
          testLast = test + 1;
        }
      },
      wants(id) {
        const reading = readings.get(id);
        const row = rowOf.get(reading?.id ?? id);
        if (row === undefined || row < first || row >= last || testFirst === testLast) return false;
        moduleRow = row;
        lands = reading?.lands;
        return true;
      },
      module(_id, hits, shared) {
        const ordinalBase = ordinalOffsets[moduleRow]!;
        const span = ordinalOffsets[moduleRow + 1]! - ordinalBase;
        let sharedAt = 0;
        for (let at = 0; at < hits.length; at += 1) {
          const hit = hits[at]!;
          while (sharedAt < shared.length && shared[sharedAt]! < hit) sharedAt += 1;
          const ordinal = lands === undefined ? hit : lands[hit] ?? span;
          if (ordinal >= span) continue;
          const block = ordinalBlocks[ordinalBase + ordinal]!;
          if (block < 0) continue;
          if (shared[sharedAt] === hit) loaded[block] = 1;
          else markRange(called, (block - firstBlock) * words, words, testFirst, testLast);
        }
      },
    };
    for (const path of run.paths) {
      for (const frame of unpackFrames(await readFile(path))) {
        if (eyesFrames.decodeEyesFrame(frame) === undefined) scanJournal(frame, visit);
      }
    }
    if (caseFrame !== run.frameTests.length) {
      throw new Error('case journal replay changed while it was being folded');
    }
    passes += 1;

    for (let local = 0; local < localBlocks; local += 1) {
      const at = local * words;
      const calledCount = collect(called, at, words, scratch);
      const block = firstBlock + local;
      calledSets[block] = sets.intern(scratch.subarray(0, calledCount));
      crossings += calledCount;
      if (calledCount > 0 || loaded[block] === 1) moduleEntered[moduleOf(moduleBlocks, first, last, block)] = 1;
    }
    first = last;
  }

  const encodedModules: SetExecutionModule[] = [];
  for (const [row, [, module]] of shaped.entries()) {
    if (moduleEntered[row] !== 1) continue;
    const from = moduleBlocks[row]!;
    // The regions with a place, as `executionIndexFrom` keeps them: the rest
    // were written by the transform, and a journey has nowhere to name them.
    const kept: number[] = [];
    for (const [at, block] of module.blocks.entries()) if (isWritten(block)) kept.push(from + at);
    encodedModules.push({
      file: module.file,
      blocks: module.blocks.filter(isWritten).map((block) => ({
        kind: block.kind,
        name: block.name,
        path: block.path,
        startLine: block.startLine,
        endLine: block.endLine,
        source: block.source,
      })),
      called: Uint32Array.from(kept, (block) => calledSets[block]!),
      loaded: Uint8Array.from(kept, (block) => loaded[block]!),
      owner: keptOwners(module.blocks),
    });
  }
  return {
    bytes: encodeSetExecutionIndex({ tests: run.tests, modules: encodedModules, sets: sets.pool() }),
    passes,
    crossings,
  };
}

function markRange(
  bits: Uint32Array,
  at: number,
  words: number,
  first: number,
  last: number,
): void {
  if (first >= last) return;
  const firstWord = first >>> 5;
  const lastWord = (last - 1) >>> 5;
  if (firstWord === lastWord) {
    const end = last & 31;
    const high = end === 0 ? 0xffff_ffff : (2 ** end - 1) >>> 0;
    bits[at + firstWord] = bits[at + firstWord]! | (high & (0xffff_ffff << (first & 31)));
    return;
  }
  bits[at + firstWord] = bits[at + firstWord]! | (0xffff_ffff << (first & 31));
  bits.fill(0xffff_ffff, at + firstWord + 1, at + lastWord);
  const end = last & 31;
  bits[at + lastWord] = bits[at + lastWord]! | (end === 0 ? 0xffff_ffff : (2 ** end - 1) >>> 0);
  // `words` is part of the address contract; keep an impossible range from
  // silently writing into the next block if a corrupt coordinate reaches here.
  if (lastWord >= words) throw new Error('case journal names a test outside the run');
}

/** Collect one block's set bits as test ordinals. */
function collect(bits: Uint32Array, at: number, words: number, out: Uint32Array): number {
  let held = 0;
  for (let word = 0; word < words; word += 1) {
    let value = bits[at + word]!;
    while (value !== 0) {
      const low = 31 - Math.clz32(value & -value);
      out[held++] = (word << 5) + low;
      value &= value - 1;
    }
  }
  return held;
}

function moduleOf(
  offsets: Uint32Array,
  first: number,
  last: number,
  block: number,
): number {
  let low = first;
  let high = last;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle]! <= block) low = middle;
    else high = middle;
  }
  return low;
}
