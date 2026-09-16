/**
 * Does the chunk store survive the user's repository, and does it stay under
 * the ceiling while it is being built?
 *
 * `chunk-store.mjs` measures the design on this repository — 392 tests, 935
 * modules, a hundred thousand crossings — and a hundred thousand crossings
 * proves nothing about two hundred thousand files. This runs the same encoder
 * against the shape that matters: two hundred thousand modules, two thousand
 * test files whose closures reach forty thousand modules apiece.
 *
 * ## Where each half of the shape comes from
 *
 * The *graph* comes from `snapshot-scale.mjs`'s barrel fixture, which is the
 * one already vetted for forty-thousand-module closures.
 *
 * The *block contents* are learned from the real snapshot, because the fixture
 * generates them with `variantAt(fn, test % COHORTS)` — and that cohort trick
 * is exactly what made the old factorization look free. A block's set is drawn
 * from the measured distribution instead: how many blocks a real module has,
 * how many distinct sets they collapse to, and how full each of those sets is
 * relative to its module's reach. Members are then placed *uniformly* inside
 * the reach, which is the pessimistic choice — real members cluster, and
 * clustered members delta-code shorter than these will.
 *
 * ## Why a cold build can stay under the ceiling
 *
 * The transpose is the thing that does not fit: a hundred million module-test
 * pairs is four hundred megabytes before anything is encoded. It is never
 * built. Modules are collapsed into reach classes first — partition refinement
 * over one closure at a time, which holds one closure and three integer arrays
 * over the modules — and only the distinct classes ever materialize their
 * members. Every module then writes its chunk against a class it names by id,
 * and the chunk goes to disk immediately.
 *
 *   node packages/sense/scripts/scale-chunks.mjs [snapshot] [modules] [tests] [out] [scatter]
 */

import { writeFileSync, openSync, writeSync, readSync, closeSync, statSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTestCoverage, testCoverageFile } from '../dist/test-selection/index.js';

const SNAPSHOT = process.argv[2] ?? testCoverageFile(process.cwd());
const MODULES = Number(process.argv[3] ?? 200_000);
const TESTS = Number(process.argv[4] ?? 2_000);
const OUT = process.argv[5] ?? '/tmp/variance-chunks';
const SCATTER = Number(process.argv[6] ?? 0);
const CEILING = 600 * 1_048_576;
const SHARDS = 256;

const BARRELS = 80;
const UTILS = 500;
const PER_BARREL = Math.floor((MODULES - BARRELS - UTILS - TESTS) / BARRELS);

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const count = (n) => n.toLocaleString();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const started = Date.now();
let peak = 0;
const mark = () => { const now = process.memoryUsage().rss; if (now > peak) peak = now; return now; };
mark();

const stream = (seed) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
};

// ---------------------------------------------------------------------------
// 1. Learn the block shape from real code.
// ---------------------------------------------------------------------------
const coverage = await readTestCoverage(SNAPSHOT);
if (coverage === undefined) { console.error(`no snapshot at ${SNAPSHOT}`); process.exit(1); }

/** One real module's block structure, with sizes expressed as a share of reach. */
const profiles = [];
for (const module of coverage.modules) {
  if (!module.instrumented || module.blocks.length === 0) continue;
  const reach = new Set();
  for (const block of module.blocks) for (const file of block.testFiles) reach.add(file);
  if (reach.size === 0) continue;
  const setId = new Map();
  const fullness = [];
  const column = [];
  for (const block of module.blocks) {
    const at = [...block.testFiles].sort().join('|');
    let id = setId.get(at);
    if (id === undefined) { id = fullness.length; setId.set(at, id); fullness.push(block.testFiles.length / reach.size); }
    column.push(id);
  }
  profiles.push({ column, fullness });
}
const realBlocks = profiles.reduce((sum, profile) => sum + profile.column.length, 0);
const realSets = profiles.reduce((sum, profile) => sum + profile.fullness.length, 0);
console.log(`learned from ${SNAPSHOT}`);
console.log(`  ${count(profiles.length)} module profiles — ${(realBlocks / profiles.length).toFixed(1)} blocks a module collapsing to ${(realSets / profiles.length).toFixed(1)} sets`);
coverage.modules.length = 0;
coverage.tests.length = 0;
mark();

