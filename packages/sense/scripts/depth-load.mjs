/**
 * Whether depth costs anything, run rather than reasoned about.
 *
 * The goal says *to at least depth 10 from test*, and the worry attached to it
 * was a stack: *"don't record instrumentation journey for more than N steps. Or
 * stack will overflow"*. Both are answerable by running real instrumented code
 * instead of arguing from the emitted text, and this runs it.
 *
 * Two different depths get confused with each other, so both are measured:
 *
 * 1. **Call depth** — how far down the stack a probe still fires. The probe is
 *    a call that returns before the program's own recursion continues, so the
 *    prediction is that it costs frames only while it is running; what it
 *    actually costs is the difference between the two numbers below.
 * 2. **Reach depth** — how many hops from the test file a module sits. The
 *    counters are keyed by module id alone: there is no caller in them, no
 *    parent, no span. So the prediction is that a chain of N modules costs
 *    exactly what a fan of N modules costs, and the frames are byte-identical.
 *
 * A prediction that is only read off the source is not a measurement. These are
 * real files, instrumented by `instrument()`, imported by Node, counted by the
 * factory Jest installs and drained by `encodeJournal`.
 *
 *   node packages/sense/scripts/depth-load.mjs [modules] [depth]
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { instrument } from '../dist/instrument/index.js';

const require = createRequire(import.meta.url);
const install = require('../dist/test-selection/jest-globals.cjs');
const { encodeJournal } = require('../dist/test-selection/journal-format.cjs');

const MODULES = Number(process.argv[2] ?? 2_000);
const DEPTH = Number(process.argv[3] ?? 10);
const OUT = `${process.env.TMPDIR ?? '/tmp'}/va-depth-load`;

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;

// ---------------------------------------------------------------------------
// 1. Call depth: how far a real instrumented recursion goes before the stack
//    gives out, against the same function with no probes in it.

const recursive = `
export function down(level) {
  if (level <= 0) return 0;
  if (level % 2 === 0) return 1 + down(level - 1);
  return 1 + down(level - 1);
}
`;

const deepest = (source, name) => {
  const file = `${OUT}/${name}.mjs`;
  writeFileSync(file, source);
  // In its own process. One bisect deoptimises the function it walked, and a
  // second variant measured after it reports that deoptimisation rather than
  // its own probes — which is how a probe comes to look like it *buys* stack.
  const probe = `${OUT}/${name}-probe.mjs`;
  writeFileSync(probe, `
import { createRequire } from 'node:module';
createRequire(${JSON.stringify(import.meta.url)})(${JSON.stringify('../dist/test-selection/jest-globals.cjs')})();
const { down } = await import(${JSON.stringify(pathToFileURL(file).href)});
let safe = 1;
let over = 1 << 22;
while (over - safe > 1) {
  const middle = (safe + over) >>> 1;
  let survived = true;
  try { down(middle); } catch { survived = false; }
  if (survived) safe = middle; else over = middle;
}
process.stdout.write(String(safe));
`);
  const done = spawnSync(process.execPath, ['--stack-size=984', probe], { encoding: 'utf8' });
  const answer = Number(done.stdout.trim());
  if (!Number.isFinite(answer) || answer === 0) {
    console.error(`the ${name} bisect produced nothing: ${done.stderr.split('\n').slice(0, 4).join(' | ')}`);
    process.exit(1);
  }
  return answer;
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const factory = install();
const probed = instrument(recursive, 'recursive.ts', 1);
if (probed === undefined) { console.error('the recursion fixture would not parse'); process.exit(1); }

// Three runs each, alternating, and the median taken: a stack limit moves by a
// few frames run to run with whatever else the process has on it.
const median = (values) => [...values].sort((left, right) => left - right)[values.length >> 1];
const plainRuns = [];
const probedRuns = [];
for (let round = 0; round < 3; round += 1) {
  plainRuns.push(deepest(recursive, `plain${round}`));
  probedRuns.push(deepest(probed.code, `probed${round}`));
}
const plainDepth = median(plainRuns);
const probedDepth = median(probedRuns);

console.log(`call depth, with a real stack`);
console.log(`  ${plainDepth.toLocaleString()} frames uninstrumented`);
console.log(`  ${probedDepth.toLocaleString()} frames instrumented (${probed.blocks.length} blocks in the function)`);
console.log(`  ${plainRuns.join(', ')} against ${probedRuns.join(', ')} over three rounds each`);
console.log(`  ${(((plainDepth - probedDepth) / plainDepth) * 100).toFixed(1)}% of the stack is what the probes cost`);
console.log(`  the goal asks for depth 10; the stack gives out at ${probedDepth.toLocaleString()}`);

// ---------------------------------------------------------------------------
// 2. Reach depth: the same module count, arranged as a chain and as a fan.

/** A module that imports the next one and does a little branching of its own. */
const moduleSource = (index, next) => `
import { work as deeper } from './${next === undefined ? 'leaf' : `m${next}`}.mjs';
export function work(value) {
  if (${index} % 3 === 0) { value += 1; } else if (${index} % 3 === 1) { value += 2; } else { value += 3; }
  const doubled = [1, 2, 3].map((each) => each * value);
  return deeper(value) + doubled.length;
}
export const ready = ${index};
`;

