/**
 * What it costs to *record* one test file, at the scale the repository is.
 *
 * Everything measured so far was the snapshot side — the crossing relation once
 * it is already a file. This is the other half, and the one the goal names: a
 * worker is live, the probes are firing, and the counters are in the heap of a
 * process that also has the runner, the module registry and the test in it. If
 * recording a forty-thousand-module closure costs more than the ceiling, no
 * store format downstream matters.
 *
 * Nothing here is a model of the recording path. The factory is the one Jest
 * installs (`jest-globals.cjs`), the increment is the one the instrumenter
 * emits (`instrument/index.ts`), the frame is `encodeJournal` and the read-back
 * is `scanJournal`. The only synthetic thing is *which* modules — and their
 * shapes are sampled from the real snapshot rather than guessed:
 *
 *   - blocks a module has: the empirical distribution over 935 real modules
 *   - blocks of it one test enters: the empirical distribution over the real
 *     crossings, which is strongly bimodal (median 6.7%, mean 27.7%) and so is
 *     sampled, never averaged
 *
 * Four stages, each weighed: record, encode, write, read back. The read back is
 * not a formality — it is checked ordinal by ordinal against what was counted,
 * because a journal that is smaller and wrong is not a result.
 *
 *   node --expose-gc packages/sense/scripts/record-load.mjs <snapshot> [modules] [files]
 */

import { writeFileSync, readFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readTestCoverage } from '../dist/test-selection/index.js';

const require = createRequire(import.meta.url);
const install = require('../dist/test-selection/jest-globals.cjs');
const { encodeJournal, scanJournal } = require('../dist/test-selection/journal-format.cjs');

const SNAPSHOT = process.argv[2];
const MODULES = Number(process.argv[3] ?? 40_000);
const FILES = Number(process.argv[4] ?? 8);
const OUT = process.argv[5] ?? `${process.env.TMPDIR ?? '/tmp'}/va-record-load`;
const CEILING = Number(process.env.CEILING ?? 600) * 1_048_576;

/** Mirrors `EVALUATING` in `../src/instrument/index.ts`. */
const EVALUATING = 0x80000000;

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const rss = () => process.memoryUsage().rss;
let peak = rss();
const mark = () => { const now = rss(); if (now > peak) peak = now; return now; };
const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const settle = () => { if (global.gc !== undefined) { global.gc(); global.gc(); } return rss(); };

// ---------------------------------------------------------------------------
// The shapes, taken from a real run rather than invented.

const coverage = await readTestCoverage(SNAPSHOT);
if (coverage === undefined) {
  console.error(`no snapshot at ${SNAPSHOT}`);
  process.exit(1);
}

/** Every real module's block count, as a bag to draw from. */
const blockCounts = coverage.modules.map((module) => module.blocks.length);
/** Every real (test, module) crossing's share of that module's blocks. */
const shares = [];
for (const module of coverage.modules) {
  const perTest = new Map();
  for (const block of module.blocks) for (const file of block.testFiles) perTest.set(file, (perTest.get(file) ?? 0) + 1);
  for (const count of perTest.values()) shares.push(count / module.blocks.length);
}
coverage.modules.length = 0;
coverage.tests.length = 0;
settle();

console.log(`shapes from ${SNAPSHOT.split('/').pop()}: ${blockCounts.length} module block counts, ${shares.length.toLocaleString()} crossing shares`);

/** Seeded, so a re-run is the same run. */
let state = 0x9e3779b9;
const random = () => {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return state / 0x100000000;
};
const draw = (bag) => bag[(random() * bag.length) | 0];

// ---------------------------------------------------------------------------
// Stage 1: record. The factory is Jest's, the increment is the instrumenter's.

const base = settle();
console.log(`\nbaseline rss ${mb(base)}`);

const factory = install();
/** What each module will be asked for, and what of it will be entered. */
const counts = new Int32Array(MODULES);
const entered = new Int32Array(MODULES);
for (let module = 0; module < MODULES; module += 1) {
  const blocks = draw(blockCounts);
  counts[module] = blocks;
  const share = draw(shares);
  entered[module] = Math.max(1, Math.round(blocks * share));
}
let blocksTotal = 0;
let crossingsTotal = 0;
for (let module = 0; module < MODULES; module += 1) { blocksTotal += counts[module]; crossingsTotal += entered[module]; }