// ---------------------------------------------------------------------------
// 2. The graph. One closure at a time, never the transpose.
// ---------------------------------------------------------------------------
const graphStarted = Date.now();
const next = stream(20250915);
const utilAt = BARRELS;
const leafAt = BARRELS + UTILS;
const rootAt = leafAt + BARRELS * PER_BARREL;
if (rootAt + TESTS > MODULES) throw new Error('module count too small for this shape');
const degree = new Uint32Array(MODULES);
for (let barrel = 0; barrel < BARRELS; barrel += 1) degree[barrel] = PER_BARREL;
for (let leaf = leafAt; leaf < rootAt; leaf += 1) degree[leaf] = 2;
const barrelDegree = new Uint32Array(TESTS);
const rootDegree = new Uint32Array(TESTS);
const rootFirst = new Uint32Array(TESTS);
for (let test = 0; test < TESTS; test += 1) {
  barrelDegree[test] = 1 + Math.floor(next() * 40);
  rootFirst[test] = Math.floor(next() * BARRELS);
  rootDegree[test] = barrelDegree[test] + SCATTER;
  degree[rootAt + test] = rootDegree[test];
}
const head = new Uint32Array(MODULES + 1);
for (let module = 0; module < MODULES; module += 1) head[module + 1] = head[module] + degree[module];
const edges = new Uint32Array(head[MODULES]);
const leafStream = stream(77);
for (let barrel = 0; barrel < BARRELS; barrel += 1) {
  for (let step = 0; step < PER_BARREL; step += 1) edges[head[barrel] + step] = leafAt + barrel * PER_BARREL + step;
}
for (let leaf = leafAt; leaf < rootAt; leaf += 1) {
  edges[head[leaf]] = utilAt + Math.floor(leafStream() * UTILS);
  edges[head[leaf] + 1] = utilAt + Math.floor(leafStream() * UTILS);
}
const scatterStream = stream(31337);
for (let test = 0; test < TESTS; test += 1) {
  let step = 0;
  for (; step < barrelDegree[test]; step += 1) edges[head[rootAt + test] + step] = (rootFirst[test] + step) % BARRELS;
  // Direct imports, past the barrels. The barrel fixture alone gives every
  // module under a barrel the same reach, which is a regularity real code does
  // not have — this repository's own graph runs 2.6 modules to a reach class,
  // the fixture's runs ninety-six. A handful of direct edges a test fragments
  // the partition the way real imports do, and is the adversarial case for
  // both the reach pool and the class ids the chunks carry.
  for (; step < rootDegree[test]; step += 1) {
    edges[head[rootAt + test] + step] = leafAt + Math.floor(scatterStream() * (rootAt - leafAt));
  }
}

const seen = new Uint32Array(MODULES);
const queue = new Uint32Array(MODULES);
let stamp = 0;
const closureOf = (test) => {
  stamp += 1;
  let wrote = 0;
  let read = 0;
  queue[wrote++] = rootAt + test;
  seen[rootAt + test] = stamp;
  while (read < wrote) {
    const at = queue[read++];
    for (let edge = head[at]; edge < head[at + 1]; edge += 1) {
      const to = edges[edge];
      if (seen[to] !== stamp) { seen[to] = stamp; queue[wrote++] = to; }
    }
  }
  return wrote;
};

// ---------------------------------------------------------------------------
// 3. Reach classes by partition refinement. `classOf` is the whole state.
// ---------------------------------------------------------------------------
const refineStarted = Date.now();
// `split` and `splitRun` are indexed by class id, and a round mints a fresh id
// for every class it touches — so the id space grows without bound while the
// modules do not. Sized at the module count it runs off the end within a few
// rounds, and a TypedArray drops those writes in silence: `split[from]` then
// reads back undefined, `classOf` takes a 0, and the partition quietly
// collapses to about one class a test. Hence a capacity with headroom for a
// full round, and a compaction back to dense ids whenever a round could
// exhaust it.
const CAPACITY = MODULES * 4;
const classOf = new Int32Array(MODULES);
const split = new Int32Array(CAPACITY);
const splitRun = new Int32Array(CAPACITY).fill(-1);
const scratch = new Int32Array(MODULES);
let classes = 1;
let pairs = 0;
let compactions = 0;
const compact = () => {
  const seenClass = new Map();
  for (let module = 0; module < MODULES; module += 1) {
    const at = classOf[module];
    let id = seenClass.get(at);
    if (id === undefined) { id = seenClass.size; seenClass.set(at, id); }
    scratch[module] = id;
  }
  classOf.set(scratch);
  classes = seenClass.size;
  splitRun.fill(-1);
  compactions += 1;
};
for (let test = 0; test < TESTS; test += 1) {
  const reached = closureOf(test);
  if (classes + reached >= CAPACITY) compact();
  pairs += reached;
  for (let index = 0; index < reached; index += 1) {
    const at = queue[index];
    const from = classOf[at];
    if (splitRun[from] !== test) { splitRun[from] = test; split[from] = classes; classes += 1; }
    classOf[at] = split[from];
  }
  if ((test & 255) === 0) mark();
}
compact();
mark();
const refineMs = Date.now() - refineStarted;

