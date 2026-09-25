import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { layerCaseIndex } from './case-layer.js';
import { noteABusyIndex, withIndexLock } from './index-lock.js';
import type { ModuleId } from '../instrument/index.js';
import { CrossingSets } from './crossing-sets.js';
import { scanJournal, type JournalVisitor } from './crossing-fold.js';
import { encodeSetExecutionIndex, type SetExecutionModule } from './execution-set-format.js';
import {
  codeUnitOrder,
  idOrder,
  isMissing,
  projectPath,
  type CapturedModule,
} from './instrumented-modules.js';
import { AMBIENT, executionIndexFrom, readCaseJournals, settledAcross, unpackCase, unpackFrames } from './cases.js';
import { executionIndexBytes } from './execution-format.js';
import { writeCoverageBytes, type CoverageTest } from './index.js';
import type { ExecutionTest } from './reverse.js';
import { isWritten } from './written-lines.js';

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
}

export interface CaseFold {
  readonly bytes: Buffer;
  /** The number of times every journal was replayed: one per module slice. */
  readonly passes: number;
  /** Logical test-to-region pairs represented by the compact sets. */
  readonly crossings: number;
}

interface Coordinate {
  readonly file: string;
  readonly name: string;
  readonly id: string;
  /** How the case settled across its frames, by `settledAcross`. */
  stopped?: boolean;
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
export async function inspectCaseRun(directory: string, root: string): Promise<CaseRun> {
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
  let frame = 0;
  for (const path of paths) {
    for (const bytes of unpackFrames(await readFile(path))) {
      scanJournal(bytes, {
        test(packed) {
          const coordinate = unpackCase(packed);
          if (coordinate.name !== AMBIENT || coordinate.id !== AMBIENT) {
            // A case is written when it settles, so work that outlived it
            // arrives as a second frame under the same coordinate: one case.
            const file = projectPath(root, coordinate.file);
            const key = `${file}\0${coordinate.name}\0${coordinate.id}`;
            const held = coordinates.get(key);
            if (held === undefined) {
              coordinates.set(key, {
                file,
                name: coordinate.name,
                id: coordinate.id,
                ...settledAcross(coordinate.stopped, undefined),
                frames: [frame],
              });
            } else {
              held.frames.push(frame);
              const settled = settledAcross(held.stopped, coordinate.stopped).stopped;
              if (settled !== undefined) held.stopped = settled;
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

  const ordered = [...coordinates.values()].sort((left, right) =>
    codeUnitOrder(left.file, right.file) ||
    codeUnitOrder(left.name, right.name) ||
    codeUnitOrder(left.id, right.id),
  );
  const frameTests = new Uint32Array(frame);
  const seen = new Map<string, number>();
  const tests = ordered.map((coordinate, at): ExecutionTest => {
    for (const written of coordinate.frames) frameTests[written] = at;
    const name = `${coordinate.file} > ${coordinate.name}`;
    const repeat = seen.get(name) ?? 0;
    seen.set(name, repeat + 1);
    return {
      id: repeat === 0 ? name : `${name}#${repeat}`,
      file: coordinate.file,
      name: coordinate.name,
      ...(coordinate.stopped === undefined ? {} : { stopped: coordinate.stopped }),
    };
  });
  const testsByFile = new Map<string, readonly [number, number]>();
  for (let first = 0; first < tests.length;) {
    let last = first + 1;
    while (last < tests.length && tests[last]!.file === tests[first]!.file) last += 1;
    testsByFile.set(tests[first]!.file, [first, last]);
    first = last;
  }
  return { root, paths, tests, frameTests, moduleIds: [...moduleIds], testsByFile };
}

const DEFAULT_BUDGET = 128 * 1_048_576;

/**
 * Write a run's case journals as the execution index a reporter leaves beside
 * its snapshot.
 *
 * The bounded fold is the writer: it reads the journals a slice at a time and
 * holds one relation per region, where materializing every case's crossings as
 * objects first cost the reporter 8.6 times the time and 20 times the heap on a
 * 200-case run over a thousand ambient modules — the heap arriving at the end
 * of a worker-heavy run, when the machine has least of it. A `.json` file is
 * still written from the object index, because JSON is that index spelled out.
 */
export async function writeCaseIndex(
  file: string,
  directory: string,
  root: string,
  modules: ReadonlyMap<ModuleId, CapturedModule>,
  run: CaseRunTests,
): Promise<void> {
  if (file.endsWith('.json')) {
    // TODO: lay a JSON index over the one it replaces, as the columns are — a
    // `.json` name is still rewritten with the last run's cases alone.
    await writeCoverageBytes(file, executionIndexBytes(file, executionIndexFrom(await readCaseJournals(directory, root), modules)));
    return;
  }
  const fresh = (await foldCaseRun(await inspectCaseRun(directory, root), modules)).bytes;
  const layers = caseLayerFiles(file);
  const written = await withIndexLock(file, async () => {
    const { merged, last, before } = layerCaseIndex(await readIfThere(file), fresh, {
      ran: new Set(run.tests.map((test) => test.file)),
      finished: new Set(run.tests.filter((test) => test.complete).map((test) => test.file)),
      present: (test) => existsSync(resolve(root, test)),
    });
    await writeCoverageBytes(file, merged);
    const named: LastCaseRun = {
      ...(run.commit === undefined ? {} : { commit: run.commit }),
      at: new Date().toISOString(),
      files: [...new Set(run.tests.map((test) => test.file))].sort(codeUnitOrder),
      cases: last,
    };
    await writeCoverageBytes(layers.last, Buffer.from(`${JSON.stringify(named, null, 2)}\n`));
    // Absent is not empty: with no index to take them from, there is no before.
    if (before === undefined) await rm(layers.before, { force: true });
    else await writeCoverageBytes(layers.before, before);
  });
  if (!written.held) noteABusyIndex(file);
}

/** What a run tells the case index about itself. */
export interface CaseRunTests {
  /** Every test file the run was handed, and whether it ran to the end. */
  readonly tests: readonly Pick<CoverageTest, 'file' | 'complete'>[];
  /** The commit the run was made at, as the snapshot carries it. */
  readonly commit?: string;
}

/**
 * The run that wrote the case index last. Its cases are in the index itself,
 * as that run left them, so this names them and holds nothing else.
 */
export interface LastCaseRun {
  readonly commit?: string;
  readonly at: string;
  readonly files: readonly string[];
  readonly cases: readonly string[];
}

/**
 * The two layers kept beside a case index: the run that wrote it last, and what
 * the index held for that run's files before it landed.
 */
export function caseLayerFiles(file: string): { readonly last: string; readonly before: string } {
  const stem = file.endsWith('.bin') ? file.slice(0, -'.bin'.length) : file;
  return { last: `${stem}.last.json`, before: `${stem}.before.bin` };
}

async function readIfThere(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
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
): Promise<CaseFold> {
  const shaped = [...modules.entries()].sort(([leftId, left], [rightId, right]) =>
    codeUnitOrder(left.file, right.file) || idOrder(leftId, rightId),
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
        const row = rowOf.get(id);
        if (row === undefined || row < first || row >= last || testFirst === testLast) return false;
        moduleRow = row;
        return true;
      },
      module(_id, hits, shared) {
        const ordinalBase = ordinalOffsets[moduleRow]!;
        const span = ordinalOffsets[moduleRow + 1]! - ordinalBase;
        let sharedAt = 0;
        for (let at = 0; at < hits.length; at += 1) {
          const ordinal = hits[at]!;
          if (ordinal >= span) continue;
          while (sharedAt < shared.length && shared[sharedAt]! < ordinal) sharedAt += 1;
          const block = ordinalBlocks[ordinalBase + ordinal]!;
          if (block < 0) continue;
          if (shared[sharedAt] === ordinal) loaded[block] = 1;
          else markRange(called, (block - firstBlock) * words, words, testFirst, testLast);
        }
      },
    };
    for (const path of run.paths) {
      for (const frame of unpackFrames(await readFile(path))) scanJournal(frame, visit);
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
