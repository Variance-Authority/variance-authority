/**
 * What concurrent journeys cost a live head.
 *
 * A test worker has one counter set. A *head* — a service answering several
 * subjects at once — has one per journey that is open, because that is the
 * whole point of `collectJourneys`: a counter set per logical flow, not per
 * process and not per request boundary. So the number the ceiling cares about
 * is not what one journey costs but what `concurrency x closure` costs, and
 * whether the drain that ends a journey has a peak in it.
 *
 * Three things get weighed, none of them modelled:
 *
 * 1. **Held.** Journeys open at once, each having entered its own modules.
 * 2. **Drained.** `report()` builds a `number[]` per module before it hands the
 *    account to the wire — the one allocating step on this path — and that is
 *    the moment the process is largest.
 * 3. **Interleaved.** Two journeys inside the same module, which is the case
 *    the design exists for: the probe re-resolves on the factory's identity, so
 *    the crossing has to land in the journey that was open and not the one that
 *    evaluated the module first. Counted here, not asserted.
 *
 * The head is the shipped one. The wire is real, through the in-realm sink the
 * driver installs, so the accounts are the accounts a driver would stitch.
 *
 *   node --expose-gc packages/sense/scripts/journey-load.mjs <snapshot> [journeys] [modules]
 */

import { readTestCoverage } from '../dist/test-selection/index.js';
import { WIRE_SINK, JOURNEY_COOKIE } from '../../wire/dist/index.js';

const SNAPSHOT = process.argv[2];
const JOURNEYS = Number(process.argv[3] ?? 16);
const MODULES = Number(process.argv[4] ?? 40_000);
const CEILING = Number(process.env.CEILING ?? 600) * 1_048_576;

const rss = () => process.memoryUsage().rss;
let peak = rss();
const mark = () => { const now = rss(); if (now > peak) peak = now; return now; };
const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const settle = () => { if (global.gc !== undefined) { global.gc(); global.gc(); } return rss(); };

const coverage = await readTestCoverage(SNAPSHOT);
if (coverage === undefined) { console.error(`no snapshot at ${SNAPSHOT}`); process.exit(1); }
const blockCounts = coverage.modules.map((module) => module.blocks.length);
const shares = [];
for (const module of coverage.modules) {
  const perTest = new Map();
  for (const block of module.blocks) for (const file of block.testFiles) perTest.set(file, (perTest.get(file) ?? 0) + 1);
  for (const count of perTest.values()) shares.push(count / module.blocks.length);
}
coverage.modules.length = 0;
coverage.tests.length = 0;

let state = 0x9e3779b9;
const random = () => {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return state / 0x100000000;
};
const draw = (bag) => bag[(random() * bag.length) | 0];

const counts = new Int32Array(MODULES);
const entered = new Int32Array(MODULES);
for (let module = 0; module < MODULES; module += 1) {
  counts[module] = draw(blockCounts);
  entered[module] = Math.max(1, Math.round(counts[module] * draw(shares)));
}

// The driver's end of the wire, in this realm: every account a head reports
// arrives here as an object, exactly as `stitchJourneys` would receive it.
const accounts = [];
let accountBytes = 0;
globalThis[WIRE_SINK] = (journey, participant, body) => {
  accounts.push({ journey, participant, modules: body.modules.length });
  for (const module of body.modules) accountBytes += 8 + module.hits.length * 8 + module.shared.length * 8;
  mark();
};

process.env.VARIANCE_AUTHORITY_JOURNEYS = '1';
const { collectJourneys } = await import('../dist/test-selection/journey.js');
const collector = collectJourneys({ head: 'service' });
if (!collector.collecting) { console.error('the head did not install'); process.exit(1); }

/**
 * What the emitted probe does, against whatever factory is current.
 *
 * One probe per module, each holding its own cached array and its own record of
 * which factory produced it — because that is what `runtime()` emits: a `__va`
 * function per module, with `__va.c` and `__va.r` on it and nothing else. A
 * single shared probe keyed on the module would re-resolve on every crossing,
 * which is both slower than the real thing and unable to fail the interleaving
 * check below: the cache is what makes that check mean anything.
 */
const probeFor = (module) => {
  const probe = (ordinal) => {
    const factory = globalThis.__VA__;
    if (probe.c === undefined || probe.r !== factory) {
      probe.r = factory;
      probe.c = factory(module, counts[module]);
    }
    probe.c[ordinal] = (probe.c[ordinal] + 1) | 0;
  };
  return probe;
};

// Built before the baseline is taken: these closures are the instrumented
// module's own weight, which `worker-load.mjs` prices, and counting them here
// would put them on the journeys' bill.
const probes = Array.from({ length: MODULES });
for (let module = 0; module < MODULES; module += 1) probes[module] = probeFor(module);

