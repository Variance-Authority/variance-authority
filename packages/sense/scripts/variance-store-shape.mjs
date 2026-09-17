/**
 * What the store holds, what it costs, and what factoring takes off it.
 *
 * Three arms of {@link file://./variance-store.mjs}: the shape of the model, the
 * store built from it, and the same store with the call edge factored out of
 * the variant.
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
} from './variance-store-pool.mjs';

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
