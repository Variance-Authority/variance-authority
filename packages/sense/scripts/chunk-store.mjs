/**
 * The store the measurements actually support, built from a real snapshot.
 *
 * `shape-sweep.mjs` killed the design this replaces. The claim was
 * `T(v) = R(m) ∩ C(v)` with `C` drawn from a small pool shared across the
 * repository; on real code the pool grew *faster* than the relation it was
 * meant to factor (exponent 1.15) and ended up larger than simply interning
 * every distinct set. That half is gone. Three things measured on the same real
 * snapshot survived it, and this is built out of those and nothing else:
 *
 * 1. **Reach is a real factor and it saturates.** 935 modules share 356 distinct
 *    reach sets, and over a 16x growth in the suite the count grew 9.4x —
 *    exponent 0.81. It is also the only factor selection needs, and it is
 *    computable from the import graph with nothing instrumented.
 * 2. **The redundancy is inside a module, not across the repository.** 35.7
 *    blocks a module collapse to 4.0 distinct sets. A block's identity is
 *    2.30 bits, not 32.
 * 3. **A set is cheap in its module's own coordinates.** Naming members by
 *    position within the module's reach, and writing whichever of the set or
 *    its complement is shorter, took the member column from 33 KB to 9 KB —
 *    and 27.1% of blocks cost nothing at all, being the reach exactly.
 *
 * So: one global reach pool, and then **one independent chunk per module**. A
 * chunk names its reach by id and holds its own little dictionary. Nothing in a
 * chunk points at another chunk, which is the property that answers *partial
 * load*: to say what a module's blocks did, read that module's chunk and the
 * one reach set it names. Never the file.
 *
 * Written, read back, and checked block by block against what the run recorded.
 * A store that is smaller and wrong is not a result.
 *
 *   node packages/sense/scripts/chunk-store.mjs [root] [coverage.bin]
 */

import { readTestCoverage, testCoverageFile } from '../dist/test-selection/index.js';

const ROOT = process.argv[2] ?? process.cwd();
const FILE = process.argv[3] ?? testCoverageFile(ROOT);

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
let peak = process.memoryUsage().rss;
const mark = () => { const now = process.memoryUsage().rss; if (now > peak) peak = now; };

const coverage = await readTestCoverage(FILE);
if (coverage === undefined) {
  console.error(`no snapshot at ${FILE}`);
  process.exit(1);
}

const testId = new Map();
for (const test of coverage.tests) if (!testId.has(test.file)) testId.set(test.file, testId.size);
for (const module of coverage.modules) {
  for (const block of module.blocks) for (const file of block.testFiles) if (!testId.has(file)) testId.set(file, testId.size);
}
const TESTS = testId.size;

/** A growable byte sink; varints because most numbers here are small. */
const sink = () => {
  let bytes = new Uint8Array(1 << 16);
  let at = 0;
  const room = (more) => {
    if (at + more <= bytes.length) return;
    const grown = new Uint8Array(Math.max(bytes.length * 2, at + more));
    grown.set(bytes.subarray(0, at));
    bytes = grown;
  };
  return {
    varint(value) {
      room(5);
      let rest = value >>> 0;
      while (rest >= 0x80) { bytes[at++] = (rest & 0x7f) | 0x80; rest >>>= 7; }
      bytes[at++] = rest;
    },
    byte(value) { room(1); bytes[at++] = value & 0xff; },
    get length() { return at; },
    done() { return bytes.subarray(0, at); },
  };
};
const source = (bytes) => {
  let at = 0;
  return {
    varint() {
      let shift = 0;
      let value = 0;
      for (;;) {
        const byte = bytes[at++];
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return value >>> 0;
        shift += 7;
      }
    },
    byte() { return bytes[at++]; },
    get at() { return at; },
    seek(to) { at = to; },
    get done() { return at >= bytes.length; },
  };
};

// ---------------------------------------------------------------------------
// The reach pool: one entry per distinct set of tests that reach some module,
// as ascending test ids delta-coded. Global, shared, and the only thing a chunk
// looks outside itself for.
// ---------------------------------------------------------------------------
const reachId = new Map();
const reachMembers = [];
const internReach = (ids) => {
  const at = ids.join(',');
  const found = reachId.get(at);
  if (found !== undefined) return found;
  const id = reachMembers.length;
  reachId.set(at, id);
  reachMembers.push(ids);
  return id;
};

const chunks = [];
let blocks = 0;
let crossings = 0;
let dictionaryEntries = 0;
let freeSets = 0;
let complemented = 0;

