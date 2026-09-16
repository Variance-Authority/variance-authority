/**
 * The crossing relation stored as sets rather than as pairs.
 *
 * A snapshot has to answer *which tests entered this region*, and the obvious
 * storage is the pairs themselves: one row per (region, test), which is what
 * `blocks.tests` and `crossings.test` hold today. The count of those pairs is
 * the product of two numbers a repository grows independently, and a large one
 * makes the product the only figure that matters. Two hundred thousand modules
 * at eight regions each, two thousand test files whose imports reach forty
 * thousand modules apiece, and the relation is six hundred and forty million
 * pairs — two and a half gigabytes before a single byte is written, and the
 * encoder's own working set on top of that.
 *
 * The bytes were never the problem. That index compresses to fourteen megabytes
 * on disk. What it costs is the expansion: every read of it, and every write
 * that begins with a read, materializes the whole product to change ten modules
 * of two hundred thousand.
 *
 * ## Why the sets are smaller than the pairs
 *
 * A region is not crossed by an arbitrary subset of the suite. It is crossed by
 * *whoever reached it*, and reaching is transitive over imports, so two regions
 * in the same module are usually crossed by the same tests, and so are the
 * regions of every module that only that module imports. A platform helper
 * entered through one hardcoded path is crossed by every test that touches its
 * caller, exactly, with no variation at all.
 *
 * So the relation has far fewer distinct *sets* than it has regions. Storing one
 * set once and naming it from every region that has it turns a product into a
 * sum: one word per region, plus one copy of each distinct set. The regions are
 * millions and the word is four bytes; the sets are over the test axis, which is
 * thousands, and a set that repeats a hundred thousand times is stored once.
 *
 * This is hash-consing, and the property it needs is that equal sets are
 * recognisably equal. {@link CrossingSets} gets that by comparing the encoded
 * bytes: the container choice below is a function of the set alone, so two equal
 * sets encode to identical bytes and a byte comparison is a set comparison.
 *
 * ## Three containers, and why the choice is per set
 *
 * Density varies by orders of magnitude inside one snapshot, and no single
 * encoding is right across that range. A leaf region touched by two tests and a
 * platform region touched by every test are both ordinary.
 *
 * - {@link LIST} lists the test ids. Right when the set is small: two bytes a
 *   member against a bitmap's fixed width.
 * - {@link BITS} is one bit per test. Right in the middle, where a list would
 *   spend more than a bit per test.
 * - {@link RUNS} lists `(first, length)` pairs. Right when the set is *contiguous*
 *   in test id, which is what a set of "every test in these three files" is once
 *   ids follow path order — and what the near-universal sets of deep platform
 *   code are, since those are every test there is, in one run.
 *
 * The smallest of the three wins, computed per set, which is the only way a
 * single index serves both ends of that range. A set that is all of the suite
 * costs nine bytes whatever the suite's size.
 *
 * ## What this file does not do
 *
 * It does not decide *when* a region's set changes, which is the merge's
 * business, and it does not name tests — ids here are indices into the
 * snapshot's test table, assigned by the caller. It holds no strings, because
 * strings are what made the model expensive in the first place.
 */

import { openBlob, openWords, packBlob, packWords, type WordColumn } from './columns.js';

/** A set of test ids, as stored. Names one entry of the pool. */
export type SetId = number;

/** Sorted test ids, two or four bytes each. */
export const LIST = 0;
/** One bit per test in the snapshot. */
export const BITS = 1;
/** Sorted `(first, length)` pairs, two or four bytes each. */
export const RUNS = 2;

/** Ids up to this fit in two bytes, which halves both list containers. */
const NARROW = 0x1_0000;

/** What a reader holds before it has been asked about anything. */
const EMPTY = new Uint8Array(0);

/**
 * Address space the arena reserves once it is worth reserving any.
 *
 * Growing a byte array by copying costs twice the array at the moment of the
 * copy, and at the sizes this index reaches that transient is the peak — a pool
 * that settles at four hundred megabytes touches eight hundred on its way there,
 * which is the difference between fitting in a developer's budget and not. A
 * resizable buffer reserves the range up front and commits pages as they are
 * written, so growth is a bookkeeping change and the copy never happens.
 *
 * Reserving is not allocating: untouched pages cost nothing, which is why the
 * number can be this much larger than any pool is expected to be.
 */
const RESERVE = 1 << 30;

/** Below this an arena is small enough that copying it is not worth avoiding. */
const MODEST = 1 << 20;