/**
 * Where every chain ends. It exists so that every *counted* module has the same
 * text and the same blocks whatever the shape is: a chain's last module would
 * otherwise be the one module with no import in it, and a flat arrangement is
 * all last modules. That difference is the fixture's, and it would read as
 * depth's.
 */
const leafSource = `export function work(value) { return value & 1; }\n`;

/**
 * `shape` is the number of modules on the longest path. A chain of `MODULES`
 * has depth `MODULES`; a fan of them has depth 2. Everything else is the same
 * text, the same blocks and the same work.
 */
const build = async (shape, label) => {
  const dir = `${OUT}/${label}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/leaf.mjs`, leafSource);
  const chains = Math.ceil(MODULES / shape);
  const entries = [];
  let id = 0;
  let blocksTotal = 0;
  for (let chain = 0; chain < chains; chain += 1) {
    const ids = [];
    for (let step = 0; step < shape && id < MODULES; step += 1) { ids.push(id); id += 1; }
    for (let step = 0; step < ids.length; step += 1) {
      const self = ids[step];
      const next = step + 1 < ids.length ? ids[step + 1] : undefined;
      const done = instrument(moduleSource(self, next), `m${self}.ts`, self);
      if (done === undefined) throw new Error(`m${self} would not parse`);
      blocksTotal += done.blocks.length;
      writeFileSync(`${dir}/m${self}.mjs`, done.code);
    }
    if (ids.length > 0) entries.push(ids[0]);
  }
  // An entry per chain, imported the way a test file imports its subject.
  const test = entries.map((entry, at) => `import { work as w${at} } from './m${entry}.mjs';`).join('\n')
    + `\nexport function run() { let total = 0; ${entries.map((_, at) => `total += w${at}(${at});`).join(' ')} return total; }\n`;
  writeFileSync(`${dir}/test.mjs`, test);
  return { dir, chains, blocksTotal };
};

const record = async (shape, label) => {
  const { dir, chains, blocksTotal } = await build(shape, label);
  factory.modules.clear();
  const before = process.memoryUsage().rss;
  const started = Date.now();
  const { run } = await import(pathToFileURL(`${dir}/test.mjs`).href);
  const answer = run();
  const ms = Date.now() - started;
  const frame = encodeJournal('/repo/src/shape.test.ts', factory.modules);
  let ordinals = 0;
  for (const counters of factory.modules.values()) for (const value of counters) if (value > 0) ordinals += 1;
  return { shape, chains, label, blocksTotal, ms, frame, ordinals, answer, rss: process.memoryUsage().rss - before, recorded: factory.modules.size };
};

console.log(`\nreach depth: ${MODULES.toLocaleString()} modules, arranged three ways`);
const shapes = [
  [1, 'flat'],
  [DEPTH, `depth${DEPTH}`],
  [Math.min(MODULES, 200), 'depth200'],
];
const results = [];
for (const [shape, label] of shapes) results.push(await record(shape, label));

for (const result of results) {
  console.log(`  longest path ${String(result.shape).padStart(4)} (${result.chains} chains): ${result.recorded} modules recorded, ${result.ordinals.toLocaleString()} ordinals, ${result.frame.length.toLocaleString()} journal bytes, ${result.ms} ms, ${mb(result.rss)}`);
}

const sizes = new Set(results.map((result) => result.frame.length));
const counted = new Set(results.map((result) => result.ordinals));
console.log(`\n  ${sizes.size === 1 ? 'the same journal size at every depth' : `DIFFERENT journal sizes: ${[...sizes].join(', ')}`}`);
console.log(`  ${counted.size === 1 ? 'the same ordinals entered at every depth' : `different ordinals: ${[...counted].join(', ')}`}`);

rmSync(OUT, { recursive: true, force: true });