const recordStarted = Date.now();
let increments = 0;
for (let module = 0; module < MODULES; module += 1) {
  // What the emitted header does, once per module: resolve the counter array.
  const counters = factory(module, counts[module]);
  // What `__va(i)` does, once per block execution. A block a test enters runs
  // more than once — a loop body, a component rendered per row — so the real
  // shape is a handful of increments per entered block, not one.
  const blocks = counts[module];
  const hits = entered[module];
  const evaluating = module % 7 === 0 ? EVALUATING : 0;
  for (let hit = 0; hit < hits; hit += 1) {
    const ordinal = ((hit * 2654435761) >>> 0) % blocks;
    const times = 1 + ((ordinal * 7) % 5);
    for (let again = 0; again < times; again += 1) {
      counters[ordinal] = (counters[ordinal] + 1) | evaluating;
      increments += 1;
    }
  }
  if ((module & 1023) === 0) mark();
}
const recordMs = Date.now() - recordStarted;
const afterRecord = mark();
const held = settle();

console.log(`\nrecording one test file that enters ${MODULES.toLocaleString()} modules`);
console.log(`  ${blocksTotal.toLocaleString()} blocks in those modules, ${crossingsTotal.toLocaleString()} of them entered (${((crossingsTotal / blocksTotal) * 100).toFixed(1)}%)`);
console.log(`  ${increments.toLocaleString()} probe increments in ${recordMs} ms — ${((recordMs * 1e6) / increments).toFixed(0)} ns an increment`);
console.log(`  rss ${mb(afterRecord)} at the end of the file, ${mb(held)} once settled`);
console.log(`  the counters themselves: ${mb(held - base)} for ${MODULES.toLocaleString()} arrays — ${((held - base) / MODULES).toFixed(0)} bytes a module`);

// ---------------------------------------------------------------------------
// Stage 2: encode. This is the moment a worker is largest.

const encodeStarted = Date.now();
const frame = encodeJournal('/repo/src/feature/thing.test.ts', factory.modules);
const encodeMs = Date.now() - encodeStarted;
const afterEncode = mark();

console.log(`\ndraining it`);
console.log(`  ${frame.length.toLocaleString()} bytes in ${encodeMs} ms — ${((frame.length / crossingsTotal) * 8).toFixed(2)} bits a crossing`);
console.log(`  rss ${mb(afterEncode)} while the frame was being built`);

