/**
 * What instrumentation adds to a worker that is already holding the repository.
 *
 * The counters are the obvious cost and they are the small one. A worker that
 * runs a test reaching forty thousand modules has *evaluated* forty thousand
 * modules: their source, their functions, their closures, the registry entry
 * for each. That bill is the repository's and is paid whether or not anything
 * is instrumented. The question the ceiling actually asks is the marginal one —
 * how much *more* the same worker costs with probes in it.
 *
 * So both are run, as real Node processes importing real files, and the answer
 * is the difference. Two variants of one generated tree:
 *
 *   plain         the modules as written
 *   instrumented  the same modules through `instrument()`, counted by the
 *                 factory Jest installs, drained by `encodeJournal`
 *
 * Module shapes are drawn from the real snapshot's block-count distribution, so
 * a generated module has as many branch regions as a real one does.
 *
 *   node packages/sense/scripts/worker-load.mjs <snapshot> [modules] [fanout]
 */

import { writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readTestCoverage } from '../dist/test-selection/index.js';
import { instrument } from '../dist/instrument/index.js';

const SNAPSHOT = process.argv[2];
const MODULES = Number(process.argv[3] ?? 10_000);
/** How many modules one module imports — a real graph is not a chain. */
const FANOUT = Number(process.argv[4] ?? 4);
const OUT = `${process.env.TMPDIR ?? '/tmp'}/va-worker-load`;
const CEILING = Number(process.env.CEILING ?? 600) * 1_048_576;

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;

const coverage = await readTestCoverage(SNAPSHOT);
if (coverage === undefined) { console.error(`no snapshot at ${SNAPSHOT}`); process.exit(1); }
const blockCounts = coverage.modules.map((module) => module.blocks.length);
coverage.modules.length = 0;
coverage.tests.length = 0;

let state = 0x9e3779b9;
const random = () => {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return state / 0x100000000;
};

/**
 * A module with `blocks` branch regions in it, importing `imports` others.
 *
 * Branch regions rather than statements: a block is what the instrumenter
 * probes, so a module that should cost what a real 29-block module costs needs
 * 29 of them and not 29 lines.
 */
const moduleSource = (index, imports, blocks) => {
  const lines = [];
  for (let at = 0; at < imports.length; at += 1) lines.push(`import { work as w${at} } from './m${imports[at]}.mjs';`);
  lines.push(`export function work(value) {`);
  lines.push(`  let total = value;`);
  for (let block = 0; block < blocks; block += 1) {
    lines.push(`  if ((${index} + ${block}) % ${2 + (block % 5)} === 0) { total += ${block}; } else { total -= ${block}; }`);
  }
  for (let at = 0; at < imports.length; at += 1) lines.push(`  total += w${at}(total & 1023);`);
  lines.push(`  return total;`);
  lines.push(`}`);
  return lines.join('\n') + '\n';
};

/**
 * How many generated branch regions the instrumenter actually counts as blocks.
 *
 * One `if`/`else` is not one block — the walker counts each arm, and the module
 * and the function around them. Guessing the ratio produced modules three times
 * denser than any real one, so it is measured here against the instrumenter and
 * the generator is scaled by it.
 */
const perBranch = (() => {
  const sample = 40;
  const done = instrument(moduleSource(0, [], sample), 'calibrate.ts', 0);
  if (done === undefined) throw new Error('the calibration module would not parse');
  const bare = instrument(moduleSource(0, [], 0), 'calibrate.ts', 0);
  return (done.blocks.length - bare.blocks.length) / sample;
})();

/** The tree, written twice: once as written, once through `instrument()`. */
const build = () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(`${OUT}/plain`, { recursive: true });
  mkdirSync(`${OUT}/probed`, { recursive: true });
  let blocksTotal = 0;
  let plainBytes = 0;
  let probedBytes = 0;
  for (let index = 0; index < MODULES; index += 1) {
    // Imports point forward only, so the graph is acyclic and every module is
    // reachable from the root: the depth of the tree is log_FANOUT(MODULES).
    const imports = [];
    for (let edge = 1; edge <= FANOUT; edge += 1) {
      const target = index * FANOUT + edge;
      if (target < MODULES) imports.push(target);
    }
    const target = blockCounts[(random() * blockCounts.length) | 0];
    const source = moduleSource(index, imports, Math.max(0, Math.round((target - 2) / perBranch)));
    writeFileSync(`${OUT}/plain/m${index}.mjs`, source);
    plainBytes += source.length;
    const done = instrument(source, `m${index}.ts`, index);
    if (done === undefined) throw new Error(`m${index} would not parse`);
    blocksTotal += done.blocks.length;
    writeFileSync(`${OUT}/probed/m${index}.mjs`, done.code);
    probedBytes += done.code.length;
  }
  return { blocksTotal, plainBytes, probedBytes };
};

