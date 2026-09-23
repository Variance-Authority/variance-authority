#!/usr/bin/env node

/**
 * What a probe hit costs, isolated from everything around it.
 *
 * A region's first touch in a segment sets its flag and appends it to the log;
 * every later touch reads the flag and returns. The later touches are almost
 * all of them — a suite enters a region once per case and runs it thousands of
 * times — so the steady state is what this prices: two module-scoped loads,
 * two byte reads and an `and`, with no call. Two shapes of it:
 *
 *   current  the emitted runtime over a flat engine: what a test file records with
 *   scoped   the same runtime over an engine that asks its scope which bucket is
 *            current, so every hit calls in: what `continuations` and journeys
 *            pay, less the store's own lookup
 *
 * Each variant is a generated module carrying the real emitted runtime, hit
 * through distinct call sites the way instrumented code is. Variants are
 * interleaved round-robin so a thermal drift lands on all of them, and the
 * estimator is the minimum — a floor, not a mean.
 *
 * **`control` is the load-bearing column.** It is a second copy of `current`,
 * byte-identical, timed the same way. A difference smaller than the gap between
 * `current` and `control` is this machine, not the probe.
 *
 * Read it at a small region count. At 64 call sites the spread is decided by
 * inlining and code layout — an arm doing strictly less work measures slower —
 * and the probe is only legible once the sites are few enough to compile
 * alike.
 *
 * Run:  yarn probe-write
 *       yarn probe-write 64 1000000 9   # regions, sweeps, rounds
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROBE_RUNTIME } from '../dist/instrument/index.js';

const probeLog = createRequire(import.meta.url)('../dist/instrument/probe-log.cjs');

const REGIONS = Number(process.argv[2] ?? 4);
const SWEEPS = Number(process.argv[3] ?? 1_000_000);
const ROUNDS = Number(process.argv[4] ?? 9);
const HITS = REGIONS * SWEEPS;

/** Where each variant's module finds its root, and how its probe reads it on a hit. */
const SHAPES = {
  current: { root: '__VA__', hit: (runtime) => runtime },
  control: { root: '__VA__', hit: (runtime) => runtime },
  scoped: { root: '__VA_SCOPED__', hit: (runtime) => runtime },
};

const ORDER = (process.env['PROBE_ORDER'] ?? '').split(',').filter(Boolean);
const VARIANTS = ORDER.length > 0 ? ORDER : Object.keys(SHAPES);

// The flat engine a test file records with, and a scoped one beside it whose
// resolver always answers the same bucket, so it never switches.
const flat = probeLog.createEngine(false);
const flatBucket = flat.open('');
flat.use(flatBucket);
globalThis.__VA__ = flat.root;
const scoped = probeLog.createEngine(true);
const scopedBucket = scoped.open('');
scoped.scope(() => scopedBucket);
globalThis.__VA_SCOPED__ = scoped.root;

/**
 * A module in the emitter's own shape: the runtime verbatim but for the part
 * under test, then one probed function per region and a sweep that calls every
 * one of them.
 *
 * Distinct call sites rather than one function in a loop, because a probe is
 * compiled into the function it was spliced into and a single site would let
 * one inline cache answer the whole benchmark.
 */
function source(id, variant) {
  const shape = SHAPES[variant];
  const runtime = PROBE_RUNTIME.replace('.r(0,0)', `.r(${JSON.stringify(id)},${REGIONS + 1})`).replace(
    '__vaK=globalThis.__VA__;',
    `__vaK=globalThis.${shape.root};`,
  );
  const sites = [];
  const calls = [];
  for (let region = 1; region <= REGIONS; region += 1) {
    sites.push(`function f${region}(v){__va(${region});return v+${region}}`);
    calls.push(`total=f${region}(total)`);
  }
  return (
    `${shape.hit(runtime)}\n` +
    `${sites.join('\n')}\n` +
    // Evaluation is over before the sweeps run, which is the branch a test
    // takes: an arm left evaluating would measure the other side of the bit.
    `__vaE();\n` +
    `export function sweep(times){let total=0;for(let n=0;n<times;n+=1){${calls.join(';')}}return total}\n`
  );
}

const staging = mkdtempSync(join(tmpdir(), 'variance-probe-write-'));
const timings = new Map(VARIANTS.map((variant) => [variant, []]));

try {
  const loaded = new Map();
  for (const variant of VARIANTS) {
    const file = join(staging, `${variant}.mjs`);
    writeFileSync(file, source(variant, variant));
    loaded.set(variant, await import(pathToFileURL(file).href));
  }

  // One unmeasured sweep per variant, so every arm is timed against optimized
  // code rather than the first one paying for everybody's tier-up.
  for (const variant of VARIANTS) loaded.get(variant).sweep(Math.min(SWEEPS, 50_000));

  for (let round = 0; round < ROUNDS; round += 1) {
    for (const variant of VARIANTS) {
      const at = process.hrtime.bigint();
      const answer = loaded.get(variant).sweep(SWEEPS);
      const took = Number(process.hrtime.bigint() - at) / 1e6;
      if (answer === 0) throw new Error('the sweep was optimized away');
      timings.get(variant).push(took);
    }
  }

  const held = [
    ...flat.lists(flat.read(flatBucket), true),
    ...scoped.lists(scoped.read(scopedBucket), true),
  ];
  const entered = (variant) => held.find((row) => row.id === variant)?.hits.length ?? 0;

  const floorOf = (variant) => Math.min(...timings.get(variant));
  const base = floorOf(VARIANTS[0]);

  console.log(`\n${REGIONS} regions, ${SWEEPS.toLocaleString()} sweeps, ${ROUNDS} rounds`);
  console.log(`${HITS.toLocaleString()} probe hits per round, minimum reported\n`);
  console.log('  variant      floor        per hit      vs first  regions entered');
  for (const variant of VARIANTS) {
    const floor = floorOf(variant);
    console.log(
      `  ${variant.padEnd(11)} ${`${floor.toFixed(1)} ms`.padStart(9)}` +
        `  ${`${((floor * 1e6) / HITS).toFixed(2)} ns`.padStart(9)}` +
        `  ${(floor / base).toFixed(3).padStart(10)}` +
        `  ${String(entered(variant)).padStart(10)} / ${REGIONS + 1}`,
    );
  }
  console.log('\n  control is a second copy of current. Read the gap to it as the noise floor.');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
