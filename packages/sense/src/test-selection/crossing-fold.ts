import type { ModuleId } from '../instrument/index.js';
import { CrossingSets, type SetId } from './crossing-sets.js';
import journalFormat from './journal-format.cjs';

/**
 * The crossings of a whole run, folded out of its journals without the run ever
 * being in memory at once.
 *
 * A journal says what one test file entered. Folding them is a transpose: the
 * frames arrive test-major and what a snapshot stores is module-major, and the
 * obvious way to turn one into the other is to hold every pair until the last
 * frame has been read. The pairs are the product of two axes a repository grows
 * independently — two hundred thousand modules at eight regions each against two
 * thousand test files whose imports reach forty thousand modules apiece — and a
 * measurement of the obvious way puts thirty-one test files of that shape at two
 * and a half gigabytes and five hundred at more than twelve.
 *
 * So the transpose is done over a slice of the modules at a time. A slice's
 * crossings are a bitmap — one bit per region and test, which costs what the
 * slice is wide however many crossings land in it — and the frames are read
 * once per slice. The slice is sized from a stated budget, so what the fold
 * holds is a number the caller chose rather than a number the repository did,
 * and the cost of choosing a smaller one is another pass over journals that are
 * already compact frames on disk.
 *
 * Regions come out in module-then-ordinal order, which is the order a snapshot
 * writes them and therefore the order its pool is interned in.
 */

/** A module row the fold can place, and where its regions are. */
export interface FoldShape {
  /** Output row of a module, or `undefined` for one this run has no record of. */
  readonly rowOf: (id: ModuleId) => number | undefined;
  /**
   * Where each module's regions begin, and one past the last: `modules + 1`
   * entries, the same column a snapshot stores as `modules.blocks`.
   *
   * A module's ordinals are its region offsets from `moduleBlocks[row]`, which
   * is what the instrumented build numbers them as. An ordinal past the module's
   * last region is a journal describing text nobody has any more, and is dropped
   * rather than credited to whichever region it lands on.
   */
  readonly moduleBlocks: Uint32Array;
}

export interface FoldInput extends FoldShape {
  /**
   * Feeds every frame of the run through one visitor, in the same order every
   * time it is called. The fold calls it once per slice; a caller reading files
   * opens them again rather than keeping them.
   */
  readonly replay: (visit: JournalVisitor) => void;
  /** Test files in the order the snapshot holds them: the fold numbers by this. */
  readonly testId: ReadonlyMap<string, number>;
  /** What the fold may hold for one slice. Default is a hundred and twenty-eight megabytes. */
  readonly budget?: number;
}

/** The visitor {@link FoldInput.replay} feeds. Its shape is the journal reader's. */
export interface JournalVisitor {
  test(file: string): void;
  wants?(id: ModuleId): boolean;
  module(id: ModuleId, hits: Uint32Array, shared: Uint32Array, loaded: Uint32Array): void;
}

export interface FoldedCrossings {
  /** The set each region's crossers were interned as, in output region order. */
  readonly entered: Uint32Array;
  readonly enteredSets: CrossingSets;
  /** The same for what had been entered before each test's first test ran. */
  readonly loaded: Uint32Array;
  readonly loadedSets: CrossingSets;
  /** How many times the journals were read: one per slice. */
  readonly passes: number;
}

const DEFAULT_BUDGET = 128 * 1_048_576;

