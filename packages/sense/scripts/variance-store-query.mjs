/**
 * Reading the store back.
 *
 * The arms of {@link file://./variance-store.mjs} that ask it questions — one
 * query, the same query swept across test counts, the worst case the shape
 * admits, and how far down a journey the answer stays affordable.
 */

import {
  MODE,
  MODULES,
  TESTS,
  FUNCS,
  COHORTS,
  WORDS,
  FUNCTIONS,
  mb,
  count,
  secs,
  watch,
  verdict,
  stream,
  mix,
  variantAt,
  importGraph,
  reachMatrix,
  callGraph,
  variantIndex,
  cohortMasks,
} from './variance-store-graph.mjs';
import {
  popcount,
  bitmapPool,
  containerBytes,
  reverseCalls,
  forwardCalls,
} from './variance-store-pool.mjs';

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
