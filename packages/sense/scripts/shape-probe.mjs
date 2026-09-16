/**
 * Does the factorization hold on real code?
 *
 * The store claims `T(v) = R(m) ∩ C(v)`: the tests that entered a block are the
 * tests that reached its module, intersected with a *condition* drawn from a
 * pool shared across the whole repository. Interning the two factors costs
 * their sum; writing the relation costs their product. Everything the synthetic
 * store's figure rests on is that sentence, and that sentence was true in the
 * fixture *by construction* — the generator built variants as a module crossed
 * with a cohort, so nothing there could have falsified it.
 *
 * Nothing here can fail the equation either: pick `C(v) = T(v) ∪ ¬R(m)` and it
 * holds for any relation whatsoever. What can fail is the **pool**. If real
 * blocks each carry their own condition, `|C|` approaches the block count, the
 * sum stops beating the product, and the factorization was an artifact. So the
 * number to read is `distinct C`, against `distinct T` — hash-consing alone,
 * with no factorization at all, is the arm to beat.
 *
 *   node packages/sense/scripts/shape-probe.mjs [root] [coverage.bin]
 */

import { readTestCoverage, testCoverageFile } from '../dist/test-selection/index.js';

const ROOT = process.argv[2] ?? process.cwd();
const FILE = process.argv[3] ?? testCoverageFile(ROOT);

const coverage = await readTestCoverage(FILE);
if (coverage === undefined) {
  console.error(`no snapshot at ${FILE}`);
  process.exit(1);
}

/** Every test file the snapshot names, numbered — the universe both factors live in. */
const testIndex = new Map();
for (const test of coverage.tests) if (!testIndex.has(test.file)) testIndex.set(test.file, testIndex.size);
for (const module of coverage.modules) {
  for (const block of module.blocks) {
    for (const file of block.testFiles) if (!testIndex.has(file)) testIndex.set(file, testIndex.size);
  }
}
const TESTS = testIndex.size;
const WORDS = (TESTS + 31) >>> 5;
/** Bits above the universe are 1 in a complement and must not count as members. */
const TAIL = TESTS % 32 === 0 ? 0xffffffff : (1 << (TESTS % 32)) - 1;

