/**
 * Bitmaps, and what a container of them costs.
 *
 * Counting bits, interning the sets and measuring the bytes an interned pool
 * occupies. Apart from the graph because it is the piece the arms share that is
 * about *storage* rather than about what is being stored.
 */

import { CrossingSets } from '../dist/test-selection/crossing-sets.js';
import {
  TESTS,
  WORDS,
  FUNCTIONS,
} from './variance-store-graph.mjs';

function popcount(value) {
  let x = value - ((value >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >>> 24);
}

/**
 * A pool of whole test-bitmaps, deduplicated by content.
 *
 * Interning by members is what the shipped `CrossingSets` does and it is right
 * for a region, whose set is read once. It is wrong here: an edge's set averages
 * five hundred members, and two million edges would materialize a billion of
 * them only to throw all but a few thousand away. So the fold dedupes the fixed
 * sixty-three words first, and only the survivors are ever expanded.
 */
function bitmapPool() {
  const buckets = new Map();
  let arena = new Uint32Array(1024 * WORDS);
  let size = 0;
  return {
    get size() {
      return size;
    },
    words: () => arena,
    idOf(source, at) {
      let hash = 0x811c9dc5;
      for (let word = 0; word < WORDS; word += 1) {
        hash = Math.imul(hash ^ source[at + word], 0x01000193) >>> 0;
      }
      let bucket = buckets.get(hash);
      if (bucket === undefined) buckets.set(hash, (bucket = []));
      else {
        for (const id of bucket) {
          const base = id * WORDS;
          let same = true;
          for (let word = 0; word < WORDS; word += 1) {
            if (arena[base + word] !== source[at + word]) {
              same = false;
              break;
            }
          }
          if (same) return id;
        }
      }
      if ((size + 1) * WORDS > arena.length) {
        const grown = new Uint32Array(arena.length * 2);
        grown.set(arena);
        arena = grown;
      }
      const id = size;
      size += 1;
      for (let word = 0; word < WORDS; word += 1) arena[id * WORDS + word] = source[at + word];
      bucket.push(id);
      return id;
    },
  };
}

/** What the pool's sets cost once handed to the containers that ship. */
function containerBytes(pool) {
  const sets = new CrossingSets(TESTS);
  const words = pool.words();
  const members = new Uint32Array(TESTS);
  for (let id = 0; id < pool.size; id += 1) {
    let wrote = 0;
    const base = id * WORDS;
    for (let word = 0; word < WORDS; word += 1) {
      let bits = words[base + word];
      while (bits !== 0) {
        const bit = bits & -bits;
        members[wrote++] = (word << 5) + 31 - Math.clz32(bit);
        bits ^= bit;
      }
    }
    sets.intern(members.subarray(0, wrote));
  }
  return { bytes: sets.byteLength, distinct: sets.size, pool: sets };
}

/** The reverse call graph, which is the "travel left" direction. */
function reverseCalls(calls) {
  const head = new Uint32Array(FUNCTIONS + 2);
  for (let at = 0; at < calls.to.length; at += 1) head[calls.to[at] + 2] += 1;
  for (let fn = 0; fn < FUNCTIONS; fn += 1) head[fn + 2] += head[fn + 1];
  const into = new Uint32Array(calls.to.length);
  for (let at = 0; at < calls.to.length; at += 1) into[head[calls.to[at] + 1]++] = calls.from[at];
  return { head: head.subarray(0, FUNCTIONS + 1), into };
}

/** The forward call graph in CSR, which is the "travel right" direction. */
function forwardCalls(calls) {
  const head = new Uint32Array(FUNCTIONS + 2);
  for (let at = 0; at < calls.from.length; at += 1) head[calls.from[at] + 2] += 1;
  for (let fn = 0; fn < FUNCTIONS; fn += 1) head[fn + 2] += head[fn + 1];
  const outof = new Uint32Array(calls.from.length);
  for (let at = 0; at < calls.from.length; at += 1) outof[head[calls.from[at] + 1]++] = calls.to[at];
  return { head: head.subarray(0, FUNCTIONS + 1), outof };
}

/** How many bytes a varint takes, which is what a gap-coded adjacency costs. */
const varint = (value) => (value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : value < 268435456 ? 4 : 5);

export {
  popcount,
  bitmapPool,
  containerBytes,
  reverseCalls,
  forwardCalls,
  varint,
};