export function foldCrossings(input: FoldInput): FoldedCrossings {
  const { replay, testId, rowOf, moduleBlocks } = input;
  const moduleCount = moduleBlocks.length - 1;
  const blockCount = moduleBlocks[moduleCount] ?? 0;
  const testCount = testId.size;
  const words = (testCount + 31) >>> 5;

  const entered = new Uint32Array(blockCount);
  const loaded = new Uint32Array(blockCount);
  const enteredSets = new CrossingSets(testCount);
  const loadedSets = new CrossingSets(testCount);
  if (blockCount === 0 || testCount === 0) {
    // Still one set each, so a region that crossed nothing names the empty one
    // rather than a set that is not in the pool.
    enteredSets.intern([]);
    loadedSets.intern([]);
    return { entered, enteredSets, loaded, loadedSets, passes: 0 };
  }

  // What a region costs while its slice is open: a bit per test for each of the
  // two relations, and a byte apiece saying whether any frame reported the
  // region as entered while its module was evaluating.
  const perRegion = words * 8 + 2;
  // And what a module costs: the bits saying which tests consumed it at all,
  // which is who an evaluation-time region belongs to.
  const perModule = words * 4;
  const budget = Math.max(input.budget ?? DEFAULT_BUDGET, perRegion + perModule);

  // Room for every test, because one region can be crossed by every test.
  const scratch = new Uint32Array(testCount);
  let first = 0;
  let passes = 0;
  while (first < moduleCount) {
    // As many modules as the budget holds, and never fewer than one: a module
    // whose regions alone exceed the budget is folded on its own rather than
    // split, because a region's crossers have to be complete to be interned.
    let last = first;
    let held = 0;
    while (last < moduleCount) {
      const cost =
        perModule + (moduleBlocks[last + 1]! - moduleBlocks[last]!) * perRegion;
      if (last > first && held + cost > budget) break;
      held += cost;
      last += 1;
    }

    const firstBlock = moduleBlocks[first]!;
    const regions = moduleBlocks[last]! - firstBlock;
    const ownBits = new Uint32Array(regions * words);
    const loadedBits = new Uint32Array(regions * words);
    const sharedSeen = new Uint8Array(regions);
    const loadedShared = new Uint8Array(regions);
    const consumers = new Uint32Array((last - first) * words);

    let test = -1;
    let row = -1;
    let base = 0;
    let span = 0;
    const visit: JournalVisitor = {
      test(file) {
        test = testId.get(file) ?? -1;
      },
      wants(id) {
        if (test < 0) return false;
        const at = rowOf(id);
        if (at === undefined || at < first || at >= last) return false;
        row = at;
        base = moduleBlocks[at]! - firstBlock;
        span = moduleBlocks[at + 1]! - moduleBlocks[at]!;
        return true;
      },
      module(_id, hits, shared, early) {
        const word = test >>> 5;
        const bit = 1 << (test & 31);
        const consumer = (row - first) * words + word;
        consumers[consumer] = consumers[consumer]! | bit;
        // An ordinal this frame reports as entered while its module was
        // evaluating is owed to everything that consumed the module, and which
        // those are is not known until the pass is done — so the debt is noted
        // here and settled below. `shared` holds a handful of ordinals where
        // `hits` holds the module's, so it is searched rather than indexed.
        const evaluating = (ordinal: number): boolean => {
          for (let at = 0; at < shared.length; at += 1) if (shared[at] === ordinal) return true;
          return false;
        };
        // An ordinal past the module's last region names text nobody has any
        // more. It is dropped, not credited to whichever region it lands on.
        for (let at = 0; at < hits.length; at += 1) {
          const ordinal = hits[at]!;
          if (ordinal >= span) continue;
          if (evaluating(ordinal)) sharedSeen[base + ordinal] = 1;
          else {
            const slot = (base + ordinal) * words + word;
            ownBits[slot] = ownBits[slot]! | bit;
          }
        }
        for (let at = 0; at < early.length; at += 1) {
          const ordinal = early[at]!;
          if (ordinal >= span) continue;
          // What a module did while evaluating happened before the first test
          // of every file that consumed it, so the same crediting applies.
          if (evaluating(ordinal)) loadedShared[base + ordinal] = 1;
          else {
            const slot = (base + ordinal) * words + word;
            loadedBits[slot] = loadedBits[slot]! | bit;
          }
        }
      },
    };
    replay(visit);
    passes += 1;

    for (let module = first; module < last; module += 1) {
      const at = (module - first) * words;
      const from = moduleBlocks[module]! - firstBlock;
      const to = moduleBlocks[module + 1]! - firstBlock;
      for (let region = from; region < to; region += 1) {
        const owed = sharedSeen[region] === 1 ? consumers : undefined;
        const owedEarly = loadedShared[region] === 1 ? consumers : undefined;
        entered[firstBlock + region] = intern(enteredSets, ownBits, region * words, owed, at, words, scratch);
        loaded[firstBlock + region] = intern(loadedSets, loadedBits, region * words, owedEarly, at, words, scratch);
      }
    }
    first = last;
  }
  return { entered, enteredSets, loaded, loadedSets, passes };
}

/** One region's bits, plus the module's consumers when it is owed them, as a set. */
function intern(
  sets: CrossingSets,
  bits: Uint32Array,
  at: number,
  consumers: Uint32Array | undefined,
  module: number,
  words: number,
  scratch: Uint32Array,
): SetId {
  let held = 0;
  for (let word = 0; word < words; word += 1) {
    let value = bits[at + word]!;
    if (consumers !== undefined) value |= consumers[module + word]!;
    while (value !== 0) {
      const low = 31 - Math.clz32(value & -value);
      scratch[held++] = (word << 5) + low;
      value &= value - 1;
    }
  }
  return sets.intern(scratch.subarray(0, held));
}

/** Read one frame into a visitor without it becoming rows. */
export function scanJournal(raw: Uint8Array, visit: JournalVisitor): void {
  journalFormat.scanJournal(raw, visit);
}