// Renumber to a dense range, then materialize each class's members once.
const CLASSES = classes;
const WORDS = Math.ceil(TESTS / 32);
const classBits = new Uint32Array(CLASSES * WORDS);
for (let test = 0; test < TESTS; test += 1) {
  const reached = closureOf(test);
  const word = test >>> 5;
  const bit = 1 << (test & 31);
  for (let index = 0; index < reached; index += 1) classBits[classOf[queue[index]] * WORDS + word] |= bit;
  if ((test & 255) === 0) mark();
}
const reachOfClass = [];
for (let id = 0; id < CLASSES; id += 1) {
  const members = [];
  for (let word = 0; word < WORDS; word += 1) {
    let bits = classBits[id * WORDS + word];
    while (bits !== 0) { const bit = 31 - Math.clz32(bits & -bits); members.push(word * 32 + bit); bits &= bits - 1; }
  }
  reachOfClass.push(members);
}
let reachedModules = 0;
for (let module = 0; module < MODULES; module += 1) if (reachOfClass[classOf[module]].length > 0) reachedModules += 1;
mark();

// The truth to check the store against, for a sample of modules, taken from
// the closures themselves rather than from the partition. Checking a decoded
// chunk against `reachOfClass[classOf[module]]` only proves the store agrees
// with the array it was built from — it cannot see a wrong partition at all.
const SAMPLE = 1000;
const sampleAt = new Int32Array(MODULES).fill(-1);
const sampled = [];
{
  const pickStream = stream(515);
  while (sampled.length < SAMPLE) {
    const module = Math.floor(pickStream() * MODULES);
    if (sampleAt[module] !== -1 || reachOfClass[classOf[module]].length === 0) continue;
    sampleAt[module] = sampled.length;
    sampled.push(module);
  }
}
const truthBits = new Uint32Array(SAMPLE * WORDS);
for (let test = 0; test < TESTS; test += 1) {
  const reached = closureOf(test);
  const word = test >>> 5;
  const bit = 1 << (test & 31);
  for (let index = 0; index < reached; index += 1) {
    const at = sampleAt[queue[index]];
    if (at !== -1) truthBits[at * WORDS + word] |= bit;
  }
}
const truthOf = (module) => {
  const at = sampleAt[module];
  const members = [];
  for (let word = 0; word < WORDS; word += 1) {
    let bits = truthBits[at * WORDS + word];
    while (bits !== 0) { const bit = 31 - Math.clz32(bits & -bits); members.push(word * 32 + bit); bits &= bits - 1; }
  }
  return members;
};
mark();
const graphMs = Date.now() - graphStarted;

console.log();
console.log(`the graph`);
console.log(`  ${count(MODULES)} modules, ${count(head[MODULES])} edges, ${count(TESTS)} tests, scatter ${SCATTER}`);
console.log(`  ${count(pairs)} module-test pairs (${Math.round(pairs / TESTS).toLocaleString()} a test) — never materialized`);
console.log(`  ${count(CLASSES)} reach classes over ${count(reachedModules)} reached modules — ${(reachedModules / CLASSES).toFixed(0)} modules a class`);
console.log(`  refined in ${secs(refineMs)} over ${compactions} compactions, graph stage ${secs(graphMs)}`);

// ---------------------------------------------------------------------------
// 4. Write the chunks. One per module, straight to a shard, never held.
// ---------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const shardName = (shard) => join(OUT, `chunk-${String(shard).padStart(3, '0')}.bin`);
const handles = [];
const buffers = [];
const FLUSH = 1 << 20;
for (let shard = 0; shard < SHARDS; shard += 1) {
  handles.push(openSync(shardName(shard), 'w'));
  buffers.push({ bytes: Buffer.allocUnsafe(FLUSH + (1 << 20)), at: 0, written: 0 });
}
const flush = (shard) => {
  const buffer = buffers[shard];
  if (buffer.at === 0) return;
  writeSync(handles[shard], buffer.bytes, 0, buffer.at);
  buffer.written += buffer.at;
  buffer.at = 0;
};
/** Append a varint straight into the shard's buffer. */
const emit = (shard, value) => {
  const buffer = buffers[shard];
  let rest = value >>> 0;
  while (rest >= 0x80) { buffer.bytes[buffer.at++] = (rest & 0x7f) | 0x80; rest >>>= 7; }
  buffer.bytes[buffer.at++] = rest;
};
const emitByte = (shard, value) => { const buffer = buffers[shard]; buffer.bytes[buffer.at++] = value & 0xff; };

