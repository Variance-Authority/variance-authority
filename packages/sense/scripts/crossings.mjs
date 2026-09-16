/**
 * What the crossing relation costs to build and hold, at a scale nobody has a
 * repository for on this machine.
 *
 * The relation a snapshot has to answer from is *which tests entered this
 * region*, and its size is the product of two numbers a repository grows
 * independently. Two hundred thousand modules at eight regions each, two
 * thousand test files whose imports reach forty thousand modules apiece, and
 * that product is six hundred and forty million pairs. Storing it as pairs —
 * which is what a list of test paths per region is — costs gigabytes of live
 * objects before a byte is written, and every read of the index pays it again.
 *
 * So the question is not what the pairs compress to. It is whether the index can
 * be *built and read* inside a working set a developer's machine has, which is
 * the number this script reports: peak resident size, against a stated ceiling.
 *
 *   node scripts/crossings.mjs [modules] [tests] [blocks-per-module]
 *
 * The graph is synthetic and says so. What is not invented is its shape: a test
 * reaches forty thousand modules through *barrel re-exports*, which is the
 * mechanism that actually does it — one import of an index file pulls every leaf
 * the barrel names, and a test that touches forty barrels has pulled eighty
 * thousand modules without a single deep import. Closures here are computed, not
 * assigned, so the sets the pool is asked to hold are the sets that shape makes.
 *
 * Regions of one module do not all share its crossers, or the answer would be
 * free: a branch is taken by some of the tests that reached the function around
 * it. The divergence modelled here is a cohort — a platform flag, a feature
 * gate — because that is what a branch usually splits on, and because a branch
 * that split differently for every test would make the region unanswerable by
 * any encoding rather than by this one.
 */

import {
  CrossingSets,
  blocksCrossedBy,
  openCrossingSets,
  openPackedCrossingSets,
  packCrossingSets,
} from '../dist/test-selection/crossing-sets.js';

const MODULES = Number(process.argv[2] ?? 200_000);
const TESTS = Number(process.argv[3] ?? 2_000);
const BLOCKS = Number(process.argv[4] ?? 8);
/**
 * Which question this run answers. One per process on purpose: resident size is
 * what is being measured, and it does not fall back when a previous arm lets go.
 *
 *   graph   the shape a repository has, closures computed from a barrel graph
 *   worst   every region with its own set, the bound the index cannot exceed
 *   shards  that bound cut along the test axis, which is how it is stored
 */
const MODE = process.argv[5] ?? 'graph';

/** What the whole operation may cost. Stated here so a regression is a failure. */
const CEILING = 600 * 1_048_576;

const BARRELS = 80;
const PER_BARREL = 2_000;
const UTILS = 500;
/** How many ways a branch can split its crossers. A flag, a platform, a gate. */
const COHORTS = 16;

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const count = (n) => n.toLocaleString();

/** xorshift32. A multiply-and-mask LCG loses its low bits in a double. */
const stream = (seed) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
};

let peak = 0;
const watch = () => {
  const { rss } = process.memoryUsage();
  if (rss > peak) peak = rss;
  return rss;
};

