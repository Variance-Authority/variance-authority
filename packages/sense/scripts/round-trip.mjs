#!/usr/bin/env node

/**
 * What a run pays to record what it saw, end to end.
 *
 * Every runner integration in this package ends the same way — `existingCoverage`
 * decodes the index on disk, `mergeCoverage` layers the run over it, and
 * `encodeTestCoverage` writes it back. `native.mjs` times those three separately
 * and attributes their native share; this one times them as the one operation a
 * run actually performs, because the interesting quantity is not any stage's
 * cost but how much of the whole is spent on modules the run never touched.
 *
 * Run:  node scripts/round-trip.mjs [modules] [recut]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeTestCoverage, encodeTestCoverage } from '../dist/test-selection/format.js';
import { openTestCoverage } from '../dist/test-selection/format-view.js';
import { mergeCoverage } from '../dist/test-selection/merge.js';
import { corpusOf, instrumentedSources } from './coverage-corpus.mjs';

if (!process.execArgv.some((flag) => flag.startsWith('--max-old-space-size'))) {
  const { status } = spawnSync(
    process.execPath,
    ['--max-old-space-size=16384', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(status ?? 1);
}

const MODULES = Number(process.argv[2] ?? 20_000);
const RECUT = Number(process.argv[3] ?? 10);

function median(run, runs = 5) {
  const taken = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    run();
    taken.push(performance.now() - started);
  }
  taken.sort((left, right) => left - right);
  return taken[Math.floor(runs / 2)];
}

const built = await instrumentedSources();
const { coverage } = corpusOf(MODULES, built);
const regions = coverage.modules.reduce((sum, module) => sum + module.blocks.length, 0);
const bytes = encodeTestCoverage(coverage);

const recut = coverage.modules.slice(0, RECUT);
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

console.log(
  `${MODULES.toLocaleString()} modules, ${regions.toLocaleString()} regions, ` +
    `${(bytes.length / 1_048_576).toFixed(1)} MB on disk\n` +
    `a run that re-recorded ${RECUT} of them — ${((100 * RECUT) / MODULES).toFixed(3)}% of the index\n`,
);

const opened = median(() => openTestCoverage(bytes));
const decoded = median(() => decodeTestCoverage(bytes));
const previous = decodeTestCoverage(bytes);
const merged = median(() => mergeCoverage(previous, layer));
const model = mergeCoverage(previous, layer);
const encoded = median(() => encodeTestCoverage(model));

const total = decoded + merged + encoded;
const row = (label, spent) =>
  console.log(`  ${label.padEnd(34)} ${spent.toFixed(0).padStart(6)} ms   ${((100 * spent) / total).toFixed(1).padStart(5)}%`);

row('decode the index', decoded);
row('merge the run over it', merged);
row('encode it back', encoded);
console.log(`  ${'—'.repeat(34)} ${total.toFixed(0).padStart(6)} ms`);
console.log(`\n  opening the file instead of decoding it  ${opened.toFixed(2)} ms  ` +
  `(${(decoded / opened).toFixed(0)}x cheaper, and it is the same file)`);
console.log(
  `\n  per re-recorded module        ${(total / RECUT).toFixed(1)} ms\n` +
    `  per carried module            ${((total / (MODULES - RECUT)) * 1000).toFixed(1)} µs` +
    `   x ${(MODULES - RECUT).toLocaleString()} carried`,
);