const offsets = new Float64Array(MODULES);
const lengths = new Uint32Array(MODULES);
const chunkStarted = Date.now();
const pick = stream(4242);
let blocks = 0;
let crossings = 0;
let sets = 0;
let free = 0;
let complemented = 0;
let biggest = 0;
const held = new Uint8Array(TESTS + 1);
const sizes = [];

for (let module = 0; module < MODULES; module += 1) {
  const reach = reachOfClass[classOf[module]];
  if (reach.length === 0) continue;
  const profile = profiles[Math.floor(pick() * profiles.length)];
  const shard = module % SHARDS;
  const buffer = buffers[shard];
  if (buffer.at > FLUSH) flush(shard);
  const startedAt = buffer.written + buffer.at;

  emit(shard, classOf[module]);
  emit(shard, profile.fullness.length);
  sizes.length = 0;
  for (const share of profile.fullness) {
    const size = Math.max(1, Math.min(reach.length, Math.round(share * reach.length)));
    sets += 1;
    sizes.push(size);
    const missing = reach.length - size;
    if (missing === 0) { emitByte(shard, 2); free += 1; continue; }
    // Members placed uniformly — the pessimistic case for delta coding.
    const take = missing < size ? missing : size;
    const plain = take === size;
    held.fill(0, 0, reach.length);
    let placed = 0;
    while (placed < take) {
      const at = Math.floor(pick() * reach.length);
      if (held[at] === 1) continue;
      held[at] = 1; placed += 1;
    }
    emitByte(shard, plain ? 0 : 1);
    if (!plain) complemented += 1;
    emit(shard, take);
    let last = 0;
    for (let at = 0; at < reach.length; at += 1) {
      if (held[at] === 0) continue;
      emit(shard, at - last); last = at;
    }
  }
  emit(shard, profile.column.length);
  // A crossing is per *block*, not per dictionary entry — two blocks sharing a
  // set are still two distinct things a test entered, and the dense baseline
  // this is measured against pays for both.
  for (const id of profile.column) { emit(shard, id); crossings += sizes[id]; }
  blocks += profile.column.length;
  offsets[module] = startedAt;
  const length = buffer.written + buffer.at - startedAt;
  lengths[module] = length;
  if (length > biggest) biggest = length;
  if ((module & 8191) === 0) mark();
}
for (let shard = 0; shard < SHARDS; shard += 1) { flush(shard); closeSync(handles[shard]); }
mark();
const chunkMs = Date.now() - chunkStarted;

// The reach pool, and the index that says where a module's chunk lives.
{
  const bytes = Buffer.allocUnsafe(CLASSES * (TESTS + 8));
  let at = 0;
  const put = (value) => { let rest = value >>> 0; while (rest >= 0x80) { bytes[at++] = (rest & 0x7f) | 0x80; rest >>>= 7; } bytes[at++] = rest; };
  put(CLASSES);
  for (const members of reachOfClass) { put(members.length); let last = 0; for (const id of members) { put(id - last); last = id; } }
  writeFileSync(join(OUT, 'reach.bin'), bytes.subarray(0, at));
}
{
  const bytes = Buffer.allocUnsafe(MODULES * 8);
  let at = 0;
  for (let module = 0; module < MODULES; module += 1) {
    bytes.writeUInt32LE(offsets[module] >>> 0, at); at += 4;
    bytes.writeUInt32LE(lengths[module], at); at += 4;
  }
  writeFileSync(join(OUT, 'index.bin'), bytes.subarray(0, at));
}

let chunkBytes = 0;
for (let shard = 0; shard < SHARDS; shard += 1) chunkBytes += statSync(shardName(shard)).size;
const reachBytes = statSync(join(OUT, 'reach.bin')).size;
const indexBytes = statSync(join(OUT, 'index.bin')).size;
const total = chunkBytes + reachBytes + indexBytes;

