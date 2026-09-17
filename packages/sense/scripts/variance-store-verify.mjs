/**
 * Checking the claims the other arms make.
 *
 * The arms of {@link file://./variance-store.mjs} that re-derive a result the
 * slow honest way and compare, count the edges the model really has, and reduce
 * it to see what survives.
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
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
  pad,
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
  reverseCalls,
  forwardCalls,
  varint,
} from './variance-store-pool.mjs';

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
