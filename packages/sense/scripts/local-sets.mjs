/**
 * Where the redundancy actually is: inside a module, or across the repository?
 *
 * The factorization is dead — `shape-sweep.mjs` measured the condition pool
 * growing *faster* than the thing it was meant to factor. What survived is
 * plainer: 33,386 blocks collapse to 1,548 distinct test-sets. This asks the
 * question that decides the file format, and it is the question the user's
 * *partial load* point turns on:
 *
 *   are those 1,548 sets **shared between modules**, or does each module have
 *   its own handful that nothing else uses?
 *
 * If shared, the dictionary is global, every query touches it, and a reader has
 * to hold all of it. If private, the dictionary is **per module** — and then a
 * module is a self-contained chunk, a query loads one chunk, and the thing that
 * was going to be one thirty-gigabyte file is a directory of small ones.
 *
 * Two arms are priced:
 *
 *   global  one dictionary of distinct sets, one global id per block.
 *   local   one dictionary a module, one *small* id a block — narrow, because a
 *           module with nine distinct sets needs four bits, not thirty-two.
 *
 *   node packages/sense/scripts/local-sets.mjs [root] [coverage.bin]
 */

import { readTestCoverage, testCoverageFile } from '../dist/test-selection/index.js';

const ROOT = process.argv[2] ?? process.cwd();
const FILE = process.argv[3] ?? testCoverageFile(ROOT);

const coverage = await readTestCoverage(FILE);
if (coverage === undefined) {
  console.error(`no snapshot at ${FILE}`);
  process.exit(1);
}

const index = new Map();
for (const test of coverage.tests) if (!index.has(test.file)) index.set(test.file, index.size);
for (const module of coverage.modules) {
  for (const block of module.blocks) for (const file of block.testFiles) if (!index.has(file)) index.set(file, index.size);
}
const TESTS = index.size;
const WORDS = (TESTS + 31) >>> 5;

const key = (files) => {
  const bits = new Uint32Array(WORDS);
  for (const file of files) {
    const at = index.get(file);
    bits[at >>> 5] |= 1 << (at & 31);
  }
  let out = '';
  for (let at = 0; at < WORDS; at += 1) out += bits[at].toString(36) + ',';
  return out;
};

/** How many modules each distinct set appears in — the sharing question. */
const modulesOfSet = new Map();
const localCounts = [];
let blocks = 0;
let localDictionaryEntries = 0;
let localIdBits = 0;
let biggestLocal = 0;
let crossingsHeld = 0;

for (const module of coverage.modules) {
  if (!module.instrumented) continue;
  const local = new Set();
  for (const block of module.blocks) {
    blocks += 1;
    const at = key(block.testFiles);
    local.add(at);
    let holders = modulesOfSet.get(at);
    if (holders === undefined) { holders = new Set(); modulesOfSet.set(at, holders); }
    holders.add(module.file);
    crossingsHeld += block.testFiles.length;
  }
  localCounts.push(local.size);
  localDictionaryEntries += local.size;
  if (local.size > biggestLocal) biggestLocal = local.size;
  // A module with `n` distinct sets needs ceil(log2 n) bits an id, never 32.
  const width = local.size <= 1 ? 0 : Math.ceil(Math.log2(local.size));
  localIdBits += width * module.blocks.length;
}

const globalDistinct = modulesOfSet.size;
let sharedSets = 0;
let sharedBlocks = 0;
for (const holders of modulesOfSet.values()) if (holders.size > 1) { sharedSets += 1; sharedBlocks += holders.size; }

const modules = localCounts.length;
const sorted = [...localCounts].sort((left, right) => left - right);
const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const pct = (part, whole) => (whole === 0 ? '0.0' : ((part / whole) * 100).toFixed(1));

const globalBytes = globalDistinct * WORDS * 4 + blocks * 4;
const localBytes = localDictionaryEntries * WORDS * 4 + Math.ceil(localIdBits / 8) + modules * 8;