console.log(`building ${MODULES.toLocaleString()} modules, fanout ${FANOUT} — ${perBranch} blocks a generated branch`);
const { blocksTotal, plainBytes, probedBytes } = build();
console.log(`  ${blocksTotal.toLocaleString()} blocks, ${(blocksTotal / MODULES).toFixed(1)} a module`);
console.log(`  ${mb(plainBytes)} of source becomes ${mb(probedBytes)} instrumented — ${(((probedBytes - plainBytes) / plainBytes) * 100).toFixed(1)}% more text`);

/**
 * One variant in its own process, so what is reported is that variant's heap
 * and not whatever the other one left behind.
 */
const run = (variant) => {
  const script = `${OUT}/run-${variant}.mjs`;
  writeFileSync(script, `
import { createRequire } from 'node:module';
const require = createRequire(${JSON.stringify(import.meta.url)});
${variant === 'probed' ? `const factory = require('../dist/test-selection/jest-globals.cjs')();
const { encodeJournal } = require('../dist/test-selection/journal-format.cjs');` : ''}
const before = process.memoryUsage();
const started = Date.now();
const { work } = await import(${JSON.stringify(`${OUT}/${variant}/m0.mjs`)});
const imported = Date.now() - started;
const answer = work(1);
const ran = Date.now() - started;
const after = process.memoryUsage();
${variant === 'probed'
  ? `const encodeStarted = Date.now();
const frame = encodeJournal('/repo/deep.test.ts', factory.modules);
const encodeMs = Date.now() - encodeStarted;
const peak = process.memoryUsage().rss;
process.stdout.write(JSON.stringify({ rss: after.rss, heap: after.heapUsed, imported, ran, answer, recorded: factory.modules.size, frame: frame.length, encodeMs, peak, before: before.rss }));`
  : `process.stdout.write(JSON.stringify({ rss: after.rss, heap: after.heapUsed, imported, ran, answer, recorded: 0, frame: 0, encodeMs: 0, peak: after.rss, before: before.rss }));`}
`);
  const done = spawnSync(process.execPath, ['--stack-size=4000', script], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (done.stdout.trim() === '') {
    console.error(`the ${variant} run produced nothing: ${done.stderr.split('\n').slice(0, 6).join(' | ')}`);
    process.exit(1);
  }
  return JSON.parse(done.stdout);
};

const plain = run('plain');
const probed = run('probed');

console.log(`\nimporting the whole tree from its root`);
console.log(`  plain:        ${mb(plain.rss)} rss, ${mb(plain.heap)} heap, imported in ${plain.imported} ms, ran in ${plain.ran - plain.imported} ms`);
console.log(`  instrumented: ${mb(probed.rss)} rss, ${mb(probed.heap)} heap, imported in ${probed.imported} ms, ran in ${probed.ran - probed.imported} ms`);
console.log(`  ${probed.recorded.toLocaleString()} modules registered counters`);
console.log(`  instrumentation adds ${mb(probed.rss - plain.rss)} rss (${(((probed.rss - plain.rss) / plain.rss) * 100).toFixed(1)}%), ${((probed.rss - plain.rss) / MODULES).toFixed(0)} bytes a module`);
console.log(`  and ${probed.imported - plain.imported} ms of import (${(((probed.imported - plain.imported) / plain.imported) * 100).toFixed(1)}%)`);
console.log(`  the journal: ${(probed.frame / 1024).toFixed(1)} KB in ${probed.encodeMs} ms`);
if (plain.answer !== probed.answer) console.log(`  DIFFERENT ANSWERS: ${plain.answer} against ${probed.answer} — the probes changed the program`);
else console.log(`  both computed ${plain.answer} — the probes did not change the program`);

const worst = Math.max(probed.peak, probed.rss);
console.log(`\npeak rss ${mb(worst)} against a ${(CEILING / 1_048_576).toFixed(0)} MB ceiling — ${worst <= CEILING ? 'fits' : 'OVER'}`);
console.log(`  of which ${mb(plain.rss)} is the repository the worker was going to hold anyway`);

let onDisk = 0;
for (const name of readdirSync(`${OUT}/probed`)) onDisk += statSync(`${OUT}/probed/${name}`).size;
rmSync(OUT, { recursive: true, force: true });
