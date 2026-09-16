/**
 * What a *journey* costs at a repository's scale, if the thing stored is the
 * call edge rather than the region.
 *
 * `snapshot-scale.mjs` measures the artifact that ships: one interned set of
 * test files per region, which answers "this region changed, which tests" and
 * nothing about how a test got there. This measures the store that also holds
 * the path — a record per
 *
 *     who:         function F, and the set of branches F executed
 *     called from: the parent's variant
 *     called for:  the tests
 *
 * so that a change is answered the same way, and a journey is recoverable by
 * walking parents left and children right.
 *
 *   node scripts/variance-store.mjs shape    [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs flat     [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs chain    [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs spine    [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs residual [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs query    [modules] [tests] [funcs]
 *
 * One mode per process: resident size is what is being measured and it does not
 * fall back when a previous arm lets go.
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { CrossingSets } from '../dist/test-selection/crossing-sets.js';

const MODE = process.argv[2] ?? 'shape';
const MODULES = Number(process.argv[3] ?? 200_000);
const TESTS = Number(process.argv[4] ?? 2_000);
const FUNCS = Number(process.argv[5] ?? 5);

/** What one operation may cost. Stated here so a regression is a failure. */
const CEILING = 600 * 1_048_576;

const BARRELS = 80;
const UTILS = 500;
const PER_BARREL = Math.floor((MODULES - BARRELS - UTILS - TESTS) / BARRELS);
/**
 * How many ways a run's test files divide.
 *
 * A variant is picked per cohort rather than per test because that is the claim
 * being measured: a platform helper entered from a hook follows a hardcoded
 * path, so its branch set does not vary with the test that reached it. Sixteen
 * cohorts is the pessimistic reading of "does not vary" — a function allowed
 * sixty-four variants gets every one of them somewhere in the run.
 */
const COHORTS = Number(process.env.COHORTS ?? 16);

const WORDS = (TESTS + 31) >>> 5;
const FUNCTIONS = MODULES * FUNCS;

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const count = (n) => n.toLocaleString();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const pad = (value, width) => String(value).padStart(width, '0');

let peak = 0;
const watch = () => {
  const { rss } = process.memoryUsage();
  if (rss > peak) peak = rss;
  return rss;
};
const verdict = () => {
  watch();
  console.log(
    `\npeak rss ${mb(peak)} against a ${mb(CEILING)} ceiling — ${peak <= CEILING ? 'fits' : 'OVER'}`,
  );
};

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

/** One round of a 32-bit mixer, which is all the fixture's choices need. */
const mix = (value) => {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};

/**
 * How many branch sets a function was seen to execute across the whole run.
 *
 * Seven functions in ten have one: they are the hardcoded paths, and the reason
 * the store is worth measuring at all. One in a hundred has up to sixty-four,
 * which is the dispatcher every repository has a few of.
 */
const variantCount = (fn) => {
  const h = mix(fn ^ 0x51ed2701);
  const roll = (h >>> 8) / 16777216;
  if (roll < 0.7) return 1;
  if (roll < 0.9) return 2;
  if (roll < 0.99) return 2 + (h % 7);
  return 8 + (h % 57);
};

const variantAt = (fn, cohort) => mix(fn ^ Math.imul(cohort + 1, 0x9e3779b1)) % variantCount(fn);

/** The import graph, laid out exactly as `snapshot-scale.mjs` lays it out. */
/**
 * Which util a leaf module imports.
 *
 * Uniform by default, which is the adversarial choice: a uniformly random
 * target has no numbering that shortens its gap, so the adjacency column
 * cannot be compressed by any ordering. A real repository is not uniform — a
 * handful of platform helpers are imported by nearly everything — so ZIPF
 * turns the popularity skew on and lets the two be compared.
 */
const ZIPF = Number(process.env.ZIPF ?? 0);
const popular = (unit) => (ZIPF === 0 ? Math.floor(unit * UTILS) : Math.min(UTILS - 1, Math.floor(UTILS * Math.pow(unit, ZIPF))));

function importGraph() {
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
    edges[head[leaf]] = utilAt + popular(leafStream());
    edges[head[leaf] + 1] = utilAt + popular(leafStream());
  }
  for (let test = 0; test < TESTS; test += 1) {
    for (let step = 0; step < rootDegree[test]; step += 1) {
      edges[head[rootAt + test] + step] = (rootFirst[test] + step) % BARRELS;
    }
  }
  return { head, edges, rootAt };
}

/**
 * Which tests reached which module, as one dense bitmap.
 *
 * Two hundred thousand modules against two thousand tests is fifty megabytes,
 * which is small enough to hold whole — and holding it whole is what lets every
 * later question be a word-wise intersection rather than a traversal.
 */
function reachMatrix(graph) {
  const { head, edges, rootAt } = graph;
  const reach = new Uint32Array(MODULES * WORDS);
  const mark = new Uint32Array(MODULES);
  const frontier = new Uint32Array(MODULES);
  let stamp = 0;
  let pairs = 0;
  for (let test = 0; test < TESTS; test += 1) {
    stamp += 1;
    let wrote = 0;
    let read = 0;
    frontier[wrote++] = rootAt + test;
    mark[rootAt + test] = stamp;
    while (read < wrote) {
      const at = frontier[read++];
      for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
        const to = edges[edge];
        if (mark[to] !== stamp) {
          mark[to] = stamp;
          frontier[wrote++] = to;
        }
      }
    }
    const word = test >>> 5;
    const bit = 1 << (test & 31);
    for (let at = 0; at < wrote; at += 1) reach[frontier[at] * WORDS + word] |= bit;
    pairs += wrote;
  }
  return { reach, pairs };
}

/**
 * The reach class of every module, without ever holding the whole matrix.
 *
 * The dense bitmap is modules times tests, so at twenty thousand test files it
 * is five hundred megabytes and the ceiling decides the question. But no module
 * needs its whole row at once: two modules belong to the same class exactly
 * when they agree on every test, so agreeing on every slice of tests is the
 * same statement made one slice at a time. Each slice refines the partition the
 * slices before it left, which is the move that found the test classes, pointed
 * the other way.
 *
 * Memory is the slice, not the matrix, so it stays flat as the suite grows.
 */
function reachClasses(graph, budget) {
  const { head, edges, rootAt } = graph;
  const perTest = MODULES / 8;
  const slice = Math.max(32, Math.min(TESTS, (budget / perTest) | 0) & ~31);
  const sliceWords = (slice + 31) >>> 5;
  const rows = new Uint32Array(MODULES * sliceWords);
  const mark = new Uint32Array(MODULES);
  const frontier = new Uint32Array(MODULES);
  let stamp = 0;

  // One test's reachable set, written into the slice at its own bit.
  const walk = (test, into, word, bit) => {
    stamp += 1;
    let wrote = 0;
    let read = 0;
    frontier[wrote++] = rootAt + test;
    mark[rootAt + test] = stamp;
    while (read < wrote) {
      const at = frontier[read++];
      for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
        const to = edges[edge];
        if (mark[to] !== stamp) {
          mark[to] = stamp;
          frontier[wrote++] = to;
        }
      }
    }
    for (let at = 0; at < wrote; at += 1) into[frontier[at] * sliceWords + word] |= bit;
    return wrote;
  };

  let held = new Uint32Array(MODULES);
  let classCount = 1;
  let pairs = 0;
  let passes = 0;
  for (let from = 0; from < TESTS; from += slice) {
    const upto = Math.min(TESTS, from + slice);
    rows.fill(0);
    for (let test = from; test < upto; test += 1) {
      const local = test - from;
      pairs += walk(test, rows, local >>> 5, 1 << (local & 31));
    }
    passes += 1;

    // Refine: the class a module had, paired with the row it just showed.
    const buckets = new Map();
    const speaker = [];
    const next = new Uint32Array(MODULES);
    for (let module = 0; module < MODULES; module += 1) {
      let hash = Math.imul(held[module] ^ 0x9e3779b1, 2654435761) >>> 0;
      for (let word = 0; word < sliceWords; word += 1) {
        hash = (Math.imul(hash ^ rows[module * sliceWords + word], 16777619) >>> 0) >>> 0;
      }
      let found = -1;
      const bucket = buckets.get(hash);
      if (bucket !== undefined) {
        for (const id of bucket) {
          const other = speaker[id];
          if (held[other] !== held[module]) continue;
          let same = true;
          for (let word = 0; word < sliceWords && same; word += 1) {
            same = rows[other * sliceWords + word] === rows[module * sliceWords + word];
          }
          if (same) { found = id; break; }
        }
      }
      if (found === -1) {
        found = speaker.length;
        speaker.push(module);
        if (bucket === undefined) buckets.set(hash, [found]);
        else bucket.push(found);
      }
      next[module] = found;
    }
    held = next;
    classCount = speaker.length;
  }

  // The classes are settled, so their test sets can be written once, for the
  // survivors only — which is the one array that grows with the suite.
  const words = WORDS;
  const classRows = new Uint32Array(classCount * words);
  const spread = new Uint32Array(MODULES * 1);
  void spread;
  for (let test = 0; test < TESTS; test += 1) {
    stamp += 1;
    let wrote = 0;
    let read = 0;
    frontier[wrote++] = rootAt + test;
    mark[rootAt + test] = stamp;
    while (read < wrote) {
      const at = frontier[read++];
      for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
        const to = edges[edge];
        if (mark[to] !== stamp) {
          mark[to] = stamp;
          frontier[wrote++] = to;
        }
      }
    }
    const word = test >>> 5;
    const bit = 1 << (test & 31);
    for (let at = 0; at < wrote; at += 1) classRows[held[frontier[at]] * words + word] |= bit;
  }

  return { reachClass: held, classCount, classRows, pairs, passes, slice };
}

