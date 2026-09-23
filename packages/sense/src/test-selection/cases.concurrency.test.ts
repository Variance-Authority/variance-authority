import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { caseCollectorSource } from './worker-source.js';

const execute = promisify(execFile);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * The emitted prologue, as one module's probe.
 *
 * Copied rather than imported because the real one is text spliced into a
 * transformed file, and what is under test here is the *collector* underneath
 * it. The line that matters is the one the emitter writes: the probe caches its
 * counter array and re-resolves it only when the factory changes identity,
 * which is the whole reason a resolver over an async store works at all.
 */
const PROBE = `
const EVALUATING = 0x80000000;
const __va = (i) => {
  const g = globalThis.__VA__;
  const r = g && g.s ? g.s() : g;
  if (__va.c === undefined || __va.r !== r) {
    const again = __va.c !== undefined;
    __va.r = r;
    __va.c = r('m', 8);
    if (again) __va.c[0] += 1;
  }
  __va.c[i] = (__va.c[i] + 1) | (r.e > 0 ? EVALUATING : 0);
};
const nap = (ms) => new Promise((wake) => setTimeout(wake, ms));
const ordinalsOf = (counters) => {
  const out = [];
  for (let i = 1; i < counters.length; i += 1) if (counters[i] > 0) out.push(i);
  return out;
};
// Case A enters 1 and 2 across an await, and leaves a continuation that enters
// 5 and 6 long after the case itself is over. Case B enters 3 and 4, entirely
// inside A's window. This is one \`describe.concurrent\` block, in miniature.
const alpha = async () => { __va(1); await nap(10); __va(2); };
const beta = async () => { __va(3); await nap(4); __va(4); };
const floating = () => { void nap(30).then(() => { __va(5); __va(6); }); };
`;

/**
 * Reading the buckets out of whichever collector the source installed.
 *
 * A bucket is encoded and dropped as its case settles, so the report reads the
 * frames rather than the buckets: the stand-in encoder below keeps what it was
 * handed, and a case that outlived itself arrives as two frames, joined here
 * the way the reader joins them.
 */
const REPORT = `
const seen = {};
for (const { key, held } of finish('').frames) {
  const counters = held.get('m');
  if (counters === undefined) continue;
  const name = key === '' ? 'ambient' : key;
  seen[name] = [...new Set([...(seen[name] ?? []), ...ordinalsOf(counters)])].sort((l, r) => l - r);
}
seen.late = runaways();
console.log(JSON.stringify(seen));
`;

/** The encoder the setup module requires, standing in so frames stay readable. */
const ENCODER = `const journalFormat = {
  encodeJournal: (key, held) => ({ key, held }),
  packCase: (file) => file,
};
`;

/** The async-context collector, driven through one interleaving. */
const SCOPED = `${ENCODER}${caseCollectorSource(true)}
${PROBE}
const scope = globalThis[Symbol.for('variance-authority.test-selection.cases')];
await Promise.all([
  scope.enter('A', async () => { await alpha(); floating(); }),
  scope.enter('B', beta),
]);
await nap(60);
${REPORT}`;

/**
 * The default collector — one case at a time, the case running now in a
 * variable — over three cases that never overlap, the last of which leaves work
 * behind.
 */
const SEQUENTIAL = `${ENCODER}${caseCollectorSource()}
${PROBE}
const scope = globalThis[Symbol.for('variance-authority.test-selection.cases')];
await scope.enter('A', alpha);
await scope.enter('B', beta);
// Synchronous to the harness, async underneath: the case is over the instant it
// returns, and its work is not.
scope.enter('C', () => { floating(); });
await nap(60);
${REPORT}`;

/** The same default collector, handed two cases at once. */
const REFUSED = `${ENCODER}${caseCollectorSource()}
${PROBE}
const scope = globalThis[Symbol.for('variance-authority.test-selection.cases')];
try {
  await Promise.all([scope.enter('A', alpha), scope.enter('B', beta)]);
  console.log(JSON.stringify({ refused: null }));
} catch (error) {
  console.log(JSON.stringify({ refused: error.message }));
}
`;

/**
 * Snapshot-and-subtract over the same interleaving: the file-level collector
 * this package already ships, with a copy taken where `beforeEach` runs and the
 * difference read where `afterEach` does.
 */
const SUBTRACT = `
const modules = new Map();
globalThis.__VA__ = (id, count) => {
  let counters = modules.get(id);
  if (counters === undefined || counters.length !== count) {
    counters = new Uint32Array(count);
    modules.set(id, counters);
  }
  return counters;
};
${PROBE}
const seen = {};
const around = async (key, body) => {
  const before = new Uint32Array(modules.get('m') ?? 8);
  await body();
  const after = modules.get('m') ?? new Uint32Array(8);
  const diff = new Uint32Array(after.length);
  for (let at = 0; at < after.length; at += 1) diff[at] = after[at] - (before[at] ?? 0);
  seen[key] = ordinalsOf(diff);
};
await Promise.all([
  around('A', async () => { await alpha(); floating(); }),
  around('B', beta),
]);
await nap(60);
console.log(JSON.stringify(seen));
`;

/**
 * In its own process, because the collector claims `globalThis.__VA__` — and
 * this suite is itself recorded through that name.
 */
async function attribute<Seen = Record<string, number[]>>(source: string): Promise<Seen> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-cases-'));
  temporary.push(directory);
  const file = resolve(directory, 'interleave.mjs');
  await writeFile(file, source);
  const { stdout } = await execute(process.execPath, [file]);
  return JSON.parse(stdout) as Seen;
}

describe('attributing crossings while two cases are in flight', () => {
  it('gives each case what it entered, including after the case is over', async () => {
    expect(await attribute(SCOPED)).toEqual({
      // Not 1 and 2 only: the continuation A left behind settles half a case
      // later and is still A's, because the store it resolves is the one A ran
      // in. Nothing was held open to make that true.
      A: [1, 2, 5, 6],
      B: [3, 4],
      // Which is also the answer to the other question this mode is turned on
      // for: A made a crossing after A was over, so A is the runaway.
      late: ['A'],
    });
  });

  it('gives each sequential case its own, and what came late to nobody', async () => {
    expect(await attribute(SEQUENTIAL)).toEqual({
      A: [1, 2],
      B: [3, 4],
      // C's continuation settled after C returned, and a variable has no memory
      // of a case that closed: 5 and 6 land in the ambient bucket, which every
      // case in the file is credited with. Over-inclusion, which is the
      // direction `selecting.md` permits — and no case is named, which is what
      // the async-context mode is for.
      ambient: [5, 6],
      late: [],
    });
  });

  it('refuses two cases at once rather than charging one to the other', async () => {
    const { refused } = await attribute<{ refused: string | null }>(REFUSED);
    expect(refused).toContain('A was still running when B started');
    expect(refused).toContain('continuations: true');
  });

  it('is what snapshot-and-subtract cannot do at any price', async () => {
    const drained = await attribute(SUBTRACT);

    // Contamination: B ran entirely inside A's bracket, so A is credited with
    // B's two branches as well as its own. Scale that to a `describe.concurrent`
    // of a hundred cases and every one of them reports the union of the group —
    // the flat line per-case recording exists to break.
    expect(drained['A']).toEqual([1, 2, 3, 4]);

    // Loss, which is the half that cannot be argued as over-inclusion: A's
    // continuation settled after every bracket had closed, so 5 and 6 are in no
    // case's record at all. An edit to either region would skip the one test
    // that runs it.
    expect(Object.values(drained).flat()).not.toContain(5);
    expect(Object.values(drained).flat()).not.toContain(6);
  });
});
