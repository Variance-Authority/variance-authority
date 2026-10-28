#!/usr/bin/env node

/**
 * What a run pays to record what it saw, end to end.
 *
 * Every runner integration in this package ends the same way: `layCoverage` lays
 * the run over the record on disk, bytes in and bytes out, and never decodes the
 * record it carries. This times that one operation against what decoding the
 * same record would cost, because the interesting quantity is how much of the
 * whole is spent on modules the run never touched.
 *
 * Run:  node scripts/round-trip.mjs [modules] [recut]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeTestCoverage, encodeTestCoverage } from '../dist/test-selection/format.js';
import { layCoverage } from '../dist/test-selection/format-layer.js';
import { openTestCoverage } from '../dist/test-selection/format-view.js';
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
const laid = median(() => layCoverage(bytes, layer, new Map()));

console.log(`  lay the run over the record     ${laid.toFixed(0).padStart(6)} ms`);
console.log(`  decode the record instead       ${decoded.toFixed(0).padStart(6)} ms`);
console.log(`  open the record instead         ${opened.toFixed(2).padStart(6)} ms`);
console.log(
  `\n  per re-recorded module        ${(laid / RECUT).toFixed(1)} ms\n` +
    `  per carried module            ${((laid / (MODULES - RECUT)) * 1000).toFixed(1)} µs` +
    `   x ${(MODULES - RECUT).toLocaleString()} carried`,
);