console.log(`snapshot ${FILE}`);
console.log(`  ${TESTS} tests, ${modules} modules, ${blocks.toLocaleString()} blocks, ${crossingsHeld.toLocaleString()} crossings`);
console.log();
console.log(`is a set shared between modules?`);
console.log(`  ${globalDistinct.toLocaleString()} distinct sets in all`);
console.log(`  ${sharedSets.toLocaleString()} of them (${pct(sharedSets, globalDistinct)}%) appear in more than one module`);
console.log(`  ${localDictionaryEntries.toLocaleString()} module-set pairs — against ${globalDistinct.toLocaleString()} global entries, sharing saves ${(localDictionaryEntries - globalDistinct).toLocaleString()} (${pct(localDictionaryEntries - globalDistinct, localDictionaryEntries)}%)`);
console.log();
console.log(`distinct sets inside one module`);
console.log(`  ${at(0)} min, ${at(0.5)} median, ${at(0.9)} p90, ${at(0.99)} p99, ${biggestLocal} max`);
console.log(`  ${(blocks / modules).toFixed(1)} blocks a module on average, collapsing to ${(localDictionaryEntries / modules).toFixed(1)} sets`);
console.log(`  a block's id needs ${(localIdBits / blocks).toFixed(2)} bits on average, against 32 for a global one`);
console.log();
console.log(`two file formats at this shape`);
console.log(`  global  ${kb(globalBytes)} — one dictionary, ${globalDistinct.toLocaleString()} bitmaps, a 32-bit id a block`);
console.log(`  local   ${kb(localBytes)} — a dictionary a module, ${localDictionaryEntries.toLocaleString()} bitmaps, a narrow id a block`);
console.log(`  ${localBytes < globalBytes ? 'local' : 'global'} wins by ${pct(Math.abs(localBytes - globalBytes), Math.max(localBytes, globalBytes))}%`);

// ---------------------------------------------------------------------------
// The measurement that decides the large repository.
//
// Every number above is in *global* coordinates: a set names tests out of the
// whole suite, so a bitmap is |U| bits and a list is a global test id per
// member. Neither survives a module that two thousand tests reach.
//
// Reach coordinates fix that, and they are the one half of the dead
// factorization that real code did not refute. A block's set is a subset of its
// module's reach, so name its members by their *position within that reach* —
// ceil(log2 |R(m)|) bits each — and store whichever of the set or its
// complement is smaller. A block that always runs costs nothing at all, and the
// 27% of blocks that do is not a rounding error.
// ---------------------------------------------------------------------------

const reachPool = new Map();
let globalBits = 0;
let reachBits = 0;
let complemented = 0;
let freeBlocks = 0;
const ratios = new Int32Array(11);
let enteredBlocks = 0;

for (const module of coverage.modules) {
  if (!module.instrumented) continue;
  const reachSet = new Set();
  for (const block of module.blocks) for (const file of block.testFiles) reachSet.add(file);
  const reachSize = reachSet.size;
  if (reachSize === 0) continue;
  reachPool.set(key([...reachSet]), true);

  // Position within the module's reach, in a stable order.
  const position = new Map();
  for (const file of [...reachSet].sort()) position.set(file, position.size);
  const width = reachSize <= 1 ? 1 : Math.ceil(Math.log2(reachSize));
  const globalWidth = Math.ceil(Math.log2(TESTS));

  const localSets = new Map();
  for (const block of module.blocks) {
    const size = block.testFiles.length;
    if (size === 0) continue;
    enteredBlocks += 1;
    ratios[Math.min(10, Math.floor((size / reachSize) * 10))] += 1;
    const at = key(block.testFiles);
    if (localSets.has(at)) continue;
    localSets.set(at, true);
    // Whichever side of the set is shorter; a full set costs one marker bit.
    const members = Math.min(size, reachSize - size);
    if (members === 0) freeBlocks += 1;
    if (reachSize - size < size) complemented += 1;
    reachBits += 8 + members * width;
    globalBits += 8 + size * globalWidth;
  }
}

console.log();
console.log(`how full a block's set is, against its module's reach`);
const labels = ['0-10%', '10-20%', '20-30%', '30-40%', '40-50%', '50-60%', '60-70%', '70-80%', '80-90%', '90-100%', 'all of it'];
for (let bucket = 0; bucket < 11; bucket += 1) {
  if (ratios[bucket] === 0) continue;
  console.log(`  ${labels[bucket].padEnd(10)} ${String(ratios[bucket]).padStart(7)} blocks (${pct(ratios[bucket], enteredBlocks)}%)`);
}
console.log();
console.log(`naming a set's members`);
console.log(`  ${reachPool.size.toLocaleString()} distinct module reaches`);
console.log(`  global coordinates: ${kb(globalBits / 8)} — a ${Math.ceil(Math.log2(TESTS))}-bit test id a member`);
console.log(`  reach coordinates:  ${kb(reachBits / 8)} — a position inside the module's own reach, shorter side only`);
console.log(`  ${complemented.toLocaleString()} sets were cheaper written as what did NOT run`);
console.log(`  ${freeBlocks.toLocaleString()} distinct sets cost nothing: they are the module's reach exactly`);

console.log();
console.log(`peak rss ${(process.memoryUsage().rss / 1_048_576).toFixed(1)} MB`);
