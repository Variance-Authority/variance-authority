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
 * counter array and re-resolves it only when `globalThis.__VA__` changes
 * identity, which is the whole reason a getter over an async store works at all.
 */
const PROBE = `
const EVALUATING = 0x80000000;
const __va = (i) => {
  const r = globalThis.__VA__;
  if (__va.c === undefined || __va.r !== r) {
    const again = __va.c !== undefined;
    __va.r = r;
    __va.c = globalThis.__VA__('m', 8);
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

/** The collector this package generates, driven through one interleaving. */
const SCOPED = `${caseCollectorSource()}
${PROBE}
const scope = globalThis[Symbol.for('variance-authority.test-selection.cases')];
await Promise.all([
  scope.enter('A', async () => { await alpha(); floating(); }),
  scope.enter('B', beta),
]);
await nap(60);
const seen = {};
for (const [key, held] of buckets) {
  const counters = held.get('m');
  if (counters !== undefined) seen[key === '' ? 'ambient' : key] = ordinalsOf(counters);
}
console.log(JSON.stringify(seen));
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
async function attribute(source: string): Promise<Record<string, number[]>> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-cases-'));
  temporary.push(directory);
  const file = resolve(directory, 'interleave.mjs');
  await writeFile(file, source);
  const { stdout } = await execute(process.execPath, [file]);
  return JSON.parse(stdout) as Record<string, number[]>;
}

describe('attributing crossings while two cases are in flight', () => {
  it('gives each case what it entered, including after the case is over', async () => {
    expect(await attribute(SCOPED)).toEqual({
      // Not 1 and 2 only: the continuation A left behind settles half a case
      // later and is still A's, because the store it resolves is the one A ran
      // in. Nothing was held open to make that true.
      A: [1, 2, 5, 6],
      B: [3, 4],
    });
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
