/**
 * Reading the crossing pool, however it is being held.
 *
 * The other half of {@link file://./crossing-sets.ts}, which builds a pool and
 * decides what container each set goes in. Here nothing is decided: every answer
 * is computed against bytes somebody else already encoded, and the same code
 * serves a pool still in memory and a pool read out of a snapshot section.
 *
 * Separated because the two halves share a format and nothing else. Building is
 * a hash-consing arena that grows, and reading is a handful of random accesses
 * that must not expand anything — a selection asks whether three sets hold one
 * test, and the pool it asks has a million regions in it.
 */

import { openBlob, openWords, packBlob, packWords, type WordColumn } from './columns.js';
import { BITS, LIST, NARROW, RUNS, type CrossingSetsPool, type SetId } from './crossing-sets.js';

/** What a reader holds before it has been asked about anything. */
const EMPTY = new Uint8Array(0);

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
