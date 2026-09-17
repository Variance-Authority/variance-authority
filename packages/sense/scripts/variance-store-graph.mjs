/**
 * The repository this script pretends to be, and the graph every arm walks.
 *
 * Shared by every arm of {@link file://./variance-store.mjs}. The shape is in
 * one place — eighty barrels, five hundred utilities every leaf reaches, one
 * root per test file — because an arm that invented its own would be measuring
 * a different repository from the arm beside it.
 */

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

export {
  MODE,
  MODULES,
  TESTS,
  FUNCS,
  CEILING,
  BARRELS,
  UTILS,
  PER_BARREL,
  COHORTS,
  WORDS,
  FUNCTIONS,
  mb,
  count,
  secs,
  pad,
  watch,
  verdict,
  stream,
  mix,
  variantCount,
  variantAt,
  ZIPF,
  popular,
  importGraph,
  reachMatrix,
  reachClasses,
  callGraph,
  variantIndex,
  cohortMasks,
};