const base = settle();
console.log(`a head with ${JOURNEYS} journeys open at once, ${MODULES.toLocaleString()} modules each`);
console.log(`  baseline rss ${mb(base)}`);

const cookie = (journey) => `${JOURNEY_COOKIE}=${journey}`;

/** One journey's work: enter every module, the ordinals that module gets. */
const walk = (from, to) => {
  for (let module = from; module < to; module += 1) {
    const probe = probes[module];
    const blocks = counts[module];
    for (let hit = 0; hit < entered[module]; hit += 1) probe(((hit * 2654435761) >>> 0) % blocks);
  }
};

// ---------------------------------------------------------------------------
// 1. Held: every journey open at once, none of them finished.

const open = [];
const held = new Map();
for (let at = 0; at < JOURNEYS; at += 1) {
  const journey = `journey-${at}-0000000000000000`;
  let settle;
  const gate = new Promise((resolve) => { settle = resolve; });
  held.set(journey, settle);
  // `enter` releases when what the body returned settles, so a promise that is
  // not resolved yet is a journey that is still open — which is the state a
  // service is in while it is answering.
  open.push(collector.enter(cookie(journey), async () => { walk(0, MODULES); await gate; }));
  mark();
}
// Let each body run up to its await.
await new Promise((resolve) => setImmediate(resolve));
const whileOpen = mark();
const settled = settle();

console.log(`\n  holding all ${JOURNEYS} open: rss ${mb(whileOpen)}, ${mb(settled)} settled`);
console.log(`    ${mb(settled - base)} for ${(JOURNEYS * MODULES).toLocaleString()} journey-module counter sets — ${(((settled - base)) / (JOURNEYS * MODULES)).toFixed(0)} bytes each`);

// ---------------------------------------------------------------------------
// 2. Drained: the accounts built and delivered.

const drainStarted = Date.now();
for (const release of held.values()) release();
await Promise.all(open);
await collector.flush();
const drainMs = Date.now() - drainStarted;
const afterDrain = mark();

console.log(`\n  draining them: ${accounts.length} accounts in ${drainMs} ms, rss ${mb(afterDrain)} at the peak of it`);
console.log(`    ${accounts.reduce((total, account) => total + account.modules, 0).toLocaleString()} module rows, about ${mb(accountBytes)} of account objects`);

// ---------------------------------------------------------------------------
// 3. Interleaved: two journeys inside one module, alternating every crossing.

accounts.length = 0;
const SMALL = Math.min(MODULES, 2_000);
const left = `left-aaaaaaaaaaaaaaaaaaaaaaaa`;
const right = `right-bbbbbbbbbbbbbbbbbbbbbbb`;
let leftRelease;
let rightRelease;
const leftGate = new Promise((resolve) => { leftRelease = resolve; });
const rightGate = new Promise((resolve) => { rightRelease = resolve; });

// Two async bodies that hand off to each other inside the same modules. The
// store is what tells the getter which factory to return, so this is the exact
// interleaving the design claims to survive.
const interleave = async (gate, which) => {
  for (let module = 0; module < SMALL; module += 1) {
    probes[module](which % counts[module]);
    // Yielding inside the loop is what puts the other journey in the middle of
    // this one — a bracket-based drain would lose exactly here.
    if ((module & 63) === 0) await Promise.resolve();
  }
  await gate;
};
const leftOpen = collector.enter(cookie(left), () => interleave(leftGate, 0));
const rightOpen = collector.enter(cookie(right), () => interleave(rightGate, 1));
leftRelease();
rightRelease();
await Promise.all([leftOpen, rightOpen]);
await collector.flush();
mark();

const byJourney = new Map();
for (const account of accounts) byJourney.set(account.journey, (byJourney.get(account.journey) ?? 0) + account.modules);
console.log(`\n  two journeys interleaved through ${SMALL.toLocaleString()} shared modules`);
for (const [journey, modules] of byJourney) console.log(`    ${journey.split('-')[0]}: ${modules.toLocaleString()} modules attributed`);
const bothRight = byJourney.size === 2 && [...byJourney.values()].every((modules) => modules === SMALL);
console.log(`    ${bothRight ? `each journey got all ${SMALL.toLocaleString()} modules it entered, and neither took the other's` : 'MISATTRIBUTED — a journey did not get its own modules'}`);

await collector.close();
console.log(`\npeak rss ${mb(peak)} against a ${(CEILING / 1_048_576).toFixed(0)} MB ceiling — ${peak <= CEILING ? 'fits' : 'OVER'}`);