/**
 * The call graph at function granularity, over the import graph's modules.
 *
 * Each module's functions form a chain — the entry calls the next, and so on
 * down — and each import becomes two call sites in the importing module landing
 * on the imported module's entry. That is deliberately conservative: a real
 * repository's call graph is denser, and the count this arm reports is the
 * floor the store has to carry, not the ceiling.
 */
function callGraph(graph) {
  const { head, edges } = graph;
  const intra = MODULES * (FUNCS - 1);
  const inter = head[MODULES] * 2;
  const from = new Uint32Array(intra + inter);
  const to = new Uint32Array(intra + inter);
  let wrote = 0;
  for (let module = 0; module < MODULES; module += 1) {
    const base = module * FUNCS;
    for (let step = 0; step < FUNCS - 1; step += 1) {
      from[wrote] = base + step;
      to[wrote] = base + step + 1;
      wrote += 1;
    }
    for (let edge = head[module]; edge < head[module + 1]; edge += 1) {
      const target = edges[edge] * FUNCS;
      for (let site = 0; site < 2; site += 1) {
        from[wrote] = base + (mix(edge ^ (site * 31)) % FUNCS);
        to[wrote] = target;
        wrote += 1;
      }
    }
  }
  return { from: from.subarray(0, wrote), to: to.subarray(0, wrote) };
}

/** `variantBase[fn]` through `variantBase[fn + 1]` are function `fn`'s variants. */
function variantIndex() {
  const base = new Uint32Array(FUNCTIONS + 1);
  for (let fn = 0; fn < FUNCTIONS; fn += 1) base[fn + 1] = base[fn] + variantCount(fn);
  return base;
}

/** The tests in each cohort, as a bitmap, so a variant's set is one AND. */
function cohortMasks() {
  const masks = new Uint32Array(COHORTS * WORDS);
  for (let test = 0; test < TESTS; test += 1) {
    masks[(test % COHORTS) * WORDS + (test >>> 5)] |= 1 << (test & 31);
  }
  return masks;
}

if (MODE === 'shape') {
  const started = Date.now();
  const graph = importGraph();
  const { reach, pairs } = reachMatrix(graph);
  console.log(
    `graph: ${count(MODULES)} modules, ${count(graph.head[MODULES])} imports, ` +
      `${count(pairs)} module-test pairs (${count(Math.round(pairs / TESTS))} per test) in ${secs(Date.now() - started)}`,
  );
  console.log(`reach: ${mb(reach.byteLength)} of bitmap, ${WORDS} words a module`);
  const calls = callGraph(graph);
  const base = variantIndex();
  console.log(
    `calls: ${count(FUNCTIONS)} functions, ${count(calls.from.length)} call edges, ` +
      `${count(base[FUNCTIONS])} variants (${(base[FUNCTIONS] / FUNCTIONS).toFixed(2)} a function)`,
  );
  // What the relation costs written out the way the idea states it: one record
  // per call edge per test that walked it. This is the number every encoding
  // below is trying not to be.
  let edgeTests = 0;
  const { from, to } = calls;
  for (let at = 0; at < from.length; at += 1) {
    const mp = (from[at] / FUNCS) | 0;
    const mc = (to[at] / FUNCS) | 0;
    let both = 0;
    for (let word = 0; word < WORDS; word += 1) {
      both += popcount(reach[mp * WORDS + word] & reach[mc * WORDS + word]);
    }
    edgeTests += both;
  }
  console.log(`raw: ${count(edgeTests)} (edge, test) records — ${mb(edgeTests * 12)} at twelve bytes each`);
  verdict();
}

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

if (MODE === 'store') {
  const started = Date.now();
  const graph = importGraph();
  const { reach } = reachMatrix(graph);
  const calls = callGraph(graph);
  const base = variantIndex();
  const masks = cohortMasks();
  console.log(
    `graph: ${count(MODULES)} modules, ${count(FUNCTIONS)} functions, ` +
      `${count(calls.from.length)} call edges, ${count(base[FUNCTIONS])} variants — ${secs(Date.now() - started)}, rss ${mb(watch())}`,
  );

  const pool = bitmapPool();
  const scratch = new Uint32Array(WORDS);
  const parentScratch = new Uint32Array(WORDS);
  const unions = new Uint32Array(COHORTS * WORDS);
  const keys = new Int32Array(COHORTS);
  const parentUnion = new Uint32Array(COHORTS * WORDS);
  const parentKeys = new Int32Array(COHORTS);

  // One record per (parent variant, child variant). The parent and child are
  // written as global variant ids, which is what a walk left or right follows.
  let records = 0;
  let free = 0;
  const setIds = [];
  const folding = Date.now();
  const { from, to } = calls;
  for (let at = 0; at < from.length; at += 1) {
    const parent = from[at];
    const child = to[at];
    const mp = (parent / FUNCS) | 0;
    const mc = (child / FUNCS) | 0;
    // Group the cohorts by which (parent variant, child variant) pair they took.
    let pairs = 0;
    let parents = 0;
    for (let cohort = 0; cohort < COHORTS; cohort += 1) {
      const pi = variantAt(parent, cohort);
      const ci = variantAt(child, cohort);
      const key = pi * 65536 + ci;
      let slot = -1;
      for (let seen = 0; seen < pairs; seen += 1) if (keys[seen] === key) slot = seen;
      if (slot < 0) {
        slot = pairs;
        keys[pairs] = key;
        pairs += 1;
        for (let word = 0; word < WORDS; word += 1) unions[slot * WORDS + word] = 0;
      }
      for (let word = 0; word < WORDS; word += 1) {
        unions[slot * WORDS + word] |= masks[cohort * WORDS + word];
      }
      let own = -1;
      for (let seen = 0; seen < parents; seen += 1) if (parentKeys[seen] === pi) own = seen;
      if (own < 0) {
        own = parents;
        parentKeys[parents] = pi;
        parents += 1;
        for (let word = 0; word < WORDS; word += 1) parentUnion[own * WORDS + word] = 0;
      }
      for (let word = 0; word < WORDS; word += 1) {
        parentUnion[own * WORDS + word] |= masks[cohort * WORDS + word];
      }
    }
    for (let pair = 0; pair < pairs; pair += 1) {
      const pi = (keys[pair] / 65536) | 0;
      let own = 0;
      for (let seen = 0; seen < parents; seen += 1) if (parentKeys[seen] === pi) own = seen;
      let same = true;
      for (let word = 0; word < WORDS; word += 1) {
        const both = reach[mp * WORDS + word] & reach[mc * WORDS + word];
        const edge = both & unions[pair * WORDS + word];
        const owner = reach[mp * WORDS + word] & parentUnion[own * WORDS + word];
        scratch[word] = edge;
        parentScratch[word] = owner;
        if (edge !== owner) same = false;
      }
      records += 1;
      // The chain the idea describes: the child's variant is determined by the
      // parent's, so the edge's tests are the parent's tests and the record
      // carries no set of its own. Walking left is how they are recovered.
      if (same) free += 1;
      else setIds.push(pool.idOf(scratch, 0));
    }
  }
  console.log(
    `fold: ${count(records)} (parent variant, child variant) records in ${secs(Date.now() - folding)}, rss ${mb(watch())}`,
  );
  console.log(
    `chains: ${count(free)} records carry the parent's tests (${((free / records) * 100).toFixed(1)}%), ` +
      `${count(records - free)} carry a set of their own`,
  );
  const held = containerBytes(pool);
  console.log(
    `pool: ${count(pool.size)} distinct edge bitmaps, ${count(held.distinct)} after the shipped containers, ${mb(held.bytes)}`,
  );
  const flat = records * 12;
  const chained = records * 8 + (records - free) * 4;
  console.log(`\nflat:  ${count(records)} x (parent, child, set) = ${mb(flat)} + ${mb(held.bytes)} of pool`);
  console.log(`chain: ${count(records)} x (parent, child) + ${count(records - free)} x set = ${mb(chained)} + ${mb(held.bytes)} of pool`);
  verdict();
}