// ---------------------------------------------------------------------------
// 5. Partial load: answer one module by reading its chunk and nothing else.
// ---------------------------------------------------------------------------
const reachFile = readFileSync(join(OUT, 'reach.bin'));
const readVarint = (bytes, state) => {
  let shift = 0; let value = 0;
  for (;;) { const byte = bytes[state.at++]; value |= (byte & 0x7f) << shift; if ((byte & 0x80) === 0) return value >>> 0; shift += 7; }
};
/** Where each class starts in the pool, so a reader seeks rather than scans. */
const classAt = new Float64Array(CLASSES);
{
  const state = { at: 0 };
  readVarint(reachFile, state);
  for (let id = 0; id < CLASSES; id += 1) {
    classAt[id] = state.at;
    const size = readVarint(reachFile, state);
    for (let member = 0; member < size; member += 1) readVarint(reachFile, state);
  }
}
const askStarted = process.hrtime.bigint();
let answered = 0;
let answeredCrossings = 0;
let readBytes = 0;
let wrong = 0;
for (const module of sampled) {
  if (lengths[module] === 0) continue;
  const shard = module % SHARDS;
  const handle = openSync(shardName(shard), 'r');
  const bytes = Buffer.allocUnsafe(lengths[module]);
  readSync(handle, bytes, 0, lengths[module], offsets[module]);
  closeSync(handle);
  readBytes += lengths[module];

  const state = { at: 0 };
  const id = readVarint(bytes, state);
  const poolState = { at: classAt[id] };
  const reachSize = readVarint(reachFile, poolState);
  const reach = [];
  let last = 0;
  for (let member = 0; member < reachSize; member += 1) { last += readVarint(reachFile, poolState); reach.push(last); }
  readBytes += poolState.at - classAt[id];
  const truth = truthOf(module);
  if (truth.length !== reach.length) wrong += 1;
  else for (let at = 0; at < truth.length; at += 1) if (truth[at] !== reach[at]) { wrong += 1; break; }

  const setCount = readVarint(bytes, state);
  const decoded = [];
  for (let at = 0; at < setCount; at += 1) {
    const kind = bytes[state.at++];
    if (kind === 2) { decoded.push(reach.length); continue; }
    const size = readVarint(bytes, state);
    for (let member = 0; member < size; member += 1) readVarint(bytes, state);
    decoded.push(kind === 0 ? size : reach.length - size);
  }
  const width = readVarint(bytes, state);
  let sum = 0;
  for (let at = 0; at < width; at += 1) sum += decoded[readVarint(bytes, state)];
  answeredCrossings += sum;
  answered += 1;
}
const askNanos = Number(process.hrtime.bigint() - askStarted);
mark();

console.log();
console.log(`the store on disk`);
console.log(`  ${count(blocks)} blocks over ${count(reachedModules)} modules, ${count(crossings)} crossings`);
console.log(`  chunks   ${mb(chunkBytes)} in ${SHARDS} shards — ${(chunkBytes / reachedModules).toFixed(0)} bytes a module, ${count(biggest)} the largest`);
console.log(`  reach    ${mb(reachBytes)} — ${count(CLASSES)} classes`);
console.log(`  index    ${mb(indexBytes)} — 8 bytes a module`);
console.log(`  total    ${mb(total)} against ${mb(Math.ceil((blocks * TESTS) / 8))} for a bitmap a block — ${(Math.ceil((blocks * TESTS) / 8) / total).toFixed(1)}x`);
console.log(`  ${((total * 8) / crossings).toFixed(2)} bits a crossing`);
console.log(`  written in ${secs(chunkMs)}`);
console.log();
console.log(`the dictionary`);
console.log(`  ${count(sets)} entries over ${count(blocks)} blocks — ${(blocks / sets).toFixed(1)} blocks an entry`);
console.log(`  ${count(free)} (${((free / sets) * 100).toFixed(1)}%) are the module's reach exactly and carry no members`);
console.log(`  ${count(complemented)} (${((complemented / sets) * 100).toFixed(1)}%) were shorter written as what did NOT run`);
console.log();
console.log(`partial load — 1,000 random modules answered from cold files`);
console.log(`  ${count(answered)} answered, ${count(answeredCrossings)} crossings reported`);
console.log(`  ${wrong} whose decoded reach differs from the closures — ${wrong === 0 ? 'the partition is sound' : 'THE PARTITION IS WRONG'}`);
console.log(`  ${mb(readBytes)} read in all — ${(readBytes / answered).toFixed(0)} bytes a module, ${(((readBytes / answered) / total) * 100).toExponential(2)}% of the store for one answer`);
console.log(`  ${(askNanos / answered / 1e6).toFixed(2)} ms a module`);
console.log();
console.log(`peak rss ${mb(peak)} against a ${mb(CEILING)} ceiling — ${peak <= CEILING ? 'fits' : 'OVER'}   ${secs(Date.now() - started)}`);