/**
 * A buffer that grows in place.
 *
 * Declared here rather than reached for through `lib`: this package targets
 * ES2022 deliberately, and one growth strategy is not a reason to move the whole
 * package's floor. The runtime has had it since Node 20; where it does not, the
 * check below falls back to copying and the only difference is the transient.
 */
interface GrowableBuffer extends ArrayBuffer {
  readonly resizable: boolean;
  readonly maxByteLength: number;
  resize(byteLength: number): void;
}

type GrowableBufferConstructor = new (
  byteLength: number,
  options: { maxByteLength: number },
) => GrowableBuffer;

const growable = (bytes: number, most: number): GrowableBuffer | undefined => {
  try {
    return new (ArrayBuffer as unknown as GrowableBufferConstructor)(bytes, { maxByteLength: most });
  } catch {
    return undefined;
  }
};

/**
 * Where one set's bytes begin and end, and which container they are in.
 *
 * The pool is one byte array with an offset per set rather than one array per
 * set: a million small typed arrays is a million object headers, and the header
 * is larger than most of the sets.
 */
export interface CrossingSetsPool {
  /** Every set's bytes, concatenated in id order. */
  readonly bytes: Uint8Array;
  /** `offsets[id]` through `offsets[id + 1]` is the set's bytes. */
  readonly offsets: Uint32Array;
  /** How many tests the ids range over, which the containers are sized against. */
  readonly testCount: number;
}

/**
 * How many bytes `members` costs in each container, given `testCount` tests.
 *
 * Exported because the choice is worth asserting against directly: a test that
 * only checks the round trip cannot tell a container that was chosen from one
 * that was fallen into.
 */
export function containerSizes(
  members: readonly number[] | Uint32Array,
  count: number,
  testCount: number,
): { readonly list: number; readonly bits: number; readonly runs: number } {
  const width = testCount < NARROW ? 2 : 4;
  let runs = 0;
  for (let at = 0; at < count; at += 1) {
    if (at === 0 || members[at]! !== members[at - 1]! + 1) runs += 1;
  }
  return {
    list: 1 + count * width,
    bits: 1 + (((testCount + 31) >>> 5) << 2),
    runs: 1 + runs * 2 * width,
  };
}

/**
 * Encode one set into `out` at `at`, smallest container wins, and say how many
 * bytes it took.
 *
 * It writes into the caller's array rather than returning one because the
 * caller is interning a million regions and most of them are duplicates: a set
 * that turns out to be held already has to cost nothing but the bytes it was
 * compared against, and an allocation per region is an object header per region
 * — which, at this count, is larger than the sets themselves.
 *
 * `members` must be sorted and free of duplicates through `count`; the builder
 * guarantees that, and this is not defensive about it.
 */
function writeSet(
  out: Uint8Array,
  view: DataView,
  at: number,
  members: Uint32Array,
  count: number,
  testCount: number,
): number {
  const sizes = containerSizes(members, count, testCount);
  const width = testCount < NARROW ? 2 : 4;
  const smallest = Math.min(sizes.list, sizes.bits, sizes.runs);

  if (smallest === sizes.bits) {
    const words = (testCount + 31) >>> 5;
    out[at] = BITS;
    out.fill(0, at + 1, at + 1 + (words << 2));
    for (let step = 0; step < count; step += 1) {
      const test = members[step]!;
      const offset = at + 1 + ((test >>> 5) << 2);
      view.setUint32(offset, view.getUint32(offset, true) | (1 << (test & 31)), true);
    }
    return sizes.bits;
  }

  if (smallest === sizes.runs) {
    out[at] = RUNS;
    let step = 0;
    let wrote = at + 1;
    while (step < count) {
      const first = members[step]!;
      let end = step + 1;
      while (end < count && members[end]! === members[end - 1]! + 1) end += 1;
      if (width === 2) {
        view.setUint16(wrote, first, true);
        view.setUint16(wrote + 2, end - step, true);
      } else {
        view.setUint32(wrote, first, true);
        view.setUint32(wrote + 4, end - step, true);
      }
      wrote += width * 2;
      step = end;
    }
    return sizes.runs;
  }

  out[at] = LIST;
  for (let step = 0; step < count; step += 1) {
    if (width === 2) view.setUint16(at + 1 + step * 2, members[step]!, true);
    else view.setUint32(at + 1 + step * 4, members[step]!, true);
  }
  return sizes.list;
}