if (MODE === 'graph') {
  // The graph. Barrels at the bottom of the id space, then shared utilities, then
  // the leaves each barrel re-exports, then one support root per test file.
  const next = stream(20250915);
  const utilAt = BARRELS;
  const leafAt = BARRELS + UTILS;
  const rootAt = leafAt + BARRELS * PER_BARREL;
  if (rootAt + TESTS > MODULES) throw new Error('module count too small for this shape');

  const degree = new Uint32Array(MODULES);
  for (let barrel = 0; barrel < BARRELS; barrel += 1) degree[barrel] = PER_BARREL;
  for (let leaf = leafAt; leaf < rootAt; leaf += 1) degree[leaf] = 2;
  const rootDegree = new Uint32Array(TESTS);
  const rootFirst = new Uint32Array(TESTS);
  for (let test = 0; test < TESTS; test += 1) {
    rootDegree[test] = 1 + Math.floor(next() * 40);
    rootFirst[test] = Math.floor(next() * BARRELS);
    degree[rootAt + test] = rootDegree[test];
  }

  const head = new Uint32Array(MODULES + 1);
  for (let module = 0; module < MODULES; module += 1) head[module + 1] = head[module] + degree[module];
  const edges = new Uint32Array(head[MODULES]);
  const leafStream = stream(77);
  for (let barrel = 0; barrel < BARRELS; barrel += 1) {
    for (let step = 0; step < PER_BARREL; step += 1) {
      edges[head[barrel] + step] = leafAt + barrel * PER_BARREL + step;
    }
  }
  for (let leaf = leafAt; leaf < rootAt; leaf += 1) {
    edges[head[leaf]] = utilAt + Math.floor(leafStream() * UTILS);
    edges[head[leaf] + 1] = utilAt + Math.floor(leafStream() * UTILS);
  }
  for (let test = 0; test < TESTS; test += 1) {
    for (let step = 0; step < rootDegree[test]; step += 1) {
      edges[head[rootAt + test] + step] = (rootFirst[test] + step) % BARRELS;
    }
  }

  console.log(
    `graph: ${count(MODULES)} modules, ${count(edges.length)} edges, stored as CSR ${mb((MODULES + 1) * 4 + edges.length * 4)}`,
  );

  // Transpose while walking: a test's closure is written into the column for the
  // module, not kept as a list for the test. This is the whole trick — the pairs
  // exist for the width of one BFS and are never all live at once.
  const words = (TESTS + 31) >>> 5;
  const reach = new Uint32Array(MODULES * words);
  const mark = new Uint32Array(MODULES);
  const frontier = new Uint32Array(MODULES);
  let stamp = 0;
  let pairs = 0;

  const walking = Date.now();
  for (let test = 0; test < TESTS; test += 1) {
    stamp += 1;
    const word = test >>> 5;
    const bit = 1 << (test & 31);
    let wrote = 0;
    let read = 0;
    const root = rootAt + test;
    frontier[wrote++] = root;
    mark[root] = stamp;
    while (read < wrote) {
      const at = frontier[read++];
      reach[at * words + word] |= bit;
      pairs += 1;
      for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
        const to = edges[edge];
        if (mark[to] !== stamp) {
          mark[to] = stamp;
          frontier[wrote++] = to;
        }
      }
    }
  }
  const walked = Date.now() - walking;
  watch();
  console.log(
    `closures: ${count(TESTS)} walked in ${(walked / 1000).toFixed(1)}s, ` +
      `${count(pairs)} module-test pairs (${count(Math.round(pairs / TESTS))} modules per test)`,
  );
  console.log(
    `  as regions: ${count(pairs * BLOCKS)} crossings, ` +
      `${mb(pairs * BLOCKS * 4)} as bare u32 pairs, ${mb(pairs * BLOCKS * 8)} as pointers`,
  );

  // The pool. One set per region, interned; the region keeps a number.
  const cohort = new Uint32Array(COHORTS * words);
  const cohortStream = stream(31337);
  for (let at = 0; at < cohort.length; at += 1) cohort[at] = (cohortStream() * 4294967296) >>> 0;

  const sets = new CrossingSets(TESTS);
  const setId = new Uint32Array(MODULES * BLOCKS);
  const scratch = new Uint32Array(TESTS);

  const interning = Date.now();
  for (let module = 0; module < MODULES; module += 1) {
    const base = module * words;
    for (let block = 0; block < BLOCKS; block += 1) {
      // Region zero is the module itself: whoever reached it. A region below that
      // is a branch, and a branch keeps the crossers one cohort mask admits.
      const mask = block === 0 ? -1 : ((module * 2654435761 + block) >>> 0) % COHORTS;
      let held = 0;
      for (let word = 0; word < words; word += 1) {
        let bits = reach[base + word];
        if (mask >= 0) bits &= cohort[mask * words + word];
        while (bits !== 0) {
          const low = 31 - Math.clz32(bits & -bits);
          scratch[held++] = (word << 5) + low;
          bits &= bits - 1;
        }
      }
      setId[module * BLOCKS + block] = sets.intern(scratch.subarray(0, held));
    }
    if ((module & 0x3fff) === 0) watch();
  }
  const interned = Date.now() - interning;
  watch();

  const pool = sets.pool();
  const packed = packCrossingSets(pool);
  watch();

  console.log(
    `pool: ${count(sets.size)} distinct sets for ${count(MODULES * BLOCKS)} regions ` +
      `in ${(interned / 1000).toFixed(1)}s`,
  );
  console.log(
    `  live: ids ${mb(setId.byteLength)} + sets ${mb(pool.bytes.byteLength)} + offsets ${mb(pool.offsets.byteLength)}`,
  );
  console.log(`  stored: sets ${mb(packed.sets.length)} + offsets ${mb(packed.offsets.length)}`);

  // The stored form has to answer, or the size is meaningless.
  const stored = openCrossingSets(
    openPackedCrossingSets(packed.sets, packed.offsets, sets.size, TESTS),
  );
  const checking = Date.now();
  const check = stream(4242);
  let disagreements = 0;
  for (let sample = 0; sample < 20_000; sample += 1) {
    const module = Math.floor(check() * MODULES);
    const block = Math.floor(check() * BLOCKS);
    const test = Math.floor(check() * TESTS);
    const mask = block === 0 ? -1 : ((module * 2654435761 + block) >>> 0) % COHORTS;
    let expected = (reach[module * words + (test >>> 5)] & (1 << (test & 31))) !== 0;
    if (expected && mask >= 0) {
      expected = (cohort[mask * words + (test >>> 5)] & (1 << (test & 31))) !== 0;
    }
    if (stored.has(setId[module * BLOCKS + block], test) !== expected) disagreements += 1;
  }
  console.log(
    `  stored answers: ${disagreements === 0 ? 'agree on all 20,000 probes' : `${count(disagreements)} DISAGREEMENTS`} ` +
      `in ${Date.now() - checking} ms`,
  );

  const reversing = Date.now();
  const crossed = blocksCrossedBy(setId, stored, Math.floor(TESTS / 2));
  console.log(
    `  reverse: one test names ${count(crossed.length)} regions in ${Date.now() - reversing} ms`,
  );

  watch();
  console.log(
    `\npeak rss ${mb(peak)} against a ${mb(CEILING)} ceiling — ${peak <= CEILING ? 'fits' : 'OVER'}`,
  );
  console.log(
    `  the staging column is ${mb(reach.byteLength)} of that, and is the part that shards: ` +
      `half the tests is half the column, and the pools merge.`,
  );
}