// ---------------------------------------------------------------------------
// Stage 3: read it back, and check every ordinal against what was counted.

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/one.vajrn`, frame);

let rows = 0;
let checked = 0;
let wrong = 0;
let missing = 0;
scanJournal(readFileSync(`${OUT}/one.vajrn`), {
  test: () => {},
  module: (id, hits, shared) => {
    rows += 1;
    const counters = factory.modules.get(id);
    if (counters === undefined) { missing += 1; return; }
    const truth = [];
    for (let ordinal = 0; ordinal < counters.length; ordinal += 1) if (counters[ordinal] > 0) truth.push(ordinal);
    if (truth.length !== hits.length) { wrong += 1; return; }
    for (let index = 0; index < truth.length; index += 1) if (truth[index] !== hits[index]) { wrong += 1; return; }
    checked += truth.length;
    const sharedTruth = [];
    for (let ordinal = 0; ordinal < counters.length; ordinal += 1) if (counters[ordinal] >= EVALUATING) sharedTruth.push(ordinal);
    if (sharedTruth.length !== shared.length) wrong += 1;
  },
});
mark();

console.log(`\nread back`);
console.log(`  ${rows.toLocaleString()} module rows, ${checked.toLocaleString()} ordinals checked against the counters`);
console.log(`  ${wrong} rows that differ, ${missing} rows for a module that was never recorded`);

// ---------------------------------------------------------------------------
// Stage 4: a whole suite of such files, on disk and through the reporter.

const perFile = frame.length;
console.log(`\na suite of ${FILES.toLocaleString()} such files`);
console.log(`  ${mb(perFile * FILES)} of journals on disk`);

const many = Math.min(FILES, 64);
for (let file = 0; file < many; file += 1) writeFileSync(`${OUT}/${file}.vajrn`, frame);
const scanStarted = Date.now();
let scannedRows = 0;
let scannedOrdinals = 0;
for (let file = 0; file < many; file += 1) {
  scanJournal(readFileSync(`${OUT}/${file}.vajrn`), {
    test: () => {},
    module: (_id, hits) => { scannedRows += 1; scannedOrdinals += hits.length; },
  });
  mark();
}
const scanMs = Date.now() - scanStarted;
const afterScan = mark();
console.log(`  ${many} of them read in ${scanMs} ms — ${((scanMs / many)).toFixed(1)} ms a file, ${scannedRows.toLocaleString()} rows, ${scannedOrdinals.toLocaleString()} ordinals`);
console.log(`  ${((scanMs / many) * FILES / 1000).toFixed(1)}s to read all ${FILES.toLocaleString()}, at rss ${mb(afterScan)}`);

let bytes = 0;
for (let file = 0; file < many; file += 1) bytes += statSync(`${OUT}/${file}.vajrn`).size;
rmSync(OUT, { recursive: true, force: true });

console.log(`\npeak rss ${mb(peak)} against a ${(CEILING / 1_048_576).toFixed(0)} MB ceiling — ${peak <= CEILING ? 'fits' : 'OVER'}   ${since()}`);

// ---------------------------------------------------------------------------
// Stage 5: where the bytes went, and what the store's own trick would do here.
//
// A suite of journals is the one number above that looks bad, so it gets taken
// apart rather than reported. The varint rules are `Writer`'s; nothing here is
// written, only weighed.

const widthOf = (value) => (value < 0x80 ? 1 : value < 0x4000 ? 2 : value < 0x200000 ? 3 : value < 0x10000000 ? 4 : 5);

let idBytes = 0;
let countBytes = 0;
let hitBytes = 0;
let sharedBytes = 0;
let loadedBytes = 0;
/** The same rows if a mostly-entered module wrote its absences instead. */
let complementBytes = 0;
let complemented = 0;
let exact = 0;

for (const [id, counters] of factory.modules) {
  idBytes += 1 + widthOf(id);
  const hits = [];
  const shares = [];
  for (let ordinal = 0; ordinal < counters.length; ordinal += 1) {
    if (counters[ordinal] === 0) continue;
    hits.push(ordinal);
    if (counters[ordinal] >= EVALUATING) shares.push(ordinal);
  }
  countBytes += widthOf(hits.length) + widthOf(shares.length);
  let last = 0;
  let plain = 0;
  for (const ordinal of hits) { plain += widthOf(ordinal - last); last = ordinal; }
  hitBytes += plain;
  last = 0;
  for (const ordinal of shares) { sharedBytes += widthOf(ordinal - last); last = ordinal; }
  loadedBytes += 1;

  // Whichever of the set and its complement is shorter, plus a byte to say
  // which — the same choice `chunk-store.mjs` measured on the snapshot side,
  // where 27.1% of blocks turned out to be free.
  const absent = counters.length - hits.length;
  if (absent === 0) { complementBytes += 1; exact += 1; continue; }
  let missing = 0;
  last = 0;
  for (let ordinal = 0; ordinal < counters.length; ordinal += 1) {
    if (counters[ordinal] !== 0) continue;
    missing += widthOf(ordinal - last);
    last = ordinal;
  }
  if (missing + widthOf(absent) < plain + widthOf(hits.length)) { complementBytes += 1 + widthOf(absent) + missing; complemented += 1; }
  else complementBytes += 1 + widthOf(hits.length) + plain;
}

const accounted = idBytes + countBytes + hitBytes + sharedBytes + loadedBytes;
const share = (part) => `${((part / frame.length) * 100).toFixed(1)}%`;
console.log(`\nwhere a ${frame.length.toLocaleString()} byte frame goes`);
console.log(`  ${idBytes.toLocaleString()} bytes of module ids and tags (${share(idBytes)})`);
console.log(`  ${countBytes.toLocaleString()} bytes of per-row counts (${share(countBytes)})`);
console.log(`  ${hitBytes.toLocaleString()} bytes of entered ordinals (${share(hitBytes)})`);
console.log(`  ${sharedBytes.toLocaleString()} bytes of shared ordinals (${share(sharedBytes)})`);
console.log(`  ${loadedBytes.toLocaleString()} bytes of empty loaded rows (${share(loadedBytes)})`);
console.log(`  ${accounted.toLocaleString()} accounted for, ${(frame.length - accounted).toLocaleString()} in the header and the file name`);

const wouldBe = complementBytes + idBytes + sharedBytes + loadedBytes;
console.log(`\n  writing whichever of a row and its absences is shorter:`);
console.log(`    ${complemented.toLocaleString()} rows would flip, ${exact.toLocaleString()} entered every block they had`);
console.log(`    ${wouldBe.toLocaleString()} bytes against ${frame.length.toLocaleString()} — ${(((frame.length - wouldBe) / frame.length) * 100).toFixed(1)}% off, ${mb(wouldBe * FILES)} a suite against ${mb(perFile * FILES)}`);
