/**
 * Equivalence, and what it is worth.
 *
 * The arms of {@link file://./variance-store.mjs} that stop storing a set per
 * function and start storing a class per set — succinctly, and then in full.
 */

import {
  MODE,
  MODULES,
  TESTS,
  COHORTS,
  WORDS,
  FUNCTIONS,
  mb,
  count,
  secs,
  watch,
  verdict,
  mix,
  variantAt,
  importGraph,
  reachClasses,
  callGraph,
  variantIndex,
  cohortMasks,
} from './variance-store-graph.mjs';
import {
  popcount,
  containerBytes,
  forwardCalls,
  varint,
} from './variance-store-pool.mjs';

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
