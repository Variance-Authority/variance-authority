#!/usr/bin/env node

/**
 * What the counter write costs, isolated from everything around it.
 *
 * The probe's steady state is nine reads, a compare, an add, an or and a store.
 * Everything but the last three is fixed by the contract — the factory identity
 * check is what lets a module outlive a test file, and the evaluating bit is
 * what makes a top-level call shared evidence — so the only part of the hot
 * path that is a free choice is how the counter is written:
 *
 *   count    c[i] = c[i] + 1 | bit     what the emitter writes today
 *   presence c[i] |= 1 | bit           one fewer operation, same two predicates
 *   floor    c[i] = 1                  no read, no bit, and not a candidate
 *
 * Nothing downstream reads the magnitude. Both consumers of a counter ask
 * `> 0` and `>= EVALUATING` (`probes.ts`, `journey.ts`) and the worker merges
 * two readings with `|=`, so `presence` is a behaviour-preserving substitution
 * and `floor` is only here to price the read: it drops the bit and would lose
 * the evaluating half of every observation.
 *
 * Each variant is a generated module carrying the real emitted prologue, hit
 * through distinct call sites the way instrumented code is. Variants are
 * interleaved round-robin so a thermal drift lands on all of them, and the
 * estimator is the minimum — a floor, not a mean.
 *
 * **`control` is the load-bearing column.** It is a second copy of `current`,
 * byte-identical, timed the same way. A difference smaller than the gap between
 * `current` and `control` is this machine, not the write.
 *
 * Read it at a small region count. At 64 call sites the spread is decided by
 * inlining and code layout — an arm doing strictly less work measures slower —
 * and the write is only legible once the sites are few enough to compile
 * alike.
 *
 * Run:  yarn probe-write
 *       yarn probe-write 64 1000000 9   # regions, sweeps, rounds
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVALUATING } from '../dist/instrument/index.js';

const REGIONS = Number(process.argv[2] ?? 4);
const SWEEPS = Number(process.argv[3] ?? 1_000_000);
const ROUNDS = Number(process.argv[4] ?? 9);
const HITS = REGIONS * SWEEPS;

const WRITES = {
  count: (bit) => `__va.c[i]=__va.c[i]+1|${bit}`,
  presence: (bit) => `__va.c[i]|=1|${bit}`,
  floor: () => `__va.c[i]=1`,
};

/**
 * The guard half of the probe, which is the part that is a position rather than
 * a micro-optimization.
 *
 * `hardwired` is what the emitter writes today. `checked` is what it wrote
 * before, and the difference is everything that existed to survive a
 * misconfiguration:
 *
 *   - `g &&` — a realm with no factory. Gone, so a missing collector is a
 *     `TypeError` at the first probe instead of a sentence naming the file.
 *   - `typeof r !== 'function'` and the message beside it. That branch is cold
 *     — it only runs while registering — but the message is a string constant
 *     per instrumented module, so it is paid in bytes and in compile.
 *   - `__va.c === undefined ||`. This one is not defence at all, it is
 *     redundant: `__va.r` starts `undefined` and no factory is `undefined`, so
 *     the identity test already answers the first call. It is a property load
 *     and a compare on every hit.
 */
const GUARDS = {
  checked: (id, count, absent) =>
    `const g=globalThis.__VA__;const r=g&&g.s?g.s():g;` +
    `if(__va.c===undefined||__va.r!==r){if(typeof r!=='function')throw new Error(${absent});` +
    `const again=__va.c!==undefined;__va.r=r;__va.c=r(${id},${count});if(again)__va.c[0]+=1}`,
  hardwired: (id, count) =>
    `const g=globalThis.__VA__;const r=g.s?g.s():g;` +
    `if(__va.r!==r){const again=__va.c!==undefined;__va.r=r;__va.c=r(${id},${count});if(again)__va.c[0]+=1}`,
};

const SHAPES = {
  current: { guard: 'hardwired', write: 'count' },
  control: { guard: 'hardwired', write: 'count' },
  guarded: { guard: 'checked', write: 'count' },
  presence: { guard: 'hardwired', write: 'presence' },
  floor: { guard: 'hardwired', write: 'floor' },
};

const ORDER = (process.env['PROBE_ORDER'] ?? '').split(',').filter(Boolean);
const VARIANTS = ORDER.length > 0 ? ORDER : Object.keys(SHAPES);

/** The shipped flat collector, which is the shape the probe's inline cache sees. */
const modules = new Map();
globalThis.__VA__ = (id, count) => {
  const held = modules.get(id) ?? new Uint32Array(count);
  modules.set(id, held);
  return held;
};
globalThis.__VA__.s = undefined;

/**
 * A module in the emitter's own shape: the prologue verbatim but for the part
 * under test, then one probed function per region and a sweep that calls every
 * one of them.
 *
 * Distinct call sites rather than one function in a loop, because a probe is
 * compiled into the function it was spliced into and a single site would let
 * one inline cache answer the whole benchmark.
 */
function source(id, variant) {
  const shape = SHAPES[variant];
  const absent = JSON.stringify(`probe-write: no factory for ${id}`);
  const bit = `(r.e>0?${EVALUATING}:0)`;
  const sites = [];
  const calls = [];
  for (let region = 1; region <= REGIONS; region += 1) {
    sites.push(`function f${region}(v){__va(${region});return v+${region}}`);
    calls.push(`total=f${region}(total)`);
  }
  return (
    `function __va(i){${GUARDS[shape.guard](JSON.stringify(id), REGIONS + 1, absent)}` +
    `${WRITES[shape.write](bit)}}\n` +
    `function __vaE(){const g=globalThis.__VA__;const r=g.s?g.s():g;r.e=r.e>1?r.e-1:0}\n` +
    `__va(0);__va.r.e=(__va.r.e|0)+1;__va.c[0]|=${EVALUATING};\n` +
    `${sites.join('\n')}\n` +
    // Evaluation is over before the sweeps run, which is the branch a test
    // takes: an arm left evaluating would measure the other side of `r.e > 0`.
    `__vaE();\n` +
    `export function sweep(times){let total=0;for(let n=0;n<times;n+=1){${calls.join(';')}}return total}\n` +
    `export const counters=()=>__va.c;\n`
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

  const entered = (variant) => {
    const counters = loaded.get(variant).counters();
    let hit = 0;
    for (const counter of counters) if ((counter & ~EVALUATING) >>> 0 || counter) hit += 1;
    return hit;
  };

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
