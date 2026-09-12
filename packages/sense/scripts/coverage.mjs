#!/usr/bin/env node

/**
 * What the coverage snapshot costs to write, to open, to query, and to fold.
 *
 * The module record store is one module's worth of evidence; this is the whole
 * repository's, and it is the structure every run ends by rewriting. Four
 * numbers decide whether that is affordable at two hundred thousand modules:
 * the bytes the snapshot holds, the time to encode them, the time to answer a
 * diff off them, and the time to merge a run into the one before it.
 *
 *   shape   — every product file in this repository, instrumented for real and
 *             its regions cut for real. The blocks per module, the line spans
 *             and the digests are the ones this source produces; a generated
 *             module would answer a question nobody asked.
 *   size    — the snapshot's sections, largest first, so the bytes are attributed
 *             to a column rather than to the format.
 *   open    — `openTestCoverage` against `decodeTestCoverage`: the first parses a
 *             section index and wraps the buffer, the second materializes the
 *             logical model. The gap is the reason selection reads views.
 *   select  — one changed file answered off the columns, which is what a build
 *             actually asks.
 *   merge   — the read-modify-write at the end of a run, timed at two sizes. The
 *             ratio between them is the growth: a merge that indexes both sides
 *             doubles when the input doubles, one that scans inside a scan
 *             quadruples.
 *   layer   — the same read-modify-write in the shape every run after the first
 *             has: a whole index with a handful of modules re-recorded over it.
 *             What it reports is how many modules came through as the objects
 *             they already were, because a merge that rebuilds what it carries
 *             pays for the repository to change ten files of it.
 *
 * Crossings are drawn clustered rather than uniformly — a test that enters a
 * module enters most of its regions, and neighbouring modules are entered by
 * neighbouring tests — because that is the shape a real snapshot has and the
 * shape any future codec would be judged against. The ratios are reported back
 * from the generated data, never assumed.
 *
 * Runs itself again under `--expose-gc` and a raised heap ceiling when it was
 * not started with them: the object model is one of the measurements, and a
 * heap sampled without a collection in hand reports whatever the collector last
 * happened to do.
 *
 * Run:  node scripts/coverage.mjs
 *       node scripts/coverage.mjs 50000
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeTestCoverage, encodeTestCoverage } from '../dist/test-selection/format.js';
import { openTestCoverage } from '../dist/test-selection/format-view.js';
import { mergeCoverage } from '../dist/test-selection/merge.js';
import { selectTestFilesFromView } from '../dist/test-selection/select.js';
import { TEST_SHARE, corpusOf, instrumentedSources } from './coverage-corpus.mjs';

if (typeof globalThis.gc !== 'function') {
  const { status } = spawnSync(
    process.execPath,
    ['--expose-gc', '--max-old-space-size=16384', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(status ?? 1);
}

const MODULES = Number(process.argv[2] ?? 20_000);
const TESTS = Math.max(2, Math.round(MODULES * TEST_SHARE));

const mb = (bytes) => bytes / 1_048_576;
const ms = (from, to) => Number(to - from) / 1e6;
const since = () => {
  const from = process.hrtime.bigint();
  return () => ms(from, process.hrtime.bigint());
};

const built = await instrumentedSources();
if (built.length === 0) {
  console.log('no product source instrumented; run `yarn build` first');
  process.exit(1);
}
const coverageOf = (count) => corpusOf(count, built).coverage;

const heap = () => {
  globalThis.gc();
  return process.memoryUsage().heapUsed;
};

// The high-water mark the kernel kept, which is the number a run dies on. It
// only rises, so the difference across a step is how far that step pushed the
// process past everything before it — and a step that allocates a second copy
// of what it was handed shows up here and nowhere else.
const WATERMARK = process.platform === 'darwin' ? 1 : 1024;
const watermark = () => process.resourceUsage().maxRSS * WATERMARK;

let clock = since();
const before = heap();
const coverage = coverageOf(MODULES);
const grew = heap() - before;
const blocks = coverage.modules.reduce((sum, module) => sum + module.blocks.length, 0);
const crossings = coverage.modules.reduce(
  (sum, module) => sum + module.blocks.reduce((count, block) => count + block.testFiles.length, 0),
  0,
);
console.log(
  `\n${built.length} modules of this repository instrumented, repeated to ${MODULES}\n` +
    `  shape   ${(blocks / MODULES).toFixed(1)} regions a module, ` +
    `${(crossings / blocks).toFixed(2)} crossings a region, ${TESTS} test files\n` +
    `  totals  ${blocks} regions, ${crossings} crossings\n` +
    `  model   ${mb(grew).toFixed(0)} MB of heap as objects, built in ${clock().toFixed(0)} ms`,
);

const writing = watermark();
clock = since();
const encoded = encodeTestCoverage(coverage);
const wrote = clock();
const spent = watermark() - writing;
console.log(
  `\nsnapshot\n` +
    `  encode  ${mb(encoded.byteLength).toFixed(1)} MB in ${wrote.toFixed(0)} ms ` +
    `(${((wrote * 1000) / MODULES).toFixed(1)} us a module)\n` +
    `  cost    ${mb(spent).toFixed(0)} MB past the high-water mark it was handed, ` +
    `against ${mb(grew).toFixed(0)} MB of model\n` +
    `  ratio   ${(encoded.byteLength / grew).toFixed(2)}x the heap the same snapshot costs as objects\n` +
    `  each    ${(encoded.byteLength / MODULES).toFixed(0)} B a module, ` +
    `${(encoded.byteLength / blocks).toFixed(1)} B a region, ` +
    `${(encoded.byteLength / crossings).toFixed(1)} B a crossing`,
);

const header = JSON.parse(
  encoded.toString('utf8', 4, 4 + encoded.readUInt32LE(0)).replace(/\0+$/, ''),
);
console.log('\nsections, largest first');
for (const section of [...header.sections].sort((left, right) => right.length - left.length)) {
  if (section.length === 0) continue;
  const share = (section.length / encoded.byteLength) * 100;
  if (share < 0.1) continue;
  console.log(
    `  ${mb(section.length).toFixed(1).padStart(7)} MB  ${share.toFixed(1).padStart(5)}%  ${section.name}`,
  );
}

// The open is a fraction of a millisecond measured beside a 248 MB object
// model, so a collection of the model's garbage landing inside the sample is
// the whole of it. Collect first and time the open.
globalThis.gc();
clock = since();
const view = openTestCoverage(encoded);
const opened = clock();
clock = since();
const decoded = decodeTestCoverage(encoded);
const wholeDecode = clock();
console.log(
  `\nreading it back\n` +
    `  open    ${opened.toFixed(1)} ms, a section index and ${view.blockKind.length} regions as views\n` +
    `  decode  ${wholeDecode.toFixed(0)} ms for the logical model, ${(wholeDecode / opened).toFixed(0)}x the open`,
);
if (decoded.modules.length !== MODULES) throw new Error('decode lost modules');

// One changed line in the middle of a generated module, asked the way a build asks.
const changed = coverage.modules[Math.floor(MODULES / 2)].file;
const diff = `diff --git a/${changed} b/${changed}\n--- a/${changed}\n+++ b/${changed}\n@@ -1,1 +1,1 @@\n-a\n+b\n`;
clock = since();
const selected = selectTestFilesFromView(view, diff);
console.log(`  select  ${clock().toFixed(1)} ms to answer one changed file, ${selected.length} tests entered`);

console.log('\nmerging a run into the one before it');
let last;
for (const count of [Math.round(MODULES / 4), Math.round(MODULES / 2), MODULES]) {
  const previous = coverageOf(count);
  const current = coverageOf(count);
  clock = since();
  const merged = mergeCoverage(previous, current);
  const took = clock();
  const growth = last === undefined ? '' : `, ${(took / last).toFixed(1)}x the run half its size`;
  console.log(`  ${String(count).padStart(7)} modules  ${took.toFixed(0)} ms${growth}`);
  last = took;
  if (merged.modules.length !== count) throw new Error('merge lost modules');
}

// Every run after the first is this shape: an index found on disk, and the
// handful of modules a build re-transpiled recorded over it. The equal-size
// merge above is the rarer one, and the only one a merge that rebuilds what it
// carries survives — there the rebuilding is the work it was asked for, and
// here it is all of it. What the line below reports is how much of the index
// came through as the objects it already was.
const RE_RECORDED = 10;
const recut = coverage.modules.slice(0, RE_RECORDED);
const ran = new Set(recut.flatMap((module) => module.blocks.flatMap((block) => block.testFiles)));
const layer = {
  version: coverage.version,
  instrumentation: coverage.instrumentation,
  commit: 'b'.repeat(40),
  tests: coverage.tests.filter((test) => ran.has(test.file)),
  modules: recut.map((module) => ({
    ...module,
    blocks: module.blocks.map((block) => ({ ...block, testFiles: [...block.testFiles] })),
  })),
};
const held = new Set(coverage.modules);
const standing = heap();
clock = since();
const layered = mergeCoverage(coverage, layer);
const layering = clock();
const cost = heap() - standing;
const carried = layered.modules.filter((module) => held.has(module)).length;
if (layered.modules.length !== MODULES) throw new Error('layering lost modules');
console.log(
  `\nlayering a run onto the index it found\n` +
    `  ${RE_RECORDED} modules and ${layer.tests.length} tests re-recorded over ${MODULES}\n` +
    `  ${layering.toFixed(0)} ms, ${mb(cost).toFixed(0)} MB of heap\n` +
    `  ${carried} of ${MODULES - RE_RECORDED} carried modules came through untouched`,
);

console.log(
  `\nat 200000 modules, from the bytes measured here\n` +
    `  snapshot  ${mb((encoded.byteLength / MODULES) * 200_000).toFixed(0)} MB\n` +
    `  encode    ${((wrote / MODULES) * 200).toFixed(1)} s\n`,
);