/**
 * The pool, built one set at a time, holding no set twice.
 *
 * Built streaming on purpose: the caller hands over one region's crossers,
 * receives a number, and is free to forget them. Nothing here ever holds the
 * relation, so the peak is the pool — the distinct sets — rather than the
 * product of the two axes.
 *
 * Everything inside is a typed array, including the index that recognises a set
 * it has seen. That is not tidiness: the case this has to survive is the one
 * where *nothing* repeats, and there a `Map` of hashes to candidate ids spends
 * more on its own entries than the sets spend on their bytes. An open-addressed
 * table of ids costs four bytes a set and has no per-set object at all.
 */
export class CrossingSets {
  readonly #testCount: number;
  /** Every set's bytes end to end. Grown by doubling, never per set. */
  #arena: Uint8Array;
  #view: DataView;
  #length = 0;
  /** `#offsets[id]` through `#offsets[id + 1]` is set `id`. One more row than sets. */
  #offsets: Uint32Array;
  #size = 0;
  /** Open-addressed: `#slots[probe]` is `id + 1`, or zero for an empty slot. */
  #slots: Int32Array;
  #mask: number;
  /** Each set's hash, so growing the table does not re-read the bytes. */
  #hashes: Uint32Array;
  #scratch = new Uint32Array(64);

  constructor(testCount: number) {
    this.#testCount = testCount;
    this.#arena = new Uint8Array(1 << 16);
    this.#view = new DataView(this.#arena.buffer);
    this.#offsets = new Uint32Array(1024);
    this.#slots = new Int32Array(1024);
    this.#mask = 1023;
    this.#hashes = new Uint32Array(512);
  }

  /** How many distinct sets the pool holds. */
  get size(): number {
    return this.#size;
  }

  /** How many bytes the pool has accumulated, containers only. */
  get byteLength(): number {
    return this.#length;
  }