for (const module of coverage.modules) {
  if (!module.instrumented) continue;

  const reachSet = new Set();
  for (const block of module.blocks) for (const file of block.testFiles) reachSet.add(testId.get(file));
  const reach = [...reachSet].sort((left, right) => left - right);
  const rank = new Map();
  for (const id of reach) rank.set(id, rank.size);
  const reachOf = internReach(reach);

  // The module's own dictionary. A block's set is looked up by content, so the
  // thirty-five blocks of an average module land on four entries.
  const localId = new Map();
  const localSets = [];
  const column = [];
  for (const block of module.blocks) {
    blocks += 1;
    crossings += block.testFiles.length;
    const positions = block.testFiles.map((file) => rank.get(testId.get(file))).sort((left, right) => left - right);
    const at = positions.join(',');
    let id = localId.get(at);
    if (id === undefined) {
      id = localSets.length;
      localId.set(at, id);
      localSets.push(positions);
      dictionaryEntries += 1;
    }
    column.push(id);
  }

  const out = sink();
  out.varint(reachOf);
  out.varint(localSets.length);
  for (const positions of localSets) {
    // Whichever side is shorter. `kind` is the marker: 0 plain, 1 complement,
    // 2 the reach exactly — which carries no members at all.
    const size = positions.length;
    const missing = reach.length - size;
    if (missing === 0) { out.byte(2); freeSets += 1; continue; }
    if (missing < size) {
      complemented += 1;
      out.byte(1);
      out.varint(missing);
      const held = new Uint8Array(reach.length);
      for (const position of positions) held[position] = 1;
      let last = 0;
      for (let position = 0; position < reach.length; position += 1) {
        if (held[position] === 1) continue;
        out.varint(position - last);
        last = position;
      }
      continue;
    }
    out.byte(0);
    out.varint(size);
    let last = 0;
    for (const position of positions) { out.varint(position - last); last = position; }
  }
  out.varint(column.length);
  for (const id of column) out.varint(id);
  chunks.push({ file: module.file, bytes: out.done() });
  if (chunks.length % 200 === 0) mark();
}
mark();

// ---------------------------------------------------------------------------
// Read back, and check. Every block, against what the run recorded.
// ---------------------------------------------------------------------------
const readChunk = (bytes) => {
  const input = source(bytes);
  const reach = reachMembers[input.varint()];
  const count = input.varint();
  const sets = [];
  for (let index = 0; index < count; index += 1) {
    const kind = input.byte();
    if (kind === 2) { sets.push(reach.slice()); continue; }
    const size = input.varint();
    const positions = [];
    let last = 0;
    for (let member = 0; member < size; member += 1) { last += input.varint(); positions.push(last); }
    if (kind === 0) { sets.push(positions.map((position) => reach[position])); continue; }
    const held = new Uint8Array(reach.length).fill(1);
    for (const position of positions) held[position] = 0;
    const out = [];
    for (let position = 0; position < reach.length; position += 1) if (held[position] === 1) out.push(reach[position]);
    sets.push(out);
  }
  const width = input.varint();
  const column = new Int32Array(width);
  for (let index = 0; index < width; index += 1) column[index] = input.varint();
  return { sets, column };
};

let checked = 0;
let missed = 0;
let invented = 0;
let cursor = 0;
const queryStarted = process.hrtime.bigint();
for (const module of coverage.modules) {
  if (!module.instrumented) continue;
  const { sets, column } = readChunk(chunks[cursor].bytes);
  cursor += 1;
  for (let index = 0; index < module.blocks.length; index += 1) {
    const want = new Set(module.blocks[index].testFiles.map((file) => testId.get(file)));
    const got = new Set(sets[column[index]]);
    for (const id of want) if (!got.has(id)) missed += 1;
    for (const id of got) if (!want.has(id)) invented += 1;
    checked += 1;
  }
}
const queryNanos = Number(process.hrtime.bigint() - queryStarted);
mark();

let chunkBytes = 0;
let biggest = 0;
for (const chunk of chunks) { chunkBytes += chunk.bytes.length; if (chunk.bytes.length > biggest) biggest = chunk.bytes.length; }
let reachBytes = 0;
{
  const out = sink();
  out.varint(reachMembers.length);
  for (const members of reachMembers) {
    out.varint(members.length);
    let last = 0;
    for (const id of members) { out.varint(id - last); last = id; }
  }
  reachBytes = out.length;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const pct = (part, whole) => (whole === 0 ? '0.0' : ((part / whole) * 100).toFixed(1));
const dense = Math.ceil((blocks * TESTS) / 8);

console.log(`snapshot ${FILE}`);
console.log(`  ${TESTS} tests, ${chunks.length} modules, ${blocks.toLocaleString()} blocks, ${crossings.toLocaleString()} crossings`);
console.log();
console.log(`the store`);
console.log(`  reach pool  ${kb(reachBytes)} — ${reachMembers.length} distinct reaches, delta coded`);
console.log(`  chunks      ${kb(chunkBytes)} — ${chunks.length} of them, ${(chunkBytes / chunks.length).toFixed(0)} bytes each on average, ${biggest} the largest`);
console.log(`  total       ${kb(reachBytes + chunkBytes)} against ${kb(dense)} for a bitmap a block — ${(dense / (reachBytes + chunkBytes)).toFixed(1)}x`);
console.log(`  ${((reachBytes + chunkBytes) * 8 / crossings).toFixed(2)} bits a crossing`);
console.log();
console.log(`the dictionary`);
console.log(`  ${dictionaryEntries.toLocaleString()} entries over ${blocks.toLocaleString()} blocks — ${(blocks / dictionaryEntries).toFixed(1)} blocks an entry`);
console.log(`  ${freeSets.toLocaleString()} (${pct(freeSets, dictionaryEntries)}%) are the module's reach exactly and carry no members`);
console.log(`  ${complemented.toLocaleString()} (${pct(complemented, dictionaryEntries)}%) were shorter written as what did NOT run`);
console.log();
console.log(`read back`);
console.log(`  ${checked.toLocaleString()} blocks checked — ${missed} crossings the store lost, ${invented} it invented`);
console.log(`  ${missed === 0 && invented === 0 ? 'the store answers exactly what the run recorded' : 'THE STORE IS WRONG'}`);
console.log(`  ${(queryNanos / 1e6).toFixed(0)} ms to decode and check every chunk — ${(queryNanos / chunks.length / 1000).toFixed(1)} us a module`);
console.log();
console.log(`peak rss ${(peak / 1_048_576).toFixed(1)} MB   ${since()}`);