/**
 * The same store, with the set factorized instead of materialized.
 *
 * `store` above interns the whole test-set of every edge and pays six hundred
 * thousand distinct bitmaps for it. But that set is not one fact, it is two
 * multiplied together:
 *
 *     the tests that loaded the module   x   the tests that took the branches
 *
 * The first has as many distinct values as the import graph has reach classes —
 * measured, about two thousand over two hundred thousand modules, because every
 * leaf under a barrel is reached by exactly the tests that reached the barrel.
 * The second has as many as there are distinct branch conditions. Interning the
 * product costs their product; interning the factors costs their sum, and the
 * intersection is one word-wise AND at the moment a query needs it.
 *
 * This is the same move a factorized query result makes over a materialized
 * join, and the same one a colored de Bruijn graph makes when it stores color
 * classes once rather than per k-mer.
 */
if (MODE === 'factor') {
  const started = Date.now();
  const graph = importGraph();
  const { reach } = reachMatrix(graph);
  const calls = callGraph(graph);
  const base = variantIndex();
  const masks = cohortMasks();
  console.log(
    `graph: ${count(MODULES)} modules, ${count(FUNCTIONS)} functions, ` +
      `${count(calls.from.length)} call edges, ${count(base[FUNCTIONS])} variants — ${secs(Date.now() - started)}, rss ${mb(watch())}`,
  );

  // Factor one: which tests loaded the module. One id per module.
  const reachPool = bitmapPool();
  const reachClass = new Uint32Array(MODULES);
  for (let module = 0; module < MODULES; module += 1) {
    reachClass[module] = reachPool.idOf(reach, module * WORDS);
  }
  const reachHeld = containerBytes(reachPool);
  console.log(
    `reach classes: ${count(reachPool.size)} distinct over ${count(MODULES)} modules, ` +
      `${mb(reachHeld.bytes)} of containers, ${mb(MODULES * 4)} of ids`,
  );

  // Factor two: which tests took the branches. One id per variant, and because
  // the condition is a cohort subset it is sixteen bits before it is a set.
  const conditions = new Map();
  const variantCondition = new Uint32Array(base[FUNCTIONS]);
  const variantModule = new Uint32Array(base[FUNCTIONS]);
  for (let fn = 0; fn < FUNCTIONS; fn += 1) {
    const span = base[fn + 1] - base[fn];
    const module = (fn / FUNCS) | 0;
    for (let index = 0; index < span; index += 1) {
      let pattern = 0;
      for (let cohort = 0; cohort < COHORTS; cohort += 1) {
        if (variantAt(fn, cohort) === index) pattern |= 1 << cohort;
      }
      let id = conditions.get(pattern);
      if (id === undefined) conditions.set(pattern, (id = conditions.size));
      variantCondition[base[fn] + index] = id;
      variantModule[base[fn] + index] = module;
    }
  }
  const conditionWords = new Uint32Array(conditions.size * WORDS);
  for (const [pattern, id] of conditions) {
    for (let cohort = 0; cohort < COHORTS; cohort += 1) {
      if ((pattern & (1 << cohort)) === 0) continue;
      for (let word = 0; word < WORDS; word += 1) {
        conditionWords[id * WORDS + word] |= masks[cohort * WORDS + word];
      }
    }
  }
  const conditionPool = { size: conditions.size, words: () => conditionWords };
  const conditionHeld = containerBytes(conditionPool);
  console.log(
    `branch conditions: ${count(conditions.size)} distinct over ${count(base[FUNCTIONS])} variants, ` +
      `${mb(conditionHeld.bytes)} of containers, ${mb(base[FUNCTIONS] * 4)} of ids`,
  );

  // The structure. Variant-level edges are not stored: a call edge plus the two
  // functions' variant tables says which variants met, for every cohort.
  const structure = (FUNCTIONS + 1) * 4 + calls.from.length * 4;
  const payload = MODULES * 4 + base[FUNCTIONS] * 4;
  console.log(
    `\nfactored: ${mb(structure)} of call graph + ${mb(payload)} of factor ids + ` +
      `${mb(reachHeld.bytes + conditionHeld.bytes)} of pools = ${mb(structure + payload + reachHeld.bytes + conditionHeld.bytes)}`,
  );
  verdict();
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

if (MODE === 'query') {
  const graph = importGraph();
  const { reach } = reachMatrix(graph);
  const calls = callGraph(graph);
  const base = variantIndex();
  const masks = cohortMasks();
  const reverse = reverseCalls(calls);
  console.log(`store built — rss ${mb(watch())}`);

  // (a) A function changed. Which test files must run again?
  const answer = new Uint32Array(TESTS);
  const asked = 1_000;
  const pick = stream(4242);
  let members = 0;
  let began = Date.now();
  for (let round = 0; round < asked; round += 1) {
    const fn = Math.floor(pick() * FUNCTIONS);
    const module = (fn / FUNCS) | 0;
    const span = base[fn + 1] - base[fn];
    // Every variant of the function, because a change to its text can move any
    // of its branches. A change to one region would take that region's variants.
    let wrote = 0;
    for (let word = 0; word < WORDS; word += 1) {
      let condition = 0;
      for (let index = 0; index < span; index += 1) {
        for (let cohort = 0; cohort < COHORTS; cohort += 1) {
          if (variantAt(fn, cohort) === index) condition |= masks[cohort * WORDS + word];
        }
      }
      let bits = reach[module * WORDS + word] & condition;
      while (bits !== 0) {
        const bit = bits & -bits;
        answer[wrote++] = (word << 5) + 31 - Math.clz32(bit);
        bits ^= bit;
      }
    }
    members += wrote;
  }
  console.log(
    `changed function -> tests: ${count(asked)} questions in ${secs(Date.now() - began)} ` +
      `(${((Date.now() - began) / asked).toFixed(3)} ms each), ${count(Math.round(members / asked))} tests an answer`,
  );

  // (b) Travel left: for one test, the chain of callers that reached a function.
  const seen = new Uint32Array(FUNCTIONS);
  const depth = new Uint32Array(FUNCTIONS);
  const queue = new Uint32Array(FUNCTIONS);
  let stamp = 0;
  const journeys = 200;
  let hops = 0;
  let visited = 0;
  let roots = 0;
  began = Date.now();
  for (let round = 0; round < journeys; round += 1) {
    const test = Math.floor(pick() * TESTS);
    const word = test >>> 5;
    const bit = 1 << (test & 31);
    let fn = Math.floor(pick() * FUNCTIONS);
    // A function this test actually reached, or the journey is empty by design.
    let guard = 0;
    while ((reach[((fn / FUNCS) | 0) * WORDS + word] & bit) === 0 && guard < 64) {
      fn = Math.floor(pick() * FUNCTIONS);
      guard += 1;
    }
    if ((reach[((fn / FUNCS) | 0) * WORDS + word] & bit) === 0) continue;
    stamp += 1;
    let wrote = 0;
    let read = 0;
    queue[wrote++] = fn;
    seen[fn] = stamp;
    depth[fn] = 0;
    let deepest = 0;
    let found = 0;
    while (read < wrote) {
      const at = queue[read++];
      let callers = 0;
      for (let edge = reverse.head[at]; edge < reverse.head[at + 1]; edge += 1) {
        const caller = reverse.into[edge];
        // Only what this test walked: the caller's module has to be one the
        // test loaded, which is the factor already in hand.
        if ((reach[((caller / FUNCS) | 0) * WORDS + word] & bit) === 0) continue;
        callers += 1;
        if (seen[caller] === stamp) continue;
        seen[caller] = stamp;
        depth[caller] = depth[at] + 1;
        if (depth[caller] > deepest) deepest = depth[caller];
        queue[wrote++] = caller;
      }
      if (callers === 0) found += 1;
    }
    hops += deepest;
    visited += wrote;
    roots += found;
  }
  console.log(
    `travel left: ${count(journeys)} journeys in ${secs(Date.now() - began)} ` +
      `(${((Date.now() - began) / journeys).toFixed(2)} ms each), ` +
      `${count(Math.round(visited / journeys))} callers a journey, ${(hops / journeys).toFixed(1)} hops deep, ` +
      `${(roots / journeys).toFixed(1)} entry points`,
  );
  verdict();
}

/**
 * How the store sizes against the one thing nobody can know in advance: how
 * much of a repository's branching is decided by the test's data, and how much
 * by the call site.
 *
 * A branch decided by the call site costs nothing to store. Its variant is
 * determined by the parent's, so the tests that took it are the tests that
 * reached the parent — travel left and they are recovered. That is the claim
 * about a platform hook following a hardcoded path, and it is the cheap end.
 *
 * A branch decided by the test's own data has to be written down: nothing about
 * the graph implies which tests took it. That is the expensive end, and the
 * `factor` arm above measures the store when *every* branch is of that kind.
 */
if (MODE === 'sweep') {
  const graph = importGraph();
  const { reach } = reachMatrix(graph);
  const calls = callGraph(graph);
  const base = variantIndex();
  const masks = cohortMasks();

  const reachPool = bitmapPool();
  for (let module = 0; module < MODULES; module += 1) reachPool.idOf(reach, module * WORDS);
  const reachBytes = containerBytes(reachPool).bytes;
  const structure = (FUNCTIONS + 1) * 4 + calls.from.length * 4;
  console.log(
    `${count(MODULES)} modules, ${count(FUNCTIONS)} functions, ${count(calls.from.length)} call edges, ` +
      `${count(base[FUNCTIONS])} variants`,
  );
  console.log(
    `call graph ${mb(structure)}, ${count(reachPool.size)} reach classes in ${mb(reachBytes)}, ` +
      `module ids ${mb(MODULES * 4)}\n`,
  );

  for (const driven of [1, 0.5, 0.25, 0.1, 0.02, 0]) {
    const conditions = new Map();
    let conditional = 0;
    for (let fn = 0; fn < FUNCTIONS; fn += 1) {
      const span = base[fn + 1] - base[fn];
      if (span === 1) continue;
      if ((mix(fn ^ 0x0dd0dd) >>> 8) / 16777216 >= driven) continue;
      for (let index = 0; index < span; index += 1) {
        let pattern = 0;
        for (let cohort = 0; cohort < COHORTS; cohort += 1) {
          if (variantAt(fn, cohort) === index) pattern |= 1 << cohort;
        }
        if (!conditions.has(pattern)) conditions.set(pattern, conditions.size);
        conditional += 1;
      }
    }
    const words = new Uint32Array(conditions.size * WORDS);
    for (const [pattern, id] of conditions) {
      for (let cohort = 0; cohort < COHORTS; cohort += 1) {
        if ((pattern & (1 << cohort)) === 0) continue;
        for (let word = 0; word < WORDS; word += 1) words[id * WORDS + word] |= masks[cohort * WORDS + word];
      }
    }
    const held = containerBytes({ size: conditions.size, words: () => words });
    // A variant either names a condition or inherits its parent's tests, so the
    // column is one id per variant and one bit to say which it is.
    const ids = base[FUNCTIONS] * 4;
    const total = structure + MODULES * 4 + ids + reachBytes + held.bytes;
    console.log(
      `${(driven * 100).toFixed(0).padStart(3)}% data-driven: ${count(conditional).padStart(9)} variants carry a condition, ` +
        `${count(conditions.size).padStart(6)} distinct in ${mb(held.bytes).padStart(8)} — store ${mb(total)}`,
    );
  }
  verdict();
}

/**
 * The same two questions asked of the worst function in the repository.
 *
 * `query` picks uniformly, which picks a leaf, because leaves are what a
 * repository is mostly made of. This picks the platform helper every test file
 * reaches — the one whose reverse fan-in is the whole graph — because that is
 * the function whose change is expensive to answer for, and the answer has to
 * stay inside the budget for it too.
 */
if (MODE === 'worst') {
  const graph = importGraph();
  const { reach } = reachMatrix(graph);
  const calls = callGraph(graph);
  const base = variantIndex();
  const masks = cohortMasks();
  const reverse = reverseCalls(calls);
  console.log(`store built — rss ${mb(watch())}`);

  // The functions with the most callers, which is where a platform helper sits.
  const fanIn = new Uint32Array(FUNCTIONS);
  for (let fn = 0; fn < FUNCTIONS; fn += 1) fanIn[fn] = reverse.head[fn + 1] - reverse.head[fn];
  let worst = 0;
  for (let fn = 1; fn < FUNCTIONS; fn += 1) if (fanIn[fn] > fanIn[worst]) worst = fn;
  const module = (worst / FUNCS) | 0;
  let reachedBy = 0;
  for (let word = 0; word < WORDS; word += 1) reachedBy += popcount(reach[module * WORDS + word]);
  console.log(
    `worst function: ${count(worst)} in module ${count(module)}, ` +
      `${count(fanIn[worst])} direct callers, reached by ${count(reachedBy)} of ${count(TESTS)} tests`,
  );

  const answer = new Uint32Array(TESTS);
  let began = Date.now();
  const span = base[worst + 1] - base[worst];
  let wrote = 0;
  for (let round = 0; round < 100; round += 1) {
    wrote = 0;
    for (let word = 0; word < WORDS; word += 1) {
      let condition = 0;
      for (let index = 0; index < span; index += 1) {
        for (let cohort = 0; cohort < COHORTS; cohort += 1) {
          if (variantAt(worst, cohort) === index) condition |= masks[cohort * WORDS + word];
        }
      }
      let bits = reach[module * WORDS + word] & condition;
      while (bits !== 0) {
        const bit = bits & -bits;
        answer[wrote++] = (word << 5) + 31 - Math.clz32(bit);
        bits ^= bit;
      }
    }
  }
  console.log(
    `changed -> tests: ${count(wrote)} tests in ${((Date.now() - began) / 100).toFixed(3)} ms, rss ${mb(watch())}`,
  );

  const seen = new Uint32Array(FUNCTIONS);
  const depth = new Uint32Array(FUNCTIONS);
  const queue = new Uint32Array(FUNCTIONS);
  const pick = stream(99);
  let stamp = 0;
  let totalVisited = 0;
  let totalHops = 0;
  const journeys = 20;
  began = Date.now();
  for (let round = 0; round < journeys; round += 1) {
    let test = Math.floor(pick() * TESTS);
    let guard = 0;
    while ((reach[module * WORDS + (test >>> 5)] & (1 << (test & 31))) === 0 && guard < 256) {
      test = Math.floor(pick() * TESTS);
      guard += 1;
    }
    const word = test >>> 5;
    const bit = 1 << (test & 31);
    stamp += 1;
    let put = 0;
    let read = 0;
    queue[put++] = worst;
    seen[worst] = stamp;
    depth[worst] = 0;
    let deepest = 0;
    while (read < put) {
      const at = queue[read++];
      for (let edge = reverse.head[at]; edge < reverse.head[at + 1]; edge += 1) {
        const caller = reverse.into[edge];
        if ((reach[((caller / FUNCS) | 0) * WORDS + word] & bit) === 0) continue;
        if (seen[caller] === stamp) continue;
        seen[caller] = stamp;
        depth[caller] = depth[at] + 1;
        if (depth[caller] > deepest) deepest = depth[caller];
        queue[put++] = caller;
      }
    }
    totalVisited += put;
    totalHops += deepest;
  }
  console.log(
    `travel left: ${count(Math.round(totalVisited / journeys))} callers a journey, ` +
      `${(totalHops / journeys).toFixed(1)} hops deep, ${((Date.now() - began) / journeys).toFixed(1)} ms each`,
  );
  verdict();
}

/** How many bytes a varint takes, which is what a gap-coded adjacency costs. */
const varint = (value) => (value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : value < 268435456 ? 4 : 5);

/**
 * How deep a repository's call graph actually runs from a test file, and what
 * the store keeps if the recording is cut off at a depth.
 *
 * The goal says depth ten. This arm exists to say whether ten is a limit worth
 * imposing or a number the graph never reaches — and if it is a limit, what is
 * behind it.
 */
if (MODE === 'depth') {
  const graph = importGraph();
  const { reach: _reach } = reachMatrix(graph);
  const calls = callGraph(graph);
  const forward = forwardCalls(calls);
  const base = variantIndex();
  console.log(`store built — rss ${mb(watch())}`);

  // One multi-source walk from every test file's entry function at once: the
  // depth that comes out is the shortest path from *some* test, which is the
  // depth a recording cut-off would compare against.
  const depth = new Int32Array(FUNCTIONS).fill(-1);
  const queue = new Uint32Array(FUNCTIONS);
  let put = 0;
  for (let test = 0; test < TESTS; test += 1) {
    const entry = (graph.rootAt + test) * FUNCS;
    if (depth[entry] < 0) {
      depth[entry] = 0;
      queue[put++] = entry;
    }
  }
  let read = 0;
  while (read < put) {
    const at = queue[read++];
    for (let edge = forward.head[at]; edge < forward.head[at + 1]; edge += 1) {
      const to = forward.outof[edge];
      if (depth[to] >= 0) continue;
      depth[to] = depth[at] + 1;
      queue[put++] = to;
    }
  }
  const histogram = new Uint32Array(64);
  let deepest = 0;
  let unreached = 0;
  for (let fn = 0; fn < FUNCTIONS; fn += 1) {
    if (depth[fn] < 0) {
      unreached += 1;
      continue;
    }
    const at = Math.min(depth[fn], 63);
    histogram[at] += 1;
    if (depth[fn] > deepest) deepest = depth[fn];
  }
  console.log(`\nfunctions by hops from the nearest test file (deepest ${deepest}, ${count(unreached)} never entered):`);
  let running = 0;
  for (let hop = 0; hop <= Math.min(deepest, 24); hop += 1) {
    running += histogram[hop];
    const edges = (() => {
      let held = 0;
      for (let fn = 0; fn < FUNCTIONS; fn += 1) {
        if (depth[fn] < 0 || depth[fn] >= hop) continue;
        held += forward.head[fn + 1] - forward.head[fn];
      }
      return held;
    })();
    let variants = 0;
    for (let fn = 0; fn < FUNCTIONS; fn += 1) if (depth[fn] >= 0 && depth[fn] <= hop) variants += base[fn + 1] - base[fn];
    console.log(
      `  ${String(hop).padStart(2)}: ${count(histogram[hop]).padStart(9)} functions, ` +
        `${((running / (FUNCTIONS - unreached)) * 100).toFixed(1).padStart(5)}% of the graph within, ` +
        `${count(variants).padStart(9)} variants, ${count(edges).padStart(9)} edges kept`,
    );
  }
  verdict();
}

/**
 * What the call graph costs once its adjacency is gap-coded rather than stored
 * as four bytes a target.
 *
 * At thirty-six megabytes the store is already structure, not sets — eleven and
 * a half of the thirty-six is the edge list alone. This is the WebGraph move:
 * sort each function's callees, write the first as a gap from the caller and the
 * rest as gaps from each other, and let the varints be short because a call
 * mostly lands near its caller.
 */
if (MODE === 'succinct') {
  const graph = importGraph();
  const calls = callGraph(graph);
  const forward = forwardCalls(calls);
  const base = variantIndex();
  console.log(`store built — rss ${mb(watch())}`);

  let plain = 0;
  let gapped = 0;
  let sorted = 0;
  const scratch = new Uint32Array(4096);
  for (let fn = 0; fn < FUNCTIONS; fn += 1) {
    const from = forward.head[fn];
    const span = forward.head[fn + 1] - from;
    plain += span * 4;
    if (span === 0) continue;
    for (let at = 0; at < span; at += 1) scratch[at] = forward.outof[from + at];
    const held = scratch.subarray(0, span);
    held.sort();
    // The first target as a signed gap from the caller, the rest as gaps from
    // the one before: a call into the same module is a one-byte varint.
    const lead = held[0] - fn;
    gapped += varint(lead < 0 ? -lead * 2 + 1 : lead * 2);
    for (let at = 1; at < span; at += 1) gapped += varint(held[at] - held[at - 1]);
    sorted += span;
  }
  console.log(
    `\nadjacency: ${count(sorted)} targets — ${mb(plain)} as words, ${mb(gapped)} gap-coded ` +
      `(${(gapped / plain * 100).toFixed(1)}% of it, ${(gapped / sorted).toFixed(2)} bytes a target)`,
  );
  console.log(`heads: ${mb((FUNCTIONS + 1) * 4)} as words, ${mb(Math.ceil(FUNCTIONS / 8) + gapped / 64 * 4)} as a rank/select bitmap`);
  console.log(`variant table: ${mb((base[FUNCTIONS]) * 4)} of factor ids for ${count(base[FUNCTIONS])} variants`);
  verdict();
}

/**
 * The two things the literature says to do that this store was not doing.
 *
 * **A basis for the conditions.** A branch condition is written above as a
 * bitmap over every test file in the run, which is why the condition pool grows
 * with the suite: at twenty thousand test files it is a hundred and fifty-six
 * megabytes and the operation goes over. But no condition ever separates two
 * tests that every condition agrees on. Refining the test files against the
 * conditions themselves yields the coarsest partition the store can tell apart,
 * and a condition is then a bitmap over *classes*. The count of classes is a
 * property of how the suite branches, not of how many test files it has.
 *
 * **A numbering for the columns.** Blandford and Blelloch (DCC 2002) and
 * Silvestri (ECIR 2007) say that the cheap win on an inverted index is not a
 * better code, it is numbering the documents so that equal postings land
 * adjacent — Silvestri's finding being that sorting beats solving. Here the
 * documents are modules and functions, the numbering is ours to choose, and the
 * column to run-length encode is the factor id.
 */
if (MODE === 'classes') {
  const graph = importGraph();
  const classed = reachClasses(graph, 64 * 1_048_576);
  console.log(
    `reach classes: ${count(classed.classCount)} distinct over ${count(MODULES)} modules, ` +
      `refined in ${count(classed.passes)} passes of ${count(classed.slice)} test files ` +
      `(${mb((MODULES / 8) * classed.slice)} a slice, against ${mb((MODULES / 8) * TESTS)} whole)`,
  );
  const calls = callGraph(graph);
  const base = variantIndex();
  const masks = cohortMasks();
  console.log(`store built — rss ${mb(watch())}`);

  const reachClass = classed.reachClass;
  const reachBytes = containerBytes({ size: classed.classCount, words: () => classed.classRows }).bytes;

  const conditions = new Map();
  const variantCondition = new Uint32Array(base[FUNCTIONS]);
  for (let fn = 0; fn < FUNCTIONS; fn += 1) {
    const span = base[fn + 1] - base[fn];
    for (let index = 0; index < span; index += 1) {
      let pattern = 0;
      for (let cohort = 0; cohort < COHORTS; cohort += 1) {
        if (variantAt(fn, cohort) === index) pattern |= 1 << cohort;
      }
      let id = conditions.get(pattern);
      if (id === undefined) conditions.set(pattern, (id = conditions.size));
      variantCondition[base[fn] + index] = id;
    }
  }
  // Refine the test files against the conditions. Two tests stay in one class
  // for as long as no condition has told them apart.
  //
  // A condition's row over the test files is built where it is read and thrown
  // away again, because holding all of them is what the whole arm exists to
  // avoid: at twenty thousand test files the stack of rows is 164 MB, and the
  // containers measuring it another 156 MB, for a number that is only printed.
  // The comparison is arithmetic on the row's popcount instead.
  const began = Date.now();
  const signature = new Float64Array(TESTS).fill(1);
  const row = new Uint32Array(WORDS);
  let flatConditions = 0;
  for (const [pattern, id] of conditions) {
    row.fill(0);
    for (let cohort = 0; cohort < COHORTS; cohort += 1) {
      if ((pattern & (1 << cohort)) === 0) continue;
      for (let word = 0; word < WORDS; word += 1) row[word] |= masks[cohort * WORDS + word];
    }

    const salt = mix(id + 1) / 4294967296 + 1;
    let held = 0;
    let runs = 0;
    let previous = 0;
    for (let word = 0; word < WORDS; word += 1) {
      let bits = row[word];
      held += popcount(bits);
      while (bits !== 0) {
        const bit = bits & -bits;
        const test = (word << 5) + 31 - Math.clz32(bit);
        if (test !== previous) runs += 1;
        previous = test + 1;
        signature[test] = (signature[test] * 31 + salt) % 9007199254740881;
        bits ^= bit;
      }
    }

    // The three containers the pool would choose between, priced without one.
    flatConditions += Math.min(2 + held * 2, 2 + WORDS * 4, 2 + runs * 4);
  }
  const classOf = new Uint32Array(TESTS);
  const classes = new Map();
  for (let test = 0; test < TESTS; test += 1) {
    let id = classes.get(signature[test]);
    if (id === undefined) classes.set(signature[test], (id = classes.size));
    classOf[test] = id;
  }
  const classWords = (classes.size + 31) >>> 5;
  const overClasses = conditions.size * classWords * 4;
  console.log(
    `\nconditions: ${count(conditions.size)} distinct over ${count(TESTS)} test files — ` +
      `${mb(flatConditions)} as test bitmaps, ${mb(overClasses)} over ${count(classes.size)} classes ` +
      `(+ ${mb(TESTS * 2)} naming the class of each test), found in ${secs(Date.now() - began)}`,
  );

  // The id column is 62% of the store, so it is the column the codes are for.
  //
  // Three of them, each named by the paper it comes from. The run-length code
  // needs equal ids to land side by side; the frequency code needs only that
  // some ids are commoner than others, which is Silvestri's point that a cheap
  // sort captures most of what an expensive assignment would.
  const frequencyCode = (column, length, distinct) => {
    const seen = new Uint32Array(distinct);
    for (let at = 0; at < length; at += 1) seen[column[at]] += 1;

    // Descending frequency, so the commonest id is the shortest codeword.
    const order = new Uint32Array(distinct);
    for (let id = 0; id < distinct; id += 1) order[id] = id;
    order.sort((left, right) => seen[right] - seen[left]);
    const rank = new Uint32Array(distinct);
    for (let at = 0; at < distinct; at += 1) rank[order[at]] = at;

    let varint = 0;
    for (let at = 0; at < length; at += 1) {
      const code = rank[column[at]];
      varint += code < 128 ? 1 : code < 16384 ? 2 : code < 2097152 ? 3 : 4;
    }

    // What an arithmetic coder would spend on the same column, as the floor
    // the byte-aligned code is being judged against.
    let entropy = 0;
    for (let id = 0; id < distinct; id += 1) {
      if (seen[id] === 0) continue;
      const share = seen[id] / length;
      entropy -= share * Math.log2(share);
    }
    return { varint, entropy: (entropy * length) / 8, top: seen[order[0]] / length };
  };

  // Run-length the two id columns, in the numbering the graph already has.
  const runsOf = (column, length) => {
    let runs = 1;
    for (let at = 1; at < length; at += 1) if (column[at] !== column[at - 1]) runs += 1;
    return runs;
  };
  const reachRuns = runsOf(reachClass, MODULES);
  const conditionRuns = runsOf(variantCondition, base[FUNCTIONS]);

  // The same column in call order rather than id order.
  //
  // Run-length coding lost on this column, which says equal ids are not
  // adjacent — but adjacency is a property of the numbering, and the numbering
  // was the module's, not the journey's. Themisto's sparsification keeps a
  // pointer only where a path branches and samples the straight runs between,
  // measured at 90% of its color structure. That is run-length coding along the
  // path. If a hardcoded helper path really is hardcoded, the equal ids are
  // consecutive in a depth-first walk of the call graph and nowhere else.
  const walkOrder = () => {
    const forward = forwardCalls(calls);
    const seen = new Uint8Array(FUNCTIONS);
    const order = new Uint32Array(FUNCTIONS);
    const parent = new Uint32Array(FUNCTIONS).fill(0xffffffff);
    const stack = new Uint32Array(FUNCTIONS);
    let placed = 0;
    for (let root = 0; root < FUNCTIONS; root += 1) {
      if (seen[root] === 1) continue;
      let top = 0;
      stack[top++] = root;
      seen[root] = 1;
      while (top > 0) {
        const fn = stack[--top];
        order[placed++] = fn;
        for (let edge = forward.head[fn]; edge < forward.head[fn + 1]; edge += 1) {
          const next = forward.outof[edge];
          if (seen[next] === 1) continue;
          seen[next] = 1;
          parent[next] = fn;
          stack[top++] = next;
        }
      }
    }
    return { order, parent };
  };
  const { order, parent } = walkOrder();

  // A hardcoded path, built on purpose so the mechanism can be tested against
  // it. The fixture gives every function an independent branch pattern, which
  // is the one shape in which a path cannot be hardcoded — so a null result
  // measured on it says nothing. HARDCODED is the share of functions that take
  // their caller's condition instead of their own, which is what "this hook
  // always follows the same path" means when written down.
  const HARDCODED = Number(process.env.HARDCODED ?? 0);
  if (HARDCODED > 0) {
    for (let at = 0; at < FUNCTIONS; at += 1) {
      const fn = order[at];
      const from = parent[fn];
      if (from === 0xffffffff) continue;
      if (mix(fn) / 4294967296 >= HARDCODED) continue;
      const inherited = variantCondition[base[from]];
      for (let index = base[fn]; index < base[fn + 1]; index += 1) variantCondition[index] = inherited;
    }
  }
  let walkRuns = 0;
  let walkPrevious = -1;
  let walkLength = 0;
  for (let at = 0; at < FUNCTIONS; at += 1) {
    const fn = order[at];
    for (let index = base[fn]; index < base[fn + 1]; index += 1) {
      const id = variantCondition[index];
      if (id !== walkPrevious) walkRuns += 1;
      walkPrevious = id;
      walkLength += 1;
    }
  }
  const moduleRuns = runsOf(variantCondition, base[FUNCTIONS]);
  console.log(
    `hardcoded ${(HARDCODED * 100).toFixed(0)}% — condition ids: ` +
      `${count(moduleRuns)} runs in module order (${mb(moduleRuns * 8)}), ` +
      `${count(walkRuns)} runs in call order (${mb(walkRuns * 8)}, ` +
      `${(walkLength / walkRuns).toFixed(2)} variants a run)`,
  );
  console.log(
    `reach ids: ${count(MODULES)} modules in ${count(reachRuns)} runs — ` +
      `${mb(MODULES * 4)} flat, ${mb(reachRuns * 8)} run-length encoded`,
  );
  console.log(
    `condition ids: ${count(base[FUNCTIONS])} variants in ${count(conditionRuns)} runs — ` +
      `${mb(base[FUNCTIONS] * 4)} flat, ${mb(conditionRuns * 8)} run-length encoded`,
  );

  const structure = Math.ceil(FUNCTIONS / 8) + calls.from.length * 2.08;
  const conditionCode = frequencyCode(variantCondition, base[FUNCTIONS], conditions.size);
  const reachCode = frequencyCode(reachClass, MODULES, classed.classCount);
  console.log(
    `condition ids by frequency: ${mb(conditionCode.varint)} as varints ` +
      `(the commonest id is ${(conditionCode.top * 100).toFixed(1)}% of the column), ` +
      `${mb(conditionCode.entropy)} at the entropy of the column`,
  );
  console.log(
    `reach ids by frequency: ${mb(reachCode.varint)} as varints, ${mb(reachCode.entropy)} at the entropy`,
  );

  // Each column takes whichever code is smallest, which is what an encoder does
  // and what keeps a bad numbering from costing more than none.
  const columns =
    Math.min(MODULES * 4, reachRuns * 8, reachCode.varint) +
    Math.min(base[FUNCTIONS] * 4, moduleRuns * 8, walkRuns * 8, conditionCode.varint);
  const total = structure + columns + reachBytes + overClasses + TESTS * 2;
  console.log(
    `\nstore: ${mb(structure)} graph + ${mb(columns)} id columns + ` +
      `${mb(reachBytes)} reach + ${mb(overClasses + TESTS * 2)} conditions = ${mb(total)}`,
  );
  verdict();
}

/**
 * Whether the store answers what the run actually recorded.
 *
 * Every arm above measures bytes, and bytes are easy to win by losing an
 * answer. This one asks both questions twice — once of the factored, classed,
 * run-length-encoded store and once of the execution it was built from — and
 * fails if the two ever differ. A miss in the direction that matters is a test
 * that did not run for a change that broke it, so the comparison is on exact
 * set equality, not on a count.
 */
if (MODE === 'verify') {
  const graph = importGraph();
  const { reach } = reachMatrix(graph);
  const calls = callGraph(graph);
  const base = variantIndex();
  const masks = cohortMasks();
  const reverse = reverseCalls(calls);

  // Build the store exactly as `classes` does, then throw the truth away and
  // answer only from it.
  const reachPool = bitmapPool();
  const reachClass = new Uint32Array(MODULES);
  for (let module = 0; module < MODULES; module += 1) reachClass[module] = reachPool.idOf(reach, module * WORDS);
  const conditions = new Map();
  const variantCondition = new Uint32Array(base[FUNCTIONS]);
  for (let fn = 0; fn < FUNCTIONS; fn += 1) {
    for (let index = 0; index < base[fn + 1] - base[fn]; index += 1) {
      let pattern = 0;
      for (let cohort = 0; cohort < COHORTS; cohort += 1) {
        if (variantAt(fn, cohort) === index) pattern |= 1 << cohort;
      }
      let id = conditions.get(pattern);
      if (id === undefined) conditions.set(pattern, (id = conditions.size));
      variantCondition[base[fn] + index] = id;
    }
  }
  const conditionTests = new Uint32Array(conditions.size * WORDS);
  for (const [pattern, id] of conditions) {
    for (let cohort = 0; cohort < COHORTS; cohort += 1) {
      if ((pattern & (1 << cohort)) === 0) continue;
      for (let word = 0; word < WORDS; word += 1) conditionTests[id * WORDS + word] |= masks[cohort * WORDS + word];
    }
  }
  const signature = new Float64Array(TESTS).fill(1);
  for (let id = 0; id < conditions.size; id += 1) {
    const salt = mix(id + 1) / 4294967296 + 1;
    for (let word = 0; word < WORDS; word += 1) {
      let bits = conditionTests[id * WORDS + word];
      while (bits !== 0) {
        const bit = bits & -bits;
        const test = (word << 5) + 31 - Math.clz32(bit);
        signature[test] = (signature[test] * 31 + salt) % 9007199254740881;
        bits ^= bit;
      }
    }
  }
  const classOf = new Uint32Array(TESTS);
  const classes = new Map();
  for (let test = 0; test < TESTS; test += 1) {
    let id = classes.get(signature[test]);
    if (id === undefined) classes.set(signature[test], (id = classes.size));
    classOf[test] = id;
  }
  const classWords = (classes.size + 31) >>> 5;
  // The condition, over classes. This is all the store keeps of it.
  const conditionClasses = new Uint32Array(conditions.size * classWords);
  for (let id = 0; id < conditions.size; id += 1) {
    for (let test = 0; test < TESTS; test += 1) {
      if ((conditionTests[id * WORDS + (test >>> 5)] & (1 << (test & 31))) === 0) continue;
      conditionClasses[id * classWords + (classOf[test] >>> 5)] |= 1 << (classOf[test] & 31);
    }
  }
  // Which tests are in a class, which is the only expansion a query performs.
  const classTests = new Uint32Array(classes.size * WORDS);
  for (let test = 0; test < TESTS; test += 1) {
    classTests[classOf[test] * WORDS + (test >>> 5)] |= 1 << (test & 31);
  }
  const reachWords = reachPool.words();
  console.log(
    `store: ${count(reachPool.size)} reach classes, ${count(conditions.size)} conditions over ` +
      `${count(classes.size)} test classes — rss ${mb(watch())}`,
  );

  // Question one, both ways.
  const pick = stream(1234);
  const fromStore = new Uint32Array(WORDS);
  const fromRun = new Uint32Array(WORDS);
  let asked = 0;
  let missing = 0;
  let spurious = 0;
  for (let round = 0; round < 20_000; round += 1) {
    const fn = Math.floor(pick() * FUNCTIONS);
    const module = (fn / FUNCS) | 0;
    const index = Math.floor(pick() * (base[fn + 1] - base[fn]));
    const variant = base[fn] + index;

    // From the store: the module's reach class, intersected with the condition
    // expanded from classes back to tests.
    const condition = variantCondition[variant];
    fromStore.fill(0);
    for (let cls = 0; cls < classes.size; cls += 1) {
      if ((conditionClasses[condition * classWords + (cls >>> 5)] & (1 << (cls & 31))) === 0) continue;
      for (let word = 0; word < WORDS; word += 1) fromStore[word] |= classTests[cls * WORDS + word];
    }
    for (let word = 0; word < WORDS; word += 1) fromStore[word] &= reachWords[reachClass[module] * WORDS + word];

    // From the run: the tests that actually entered this variant.
    fromRun.fill(0);
    for (let test = 0; test < TESTS; test += 1) {
      if ((reach[module * WORDS + (test >>> 5)] & (1 << (test & 31))) === 0) continue;
      if (variantAt(fn, test % COHORTS) !== index) continue;
      fromRun[test >>> 5] |= 1 << (test & 31);
    }

    for (let word = 0; word < WORDS; word += 1) {
      missing += popcount(fromRun[word] & ~fromStore[word]);
      spurious += popcount(fromStore[word] & ~fromRun[word]);
    }
    asked += 1;
  }
  console.log(
    `changed variant -> tests: ${count(asked)} asked — ${count(missing)} tests the store missed, ` +
      `${count(spurious)} it named that never ran`,
  );

  // Question two: the journey, both ways. The store walks the call graph left
  // filtered by the test; the run walks it left and checks each caller really
  // entered the variant that calls this one.
  const seen = new Uint32Array(FUNCTIONS);
  const queue = new Uint32Array(FUNCTIONS);
  let stamp = 0;
  let journeys = 0;
  let disagreed = 0;
  for (let round = 0; round < 500; round += 1) {
    const test = Math.floor(pick() * TESTS);
    const word = test >>> 5;
    const bit = 1 << (test & 31);
    let fn = Math.floor(pick() * FUNCTIONS);
    let guard = 0;
    while ((reach[((fn / FUNCS) | 0) * WORDS + word] & bit) === 0 && guard < 64) {
      fn = Math.floor(pick() * FUNCTIONS);
      guard += 1;
    }
    if ((reach[((fn / FUNCS) | 0) * WORDS + word] & bit) === 0) continue;
    stamp += 1;
    let put = 0;
    let read = 0;
    queue[put++] = fn;
    seen[fn] = stamp;
    while (read < put) {
      const at = queue[read++];
      for (let edge = reverse.head[at]; edge < reverse.head[at + 1]; edge += 1) {
        const caller = reverse.into[edge];
        const module = (caller / FUNCS) | 0;
        // What the store knows: the caller's reach class holds this test.
        const held = (reachWords[reachClass[module] * WORDS + word] & bit) !== 0;
        // What the run knows: the test loaded the caller's module.
        const truly = (reach[module * WORDS + word] & bit) !== 0;
        if (held !== truly) disagreed += 1;
        if (!held || seen[caller] === stamp) continue;
        seen[caller] = stamp;
        queue[put++] = caller;
      }
    }
    journeys += 1;
  }
  console.log(`travel left: ${count(journeys)} journeys — ${count(disagreed)} steps where the store and the run disagreed`);
  console.log(
    missing === 0 && spurious === 0 && disagreed === 0
      ? '\nthe store answers exactly what the run recorded'
      : '\nTHE STORE LOST AN ANSWER',
  );
  verdict();
}

/**
 * What a run has to write for the store to be buildable at all.
 *
 * Everything above measures the artifact. This measures the producer: the
 * frames two thousand workers drop, one per test file, each naming the call
 * edges that test walked. The shipped journal already carries branch
 * granularity — an ordinal is a region — so the new axis is the parent, and the
 * question this answers is what the parent costs on the wire.
 *
 * Written the way an adjacency is written: the callers in ascending order as
 * gaps, each with its callees as gaps from the caller. A call inside the same
 * module is then a one-byte varint, which is most calls.
 */
if (MODE === 'edges') {
  const directory = process.env.DIR ?? '/tmp/variance-edge-journals';
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const graph = importGraph();
  const { reach } = reachMatrix(graph);
  const calls = callGraph(graph);
  const forward = forwardCalls(calls);
  console.log(`graph built — rss ${mb(watch())}`);

  let frame = new Uint8Array(64 * 1_048_576);
  const started = Date.now();
  let rows = 0;
  let bytes = 0;
  for (let test = 0; test < TESTS; test += 1) {
    const word = test >>> 5;
    const bit = 1 << (test & 31);
    let at = 0;
    let previousCaller = 0;
    const put = (value) => {
      let held = value;
      while (held >= 128) {
        frame[at++] = (held & 127) | 128;
        held = Math.floor(held / 128);
      }
      frame[at++] = held;
    };
    // Modules in order, so the callers come out sorted and the gaps are small.
    for (let module = 0; module < MODULES; module += 1) {
      if ((reach[module * WORDS + word] & bit) === 0) continue;
      for (let slot = 0; slot < FUNCS; slot += 1) {
        const caller = module * FUNCS + slot;
        const from = forward.head[caller];
        const span = forward.head[caller + 1] - from;
        if (span === 0) continue;
        put(caller - previousCaller);
        previousCaller = caller;
        put(span);
        for (let edge = 0; edge < span; edge += 1) {
          const callee = forward.outof[from + edge] - caller;
          put(callee < 0 ? -callee * 2 + 1 : callee * 2);
        }
        rows += span;
      }
    }
    writeFileSync(`${directory}/${pad(test, 7)}.vaedge`, frame.subarray(0, at));
    bytes += at;
    if (test % 250 === 0) {
      console.log(`  ${count(test)} frames, ${mb(bytes)}, ${secs(Date.now() - started)}, rss ${mb(watch())}`);
    }
  }
  console.log(
    `\n${count(TESTS)} frames: ${count(rows)} call-edge rows, ${mb(bytes)} on disk in ${secs(Date.now() - started)} ` +
      `(${(bytes / rows).toFixed(2)} bytes a row)`,
  );
  verdict();
}

/**
 * What a DAG reduction would buy, and what it would cost an answer.
 *
 * The literature on reachability indexes opens with the same instruction every
 * time: reduce the DAG first — condense, merge equivalent nodes, drop
 * transitively redundant edges — with published shrink ratios from 1.1x to 61x.
 * The graph is the largest remaining term in the store, so the instruction is
 * pointed straight at us.
 *
 * The catch is that two of the three reductions are sound for reachability and
 * wrong for a journey. Transitive reduction deletes the edge u -> w whenever
 * u -> v -> w exists, because reachability cannot tell the two apart. A journey
 * can: it recorded an actual call. So this arm measures both numbers — what the
 * reduction would remove, and therefore what journey fidelity costs over mere
 * reachability — rather than asserting either.
 */
if (MODE === 'reduce') {
  const graph = importGraph();
  const calls = callGraph(graph);
  const forward = forwardCalls(calls);
  const { head, outof } = forward;
  console.log(`graph built — ${count(calls.from.length)} call edges over ${count(FUNCTIONS)} functions, rss ${mb(watch())}`);

  // (1) Equivalence reduction: functions calling exactly the same set merge into
  // one node. Hash-consed, so the comparison never materializes the sets.
  const began = Date.now();
  const signature = new Map();
  let distinctSets = 0;
  let edgesAfterMerge = 0;
  const held = new Uint32Array(64);
  for (let fn = 0; fn < FUNCTIONS; fn += 1) {
    const span = head[fn + 1] - head[fn];
    if (span === 0) continue;
    if (span > held.length) continue;
    for (let at = 0; at < span; at += 1) held[at] = outof[head[fn] + at];
    const set = held.subarray(0, span);
    set.sort();
    let hash = 2166136261;
    let unique = 1;
    for (let at = 0; at < span; at += 1) {
      if (at > 0 && set[at] === set[at - 1]) continue;
      if (at > 0) unique += 1;
      hash = Math.imul(hash ^ set[at], 16777619) >>> 0;
    }
    const seen = signature.get(hash);
    if (seen === undefined) {
      signature.set(hash, 1);
      distinctSets += 1;
      edgesAfterMerge += unique;
    } else {
      signature.set(hash, seen + 1);
    }
  }
  console.log(
    `\nequivalence: ${count(distinctSets)} distinct callee sets over ${count(FUNCTIONS)} functions — ` +
      `${count(edgesAfterMerge)} edges survive a merge, ${(100 - (edgesAfterMerge / calls.from.length) * 100).toFixed(1)}% removed ` +
      `(${secs(Date.now() - began)})`,
  );

  // (2) Transitive redundancy, sampled: how many edges a reachability index is
  // allowed to throw away and a journey is not. Bounded depth, because the
  // question is how many have SOME alternate path, and a short one is the
  // common case in a call graph.
  const DEPTH = 4;
  const stamp = new Uint32Array(FUNCTIONS);
  const queue = new Uint32Array(1 << 20);
  const depths = new Uint8Array(1 << 20);
  let generation = 0;
  const sampled = 200_000;
  let redundant = 0;
  let checked = 0;
  const walked = Date.now();
  for (let take = 0; take < sampled; take += 1) {
    const at = mix(take * 2654435761) % calls.from.length;
    const source = calls.from[at];
    const target = calls.to[at];
    if (head[source + 1] - head[source] < 2) continue;
    checked += 1;
    generation += 1;
    let read = 0;
    let write = 0;
    // Depth one, minus the direct edge: every other callee of the source.
    for (let edge = head[source]; edge < head[source + 1]; edge += 1) {
      const next = outof[edge];
      if (next === target || stamp[next] === generation) continue;
      stamp[next] = generation;
      queue[write] = next;
      depths[write] = 1;
      write += 1;
    }
    let found = false;
    while (read < write && !found) {
      const node = queue[read];
      const depth = depths[read];
      read += 1;
      if (depth >= DEPTH) continue;
      for (let edge = head[node]; edge < head[node + 1]; edge += 1) {
        const next = outof[edge];
        if (next === target) { found = true; break; }
        if (stamp[next] === generation || write >= queue.length) continue;
        stamp[next] = generation;
        queue[write] = next;
        depths[write] = depth + 1;
        write += 1;
      }
    }
    if (found) redundant += 1;
  }
  console.log(
    `transitive: ${count(redundant)} of ${count(checked)} sampled edges have an alternate path within ${DEPTH} hops — ` +
      `${((redundant / checked) * 100).toFixed(1)}% a reachability index may delete and a journey may not ` +
      `(${secs(Date.now() - walked)})`,
  );

  // (3) What the adjacency already costs against its own entropy, which is the
  // only number that says whether the graph term is finished.
  const gaps = new Map();
  let gapped = 0;
  let written = 0;
  const note = (value) => {
    gaps.set(value, (gaps.get(value) ?? 0) + 1);
    gapped += varint(value);
    written += 1;
  };
  for (let fn = 0; fn < FUNCTIONS; fn += 1) {
    const span = head[fn + 1] - head[fn];
    if (span === 0 || span > held.length) continue;
    for (let at = 0; at < span; at += 1) held[at] = outof[head[fn] + at];
    const set = held.subarray(0, span);
    set.sort();
    const lead = set[0] - fn;
    note(lead < 0 ? -lead * 2 + 1 : lead * 2);
    for (let at = 1; at < span; at += 1) note(set[at] - set[at - 1]);
  }
  // The alternative to a gap: name the target by how often it is called, so the
  // helper everything imports gets the one-byte codeword. A gap cannot do this
  // — it is a function of where the target sits, not of how popular it is.
  const calledTimes = new Uint32Array(FUNCTIONS);
  for (let at = 0; at < calls.to.length; at += 1) calledTimes[calls.to[at]] += 1;
  const byCalls = new Uint32Array(FUNCTIONS);
  for (let fn = 0; fn < FUNCTIONS; fn += 1) byCalls[fn] = fn;
  byCalls.sort((left, right) => calledTimes[right] - calledTimes[left]);
  const callRank = new Uint32Array(FUNCTIONS);
  for (let at = 0; at < FUNCTIONS; at += 1) callRank[byCalls[at]] = at;
  let ranked = 0;
  let rankedEntropy = 0;
  const rankSeen = new Map();
  for (let at = 0; at < calls.to.length; at += 1) {
    const code = callRank[calls.to[at]];
    ranked += varint(code);
    rankSeen.set(code, (rankSeen.get(code) ?? 0) + 1);
  }
  for (const seen of rankSeen.values()) {
    const share = seen / calls.to.length;
    rankedEntropy -= share * Math.log2(share);
  }
  console.log(
    `targets by call count: ${count(calls.to.length)} calls — ${mb(ranked)} as ranked varints ` +
      `(${(ranked / calls.to.length).toFixed(2)} bytes a call), ` +
      `${mb((rankedEntropy * calls.to.length) / 8)} at the entropy of the ranks`,
  );

  let entropy = 0;
  for (const seen of gaps.values()) {
    const share = seen / written;
    entropy -= share * Math.log2(share);
  }
  // Where the slack between the varint and the entropy actually sits: a
  // byte-aligned code cannot spend less than a byte on a gap worth two bits,
  // so the question is how much of the column is paying that floor and how
  // much is paying a genuinely long codeword.
  const buckets = [0, 0, 0, 0, 0];
  const bucketBits = [0, 0, 0, 0, 0];
  for (const [value, seen] of gaps) {
    const width = varint(value) - 1;
    buckets[width] += seen;
    bucketBits[width] -= seen * Math.log2(seen / written);
  }
  for (let width = 0; width < 5; width += 1) {
    if (buckets[width] === 0) continue;
    console.log(
      `  ${width + 1}-byte gaps: ${count(buckets[width])} (${((buckets[width] / written) * 100).toFixed(1)}% of the column) — ` +
        `${mb(buckets[width] * (width + 1))} as varints, ${mb(bucketBits[width] / 8)} at their entropy`,
    );
  }
  console.log(
    `\nadjacency: ${count(written)} gaps, ${count(gaps.size)} distinct — ` +
      `${mb(gapped)} as varints (${(gapped / written).toFixed(2)} bytes a gap), ` +
      `${mb((entropy * written) / 8)} at the entropy of the gaps (${entropy.toFixed(2)} bits)`,
  );
  verdict();
}