  #reserve(bytes: number): void {
    const need = this.#length + bytes;
    if (need <= this.#arena.length) return;
    let capacity = this.#arena.length;
    while (capacity < need) capacity *= 2;

    const buffer = this.#arena.buffer as GrowableBuffer;
    if (buffer.resizable === true && capacity <= buffer.maxByteLength) {
      buffer.resize(capacity);
      return;
    }
    // Past the modest size, and once per pool: move into reserved space, where
    // every later growth is a resize rather than a copy.
    const reserved =
      capacity < MODEST ? undefined : growable(capacity, Math.max(RESERVE, capacity * 2));
    const grown = new Uint8Array(reserved ?? new ArrayBuffer(capacity));
    grown.set(this.#arena.subarray(0, this.#length));
    this.#arena = grown;
    this.#view = new DataView(grown.buffer);
  }

  #rehash(): void {
    const slots = new Int32Array(this.#slots.length * 2);
    const mask = slots.length - 1;
    for (let id = 0; id < this.#size; id += 1) {
      let probe = this.#hashes[id]! & mask;
      while (slots[probe] !== 0) probe = (probe + 1) & mask;
      slots[probe] = id + 1;
    }
    this.#slots = slots;
    this.#mask = mask;
  }

  /**
   * The id of this set, interning it if the pool has not seen it.
   *
   * `tests` may arrive in any order and may repeat; this sorts and dedupes into
   * scratch. The scratch grows and is reused, so a caller in a loop allocates
   * nothing per region.
   */
  intern(tests: Iterable<number>): SetId {
    let count = 0;
    for (const test of tests) {
      if (count === this.#scratch.length) {
        const grown = new Uint32Array(this.#scratch.length * 2);
        grown.set(this.#scratch);
        this.#scratch = grown;
      }
      this.#scratch[count++] = test;
    }
    const members = this.#scratch.subarray(0, count);
    members.sort();
    let unique = 0;
    for (let at = 0; at < count; at += 1) {
      if (at === 0 || members[at]! !== members[at - 1]!) members[unique++] = members[at]!;
    }

    // Written where it would live if it turns out to be new. If it does not,
    // the arena simply does not advance and the bytes are overwritten next time.
    const widest = containerSizes(members, unique, this.#testCount);
    this.#reserve(Math.max(widest.list, widest.bits, widest.runs));
    const at = this.#length;
    const length = writeSet(this.#arena, this.#view, at, members, unique, this.#testCount);

    // Equal sets encode identically, so the bytes are the identity.
    let hash = 2166136261;
    for (let step = 0; step < length; step += 1) {
      hash = Math.imul(hash ^ this.#arena[at + step]!, 16777619) >>> 0;
    }

    let probe = hash & this.#mask;
    for (;;) {
      const slot = this.#slots[probe]!;
      if (slot === 0) break;
      const id = slot - 1;
      if (this.#hashes[id] === hash) {
        const start = this.#offsets[id]!;
        if (this.#offsets[id + 1]! - start === length) {
          let same = true;
          for (let step = 0; step < length && same; step += 1) {
            same = this.#arena[start + step] === this.#arena[at + step];
          }
          if (same) return id;
        }
      }
      probe = (probe + 1) & this.#mask;
    }

    const id = this.#size;
    this.#length = at + length;
    this.#size += 1;
    if (this.#size + 1 > this.#offsets.length) {
      const grown = new Uint32Array(this.#offsets.length * 2);
      grown.set(this.#offsets);
      this.#offsets = grown;
    }
    this.#offsets[this.#size] = this.#length;
    if (this.#size > this.#hashes.length) {
      const grown = new Uint32Array(this.#hashes.length * 2);
      grown.set(this.#hashes);
      this.#hashes = grown;
    }
    this.#hashes[id] = hash;
    this.#slots[probe] = id + 1;
    // Kept under three quarters full; past that the probes are the cost.
    if (this.#size * 4 > this.#slots.length * 3) this.#rehash();
    return id;
  }

  /** The pool as one byte array and its offsets, ready to store. */
  pool(): CrossingSetsPool {
    return {
      bytes: this.#arena.subarray(0, this.#length),
      offsets: this.#offsets.subarray(0, this.#size + 1),
      testCount: this.#testCount,
    };
  }

  /** The offsets as a column, for a layout that stores them beside the bytes. */
  packedOffsets(): Buffer {
    return packWords(this.#offsets.slice(0, this.#size + 1));
  }
}

/**
 * Where one set's bytes are, whoever is holding them.
 *
 * The in-memory pool and a stored one answer this the same way, which is the
 * point: {@link openCrossingSets} reads a snapshot section through the same
 * code it reads a freshly built pool through, and neither has to become the
 * other first. A stored pool arrives as a run-coded blob that decompresses one
 * run at a time, so a selection that asks about a hundred sets never touches
 * the rest of the file.
 */
export interface CrossingSetsSource {
  /** How many distinct sets there are. */
  readonly size: number;
  /** How many tests the ids range over, which the containers were sized against. */
  readonly testCount: number;
  /** One set's encoded bytes. */
  bytes(set: SetId): Uint8Array;
}

/** A pool opened for reading, answering both directions of the relation. */
export interface CrossingSetsView {
  /** How many distinct sets the pool holds. */
  readonly size: number;
  /** Whether `test` is in `set`, without materializing it. */
  has(set: SetId, test: number): boolean;
  /** How many tests are in `set`, without materializing it. */
  count(set: SetId): number;
  /** The tests in `set`, in ascending id order. */
  members(set: SetId): Uint32Array;
  /** Which container `set` was stored in. Diagnostics and tests. */
  containerOf(set: SetId): number;
}

/** A built pool, read without storing it first. */
export function poolSource(pool: CrossingSetsPool): CrossingSetsSource {
  const { bytes, offsets, testCount } = pool;
  return {
    size: offsets.length - 1,
    testCount,
    bytes: (set) => bytes.subarray(offsets[set]!, offsets[set + 1]!),
  };
}

/**
 * Read a pool.
 *
 * Every answer is computed against the stored bytes. Nothing is decoded on open
 * and nothing is cached beyond the set last asked about, because the caller that
 * matters — selection — asks {@link CrossingSetsView.has} against a handful of
 * sets and never wants the millions of members the rest of the pool holds. The
 * one set it holds onto is the one the next three questions are about: `count`
 * then `members` is the ordinary sequence, and each would otherwise decompress
 * the same run again.
 */
export function openCrossingSets(source: CrossingSetsPool | CrossingSetsSource): CrossingSetsView {
  const held = 'bytes' in source && typeof source.bytes === 'function'
    ? (source as CrossingSetsSource)
    : poolSource(source as CrossingSetsPool);
  const { testCount } = held;
  const width = testCount < NARROW ? 2 : 4;

  let last = -1;
  let bytes: Uint8Array = EMPTY;
  let view: DataView = new DataView(EMPTY.buffer);
  const load = (set: SetId): void => {
    if (set === last) return;
    bytes = held.bytes(set);
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    last = set;
  };

  const readAt = (offset: number): number =>
    width === 2 ? view.getUint16(offset, true) : view.getUint32(offset, true);

  const countOf = (): number => {
    const kind = bytes[0];
    if (kind === LIST) return (bytes.length - 1) / width;
    if (kind === RUNS) {
      let total = 0;
      for (let cursor = 1; cursor < bytes.length; cursor += width * 2) total += readAt(cursor + width);
      return total;
    }
    let total = 0;
    for (let cursor = 1; cursor < bytes.length; cursor += 4) {
      let word = view.getUint32(cursor, true);
      while (word !== 0) {
        word &= word - 1;
        total += 1;
      }
    }
    return total;
  };

  return {
    size: held.size,

    containerOf(set) {
      load(set);
      return bytes[0] ?? LIST;
    },

    has(set, test) {
      load(set);
      const kind = bytes[0];
      if (kind === BITS) {
        const at = 1 + ((test >>> 5) << 2);
        if (at + 4 > bytes.length) return false;
        return (view.getUint32(at, true) & (1 << (test & 31))) !== 0;
      }
      if (kind === RUNS) {
        for (let cursor = 1; cursor < bytes.length; cursor += width * 2) {
          const first = readAt(cursor);
          if (test < first) return false;
          if (test < first + readAt(cursor + width)) return true;
        }
        return false;
      }
      for (let cursor = 1; cursor < bytes.length; cursor += width) {
        const member = readAt(cursor);
        if (member === test) return true;
        if (member > test) return false;
      }
      return false;
    },

    count(set) {
      load(set);
      return countOf();
    },

    members(set) {
      load(set);
      const kind = bytes[0];
      const out = new Uint32Array(countOf());
      let wrote = 0;
      if (kind === LIST) {
        for (let cursor = 1; cursor < bytes.length; cursor += width) out[wrote++] = readAt(cursor);
        return out;
      }
      if (kind === RUNS) {
        for (let cursor = 1; cursor < bytes.length; cursor += width * 2) {
          const first = readAt(cursor);
          const length = readAt(cursor + width);
          for (let step = 0; step < length; step += 1) out[wrote++] = first + step;
        }
        return out;
      }
      for (let cursor = 1; cursor < bytes.length; cursor += 4) {
        const word = view.getUint32(cursor, true);
        if (word === 0) continue;
        const base = (cursor - 1) << 3;
        for (let bit = 0; bit < 32; bit += 1) if (word & (1 << bit)) out[wrote++] = base + bit;
      }
      return out;
    },
  };
}

/**
 * Every region whose set contains `test`, as a run over the id column.
 *
 * The reverse direction has no index and does not need one: the pool is small
 * enough that asking every *set* whether it holds the test, then scanning the
 * id column once, is a linear pass over two arrays rather than a join. A
 * repository with a million regions and a few thousand distinct sets pays for
 * the million, and the million is a typed array.
 */
export function blocksCrossedBy(
  ids: WordColumn | Uint32Array,
  sets: CrossingSetsView,
  test: number,
): Uint32Array {
  const all = ids instanceof Uint32Array ? ids : ids.all();
  const carries = new Uint8Array(sets.size);
  for (let set = 0; set < sets.size; set += 1) carries[set] = sets.has(set, test) ? 1 : 0;
  let found = 0;
  for (let block = 0; block < all.length; block += 1) if (carries[all[block]!]) found += 1;
  const out = new Uint32Array(found);
  let wrote = 0;
  for (let block = 0; block < all.length; block += 1) if (carries[all[block]!]) out[wrote++] = block;
  return out;
}

/**
 * The pool as two sections, in the snapshot's own column encoding.
 *
 * Nothing new is invented for storage. The sets are variable-length byte
 * strings cut by an offset column, which is exactly what the string blob is, so
 * they run-code and compress through `packBlob` and come back through
 * `openBlob` — decompressed a run at a time, which is what lets a selection ask
 * about a few sets without expanding the file.
 */
export function packCrossingSets(pool: CrossingSetsPool): {
  readonly sets: Buffer;
  readonly offsets: Buffer;
} {
  return { sets: packBlob(pool.bytes, pool.offsets), offsets: packWords(pool.offsets) };
}

/**
 * Read a stored pool.
 *
 * `size` is how many sets there are; the offset column holds one more row than
 * that, since a set is cut between two offsets.
 */
export function openPackedCrossingSets(
  sets: Uint8Array,
  offsets: Uint8Array,
  size: number,
  testCount: number,
): CrossingSetsSource {
  const column = openWords(offsets, size + 1);
  const blob = openBlob(sets, () => column.all());
  return { size, testCount, bytes: (set) => blob(set) };
}