const bitsOf = (files) => {
  const bits = new Uint32Array(WORDS);
  for (const file of files) {
    const at = testIndex.get(file);
    bits[at >>> 5] |= 1 << (at & 31);
  }
  return bits;
};
const key = (bits) => {
  let out = '';
  for (let at = 0; at < WORDS; at += 1) out += bits[at].toString(36) + ',';
  return out;
};
const popcount = (bits) => {
  let total = 0;
  for (let at = 0; at < WORDS; at += 1) {
    let word = bits[at];
    word -= (word >>> 1) & 0x55555555;
    word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
    total += (((word + (word >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return total;
};

/** Hash-consed sets, keyed by content: the id is the offset into `held`. */
const pool = () => {
  const seen = new Map();
  const held = [];
  return {
    intern: (bits) => {
      const at = key(bits);
      const found = seen.get(at);
      if (found !== undefined) return found;
      const id = held.length;
      seen.set(at, id);
      held.push(bits);
      return id;
    },
    at: (id) => held[id],
    get size() { return held.length; },
  };
};

const reach = pool();
const condition = pool();
const literal = pool();

let modules = 0;
let instrumented = 0;
let blocks = 0;
let entered = 0;
let never = 0;
let always = 0;
let sometimes = 0;
let crossings = 0;
let mismatches = 0;
const conditionUse = new Map();
const kindAlways = new Map();
const kindEntered = new Map();
const reachSizes = [];
/** The factored store itself: two ids a block, one reach id a module. */
const blockCondition = [];
const blockReach = [];

for (const module of coverage.modules) {
  modules += 1;
  if (!module.instrumented) continue;
  instrumented += 1;

  // Reach, folded from the run: every test that entered any region of this
  // module. A static import closure would be wider, and is the safe
  // over-approximation selection actually uses; this is the tightest reach the
  // data supports, and the tighter it is the more work is left for a condition.
  const reachBits = new Uint32Array(WORDS);
  const perBlock = [];
  for (const block of module.blocks) {
    const bits = bitsOf(block.testFiles);
    perBlock.push(bits);
    for (let at = 0; at < WORDS; at += 1) reachBits[at] |= bits[at];
  }
  const reachSize = popcount(reachBits);
  reachSizes.push(reachSize);
  const reachId = reach.intern(reachBits);

  for (let index = 0; index < module.blocks.length; index += 1) {
    const block = module.blocks[index];
    const bits = perBlock[index];
    const size = popcount(bits);
    blocks += 1;
    crossings += size;
    literal.intern(bits);

    // The canonical condition: what this block did, plus a free pass for every
    // test that never reached the module. Two blocks in unrelated files that
    // both always run collapse onto one id; that collapse is the design, and
    // its reach is what this counts.
    const cond = new Uint32Array(WORDS);
    for (let at = 0; at < WORDS; at += 1) cond[at] = (bits[at] | ~reachBits[at]) >>> 0;
    cond[WORDS - 1] = (cond[WORDS - 1] & TAIL) >>> 0;
    const conditionId = condition.intern(cond);
    conditionUse.set(conditionId, (conditionUse.get(conditionId) ?? 0) + 1);
    blockCondition.push(conditionId);
    blockReach.push(reachId);

    if (size === 0) never += 1;
    else {
      entered += 1;
      kindEntered.set(block.kind, (kindEntered.get(block.kind) ?? 0) + 1);
      if (size === reachSize) {
        always += 1;
        kindAlways.set(block.kind, (kindAlways.get(block.kind) ?? 0) + 1);
      } else sometimes += 1;
    }
  }
}

// Round-trip: rebuild every block's test set out of the two interned factors
// and hold it against what the run recorded. A factorization that loses a
// crossing is not a smaller store, it is a wrong one.
let cursor = 0;
for (const module of coverage.modules) {
  if (!module.instrumented) continue;
  for (const block of module.blocks) {
    const want = bitsOf(block.testFiles);
    const r = reach.at(blockReach[cursor]);
    const c = condition.at(blockCondition[cursor]);
    for (let at = 0; at < WORDS; at += 1) if (((r[at] & c[at]) >>> 0) !== want[at]) { mismatches += 1; break; }
    cursor += 1;
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const pct = (part, whole) => (whole === 0 ? '0.0' : ((part / whole) * 100).toFixed(1));
const median = (list) => {
  if (list.length === 0) return 0;
  const sorted = [...list].sort((left, right) => left - right);
  return sorted[sorted.length >> 1];
};

const dense = blocks * WORDS * 4;
const consed = literal.size * WORDS * 4 + blocks * 4;
const factored = reach.size * WORDS * 4 + condition.size * WORDS * 4 + instrumented * 4 + blocks * 4;

console.log(`snapshot ${FILE}`);
console.log(`  ${coverage.tests.length} test files, ${modules} modules (${instrumented} instrumented), ${blocks.toLocaleString()} blocks`);
console.log(`  ${crossings.toLocaleString()} block-test crossings recorded`);
console.log(`  reach per module: ${Math.min(...reachSizes)} min, ${median(reachSizes)} median, ${Math.max(...reachSizes)} max of ${TESTS} tests`);
console.log();
console.log(`the factorization  T(v) = R(m) ∩ C(v)`);
console.log(`  distinct T — what a block did          ${literal.size.toLocaleString()}`);
console.log(`  distinct R — module reach              ${reach.size.toLocaleString()} over ${instrumented.toLocaleString()} modules`);
console.log(`  distinct C — shared conditions         ${condition.size.toLocaleString()} over ${blocks.toLocaleString()} blocks`);
console.log(`  R + C = ${(reach.size + condition.size).toLocaleString()} against T = ${literal.size.toLocaleString()} — factoring ${reach.size + condition.size < literal.size ? 'WINS' : 'LOSES'} at this shape`);
console.log(`  round trip: ${mismatches} blocks where R ∩ C is not what the run recorded`);
console.log();
console.log(`what a block did when its module was reached (of ${entered.toLocaleString()} entered)`);
console.log(`  always    ${always.toLocaleString()} (${pct(always, entered)}%) — ran for every test that reached the module`);
console.log(`  sometimes ${sometimes.toLocaleString()} (${pct(sometimes, entered)}%) — ran for a proper subset`);
console.log(`  never entered by anything: ${never.toLocaleString()} of ${blocks.toLocaleString()} blocks (${pct(never, blocks)}%)`);
console.log();
console.log(`bytes at this shape (${TESTS} tests, ${WORDS} words a set)`);
console.log(`  dense       ${kb(dense)} — a bitmap a block`);
console.log(`  hash-consed ${kb(consed)} — distinct T interned, one id a block`);
console.log(`  factored    ${kb(factored)} — R and C interned, two ids a block`);
console.log();

const top = [...conditionUse.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
console.log(`the conditions that carry the pool`);
for (const [id, used] of top) {
  const size = popcount(condition.at(id));
  console.log(`  condition ${String(id).padStart(5)} — ${String(used).padStart(6)} blocks (${pct(used, blocks)}%), admits ${size} of ${TESTS} tests`);
}
console.log();
console.log(`which kinds of block are unconditional, over the ones that ran`);
for (const [kind, total] of [...kindEntered.entries()].sort((left, right) => right[1] - left[1])) {
  const hit = kindAlways.get(kind) ?? 0;
  console.log(`  ${kind.padEnd(12)} ${String(hit).padStart(6)} of ${String(total).padStart(6)} always (${pct(hit, total)}%)`);
}
console.log();
console.log(`peak rss ${(process.memoryUsage().rss / 1_048_576).toFixed(1)} MB`);