// The number that decides whether this needs sharding is not the shape above —
// it is the shape where the trick does not work at all. Pass `worst` and every
// region gets its own set, drawn so no two are equal: the pool degenerates into
// one bitmap per region, which is the most the index can ever cost at this test
// count, and the only honest ceiling to quote.
if (MODE === 'worst') {
  const words = (TESTS + 31) >>> 5;
  const alone = new CrossingSets(TESTS);
  const bits = new Uint32Array(words);
  const unique = stream(8675309);
  const worst = Date.now();
  const members = new Uint32Array(TESTS);
  for (let region = 0; region < MODULES * BLOCKS; region += 1) {
    let held = 0;
    for (let word = 0; word < words; word += 1) {
      // A fifth of the suite, scattered, which is the density measured above.
      bits[word] =
        ((unique() * 4294967296) >>> 0) &
        ((unique() * 4294967296) >>> 0) &
        (((unique() * 4294967296) >>> 0) | ((unique() * 4294967296) >>> 0));
      let word_ = bits[word];
      while (word_ !== 0) {
        members[held++] = (word << 5) + (31 - Math.clz32(word_ & -word_));
        word_ &= word_ - 1;
      }
    }
    alone.intern(members.subarray(0, held));
    if ((region & 0xffff) === 0) watch();
  }
  watch();
  console.log(
    `\nno sharing at all: ${count(alone.size)} sets for ${count(MODULES * BLOCKS)} regions, ` +
      `${mb(alone.byteLength)} of containers in ${((Date.now() - worst) / 1000).toFixed(1)}s`,
  );
  console.log(
    `  peak rss ${mb(peak)} against a ${mb(CEILING)} ceiling — ${peak <= CEILING ? 'fits' : 'OVER, and shards: ' + Math.ceil(peak / CEILING) + ' chunks'}`,
  );
}

/**
 * The same impossible case, cut into chunks along the test axis.
 *
 * This is the answer to the ceiling rather than an apology for it. A set is a
 * subset of the suite, so cutting the suite in two cuts every set in two, and
 * the halves are independent: a question about test `t` goes to the chunk whose
 * range holds it and reads only that chunk's pool. Nothing is joined and nothing
 * is re-derived — which is why the index can be stored as chunks rather than as
 * one file that has to be whole before it answers anything.
 */
if (MODE === 'shards') {
  const chunks = Number(process.argv[6] ?? 2);
  // One chunk per process when asked for by number, because resident size is
  // what is being measured and a process does not hand pages back when it lets
  // go of them. Chunks are separate operations in the index too, so measuring
  // them as one run would be measuring a thing nobody does.
  const only = process.argv[7] === undefined ? undefined : Number(process.argv[7]);
  const per = Math.ceil(TESTS / chunks);
  let widest = 0;
  let bytes = 0;
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    if (only !== undefined && chunk !== only) continue;
    const held = Math.min(per, TESTS - chunk * per);
    const chunkWords = (held + 31) >>> 5;
    const alone = new CrossingSets(held);
    const members = new Uint32Array(held);
    const unique = stream(8675309 + chunk);
    const ids = new Uint32Array(MODULES * BLOCKS);
    let mine = 0;
    for (let region = 0; region < MODULES * BLOCKS; region += 1) {
      let count_ = 0;
      for (let word = 0; word < chunkWords; word += 1) {
        let bits =
          ((unique() * 4294967296) >>> 0) &
          ((unique() * 4294967296) >>> 0) &
          (((unique() * 4294967296) >>> 0) | ((unique() * 4294967296) >>> 0));
        while (bits !== 0) {
          members[count_++] = (word << 5) + (31 - Math.clz32(bits & -bits));
          bits &= bits - 1;
        }
      }
      ids[region] = alone.intern(members.subarray(0, count_));
    }
    mine = process.memoryUsage().rss;
    if (mine > widest) widest = mine;
    bytes += alone.byteLength + ids.byteLength;
    console.log(
      `  chunk ${chunk + 1} of ${chunks}: tests ${count(chunk * per)}-${count(chunk * per + held - 1)}, ` +
        `${count(alone.size)} sets, ${mb(alone.byteLength)} of containers, rss ${mb(mine)}`,
    );
  }
  console.log(
    `\nsharded: ${mb(bytes)} ${only === undefined ? `across ${chunks} chunks` : `in chunk ${only + 1} of ${chunks}`}, ` +
      `held ${mb(widest)} — ${widest <= CEILING ? 'fits' : 'still OVER'}`,
  );
}
