/**
 * How the set counts grow with the suite — measured, not extrapolated.
 *
 * The snapshot this reads holds 392 test files. The repository it has to work
 * on holds thousands, and the honest way to say anything about that is to take
 * the real relation apart: restrict it to K tests, count the distinct sets, and
 * do it again at a larger K. If the count of distinct sets rises linearly in K,
 * interning buys a constant factor and the store grows with the suite. If it
 * saturates, interning buys an asymptote and the suite can grow without the
 * store following.
 *
 * Three counts at each K, because they are three different claims:
 *
 *   T  distinct block test-sets — what hash-consing alone collapses to.
 *   R  distinct module reach-sets — the first factor, and what selection needs.
 *   C  distinct conditions under `C(v) = T(v) ∪ ¬R(m)` — the second factor,
 *      whose whole purpose is to be *small* and shared across modules.
 *
 * Subsets are drawn deterministically from a seeded shuffle, so two runs
 * compare, and each K is a prefix of the next so the curve is nested rather
 * than a fresh sample per point.
 *
 *   node packages/sense/scripts/shape-sweep.mjs [root] [coverage.bin]
 */

import { readTestCoverage, testCoverageFile } from '../dist/test-selection/index.js';

const ROOT = process.argv[2] ?? process.cwd();
const FILE = process.argv[3] ?? testCoverageFile(ROOT);

const coverage = await readTestCoverage(FILE);
if (coverage === undefined) {
  console.error(`no snapshot at ${FILE}`);
  process.exit(1);
}

const every = new Map();
for (const test of coverage.tests) if (!every.has(test.file)) every.set(test.file, every.size);
for (const module of coverage.modules) {
  for (const block of module.blocks) {
    for (const file of block.testFiles) if (!every.has(file)) every.set(file, every.size);
  }
}
const names = [...every.keys()];

/** A seeded shuffle, so the K-test prefix is the same on any machine. */
let seed = 0x9e3779b9;
const next = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};
for (let at = names.length - 1; at > 0; at -= 1) {
  const swap = Math.floor(next() * (at + 1));
  [names[at], names[swap]] = [names[swap], names[at]];
}

const measure = (howMany) => {
  const index = new Map();
  for (let at = 0; at < howMany; at += 1) index.set(names[at], at);
  const WORDS = (howMany + 31) >>> 5;
  const TAIL = howMany % 32 === 0 ? 0xffffffff : (1 << (howMany % 32)) - 1;

  const key = (bits) => {
    let out = '';
    for (let at = 0; at < WORDS; at += 1) out += bits[at].toString(36) + ',';
    return out;
  };
  const T = new Set();
  const R = new Set();
  const C = new Set();
  let blocks = 0;
  let crossings = 0;
  let entered = 0;

  for (const module of coverage.modules) {
    if (!module.instrumented) continue;
    const reachBits = new Uint32Array(WORDS);
    const perBlock = [];
    for (const block of module.blocks) {
      const bits = new Uint32Array(WORDS);
      for (const file of block.testFiles) {
        const at = index.get(file);
        if (at === undefined) continue;
        bits[at >>> 5] |= 1 << (at & 31);
      }
      perBlock.push(bits);
      for (let at = 0; at < WORDS; at += 1) reachBits[at] |= bits[at];
    }
    R.add(key(reachBits));
    for (const bits of perBlock) {
      blocks += 1;
      let size = 0;
      for (let at = 0; at < WORDS; at += 1) {
        let word = bits[at];
        while (word !== 0) { word &= word - 1; size += 1; }
      }
      crossings += size;
      if (size > 0) entered += 1;
      T.add(key(bits));
      const cond = new Uint32Array(WORDS);
      for (let at = 0; at < WORDS; at += 1) cond[at] = (bits[at] | ~reachBits[at]) >>> 0;
      cond[WORDS - 1] = (cond[WORDS - 1] & TAIL) >>> 0;
      C.add(key(cond));
    }
  }
  return { tests: howMany, blocks, crossings, entered, T: T.size, R: R.size, C: C.size, words: WORDS };
};

const points = [];
for (const share of [0.0625, 0.125, 0.25, 0.5, 1]) {
  const howMany = Math.max(2, Math.round(names.length * share));
  points.push(measure(howMany));
}

const pad = (value, width) => String(value).padStart(width);
console.log(`snapshot ${FILE} — ${names.length} test files, ${points[points.length - 1].blocks.toLocaleString()} blocks`);
console.log();
console.log(`  tests   crossings  entered      T      R      C   T/test   consed   factored`);
for (const point of points) {
  const consed = point.T * point.words * 4 + point.blocks * 4;
  const factored = point.R * point.words * 4 + point.C * point.words * 4 + point.blocks * 8;
  console.log(
    `  ${pad(point.tests, 5)}  ${pad(point.crossings.toLocaleString(), 10)}  ${pad(point.entered.toLocaleString(), 7)}  ` +
    `${pad(point.T, 5)}  ${pad(point.R, 5)}  ${pad(point.C, 5)}   ${pad((point.T / point.tests).toFixed(2), 6)}  ` +
    `${pad((consed / 1024).toFixed(0) + ' KB', 8)}  ${pad((factored / 1024).toFixed(0) + ' KB', 9)}`,
  );
}
console.log();
const first = points[0];
const last = points[points.length - 1];
const growth = (from, to) => Math.log(to / from) / Math.log(last.tests / first.tests);
console.log(`over a ${(last.tests / first.tests).toFixed(0)}x growth in the suite`);
console.log(`  T grew ${(last.T / first.T).toFixed(2)}x — exponent ${growth(first.T, last.T).toFixed(2)} against tests`);
console.log(`  R grew ${(last.R / first.R).toFixed(2)}x — exponent ${growth(first.R, last.R).toFixed(2)}`);
console.log(`  C grew ${(last.C / first.C).toFixed(2)}x — exponent ${growth(first.C, last.C).toFixed(2)}`);
console.log(`  crossings grew ${(last.crossings / first.crossings).toFixed(2)}x — exponent ${growth(first.crossings, last.crossings).toFixed(2)}`);
console.log();
console.log(`an exponent of 1.00 means the count tracks the suite; below 1.00 it saturates.`);
console.log(`peak rss ${(process.memoryUsage().rss / 1_048_576).toFixed(1)} MB`);
