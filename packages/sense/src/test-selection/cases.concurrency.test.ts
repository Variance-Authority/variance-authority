import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { PROBE_RUNTIME } from '../instrument/index.js';
import journals from './journal-format.cjs';

/**
 * The collectors as a worker loads them: built, because they `require` their
 * neighbours by the names the build gives them.
 */
const collectors = createRequire(import.meta.url)(
  '../../dist/test-selection/collectors.cjs',
) as typeof import('./collectors.cjs');

type Probe = (ordinal: number) => void;
type Scope = { enter<Result>(key: string, body: () => Result): Result };

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
const nap = (ms: number): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

/**
 * One module's probe — the text the transform emits, as module `m` with eight
 * regions — evaluated against a realm of the test's own.
 *
 * The holder stands in for `globalThis`: the collector claims `__VA__` on
 * whatever it is handed, and this suite is itself recorded through the real
 * one. The module finishes evaluating before any case opens, as a test file's
 * imports do.
 */
function probeIn(holder: object): Probe {
  const runtime = PROBE_RUNTIME.replace('.r(0,0)', '.r("m",8)');
  expect(runtime).not.toBe(PROBE_RUNTIME);
  return new Function('globalThis', `${runtime}__vaE();return __va;`)(holder) as Probe;
}

/**
 * Case A enters 1 and 2 across an await, and leaves a continuation that enters
 * 5 and 6 long after the case itself is over. Case B enters 3 and 4, entirely
 * inside A's window. This is one `describe.concurrent` block, in miniature.
 */
function cases(va: Probe) {
  return {
    alpha: async (): Promise<void> => {
      va(1);
      await nap(10);
      va(2);
    },
    beta: async (): Promise<void> => {
      va(3);
      await nap(4);
      va(4);
    },
    floating: (): void => {
      void nap(30).then(() => {
        va(5);
        va(6);
      });
    },
  };
}

/**
 * The ordinals each frame holds for `m`, by case, read back through the
 * journal codec the way the reader reads a `.vac`. A case that outlived itself
 * arrives as two frames, joined here the way the reader joins them.
 */
function report(collector: ReturnType<typeof collectors.scoped>): Record<string, unknown> {
  const seen: Record<string, number[]> = {};
  const ambient = journals.packCase('', '', '');
  for (const frame of journals.unpackFrames(journals.packFrames(collector.finish('').frames ?? []))) {
    const { testFile, modules } = journals.decodeJournal(frame);
    const row = modules.find((module) => module.id === 'm');
    if (row === undefined) continue;
    // These keys are bare, so a frame named `A\0finished` holds the key in its first field.
    const name = testFile === ambient ? 'ambient' : journals.unpackCase(testFile).file;
    // Ordinal 0 is the module itself, which every bucket it was touched in
    // holds: the ambient bucket has it from the module's evaluation alone.
    const ordinals = row.hits.filter((ordinal) => ordinal > 0);
    if (ordinals.length === 0) continue;
    seen[name] = [...new Set([...(seen[name] ?? []), ...ordinals])].sort((left, right) => left - right);
  }
  return { ...seen, late: collector.runaways() };
}

/** The async-context collector, driven through one interleaving. */
async function scoped(): Promise<Record<string, unknown>> {
  const holder: Record<PropertyKey, unknown> = {};
  const collector = collectors.scoped(holder, true);
  const { alpha, beta, floating } = cases(probeIn(holder));
  const scope = holder[CASE_SCOPE] as Scope;
  await Promise.all([
    scope.enter('A', async () => {
      await alpha();
      floating();
    }),
    scope.enter('B', beta),
  ]);
  await nap(60);
  return report(collector);
}

/**
 * The default collector — one case at a time, the case running now in a
 * variable — over three cases that never overlap, the last of which leaves work
 * behind.
 */
async function sequential(): Promise<Record<string, unknown>> {
  const holder: Record<PropertyKey, unknown> = {};
  const collector = collectors.scoped(holder, false);
  const { alpha, beta, floating } = cases(probeIn(holder));
  const scope = holder[CASE_SCOPE] as Scope;
  await scope.enter('A', alpha);
  await scope.enter('B', beta);
  // Synchronous to the harness, async underneath: the case is over the instant
  // it returns, and its work is not.
  scope.enter('C', () => {
    floating();
  });
  await nap(60);
  return report(collector);
}

/** The same default collector, handed two cases at once. */
async function tangled() {
  const holder: Record<PropertyKey, unknown> = {};
  const collector = collectors.scoped(holder, false);
  const { alpha, beta } = cases(probeIn(holder));
  const scope = holder[CASE_SCOPE] as Scope;
  const warnings: string[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
  try {
    await Promise.all([scope.enter('A', alpha), scope.enter('B', beta)]);
  } finally {
    warn.mockRestore();
  }
  const { modules, frames } = collector.finish('');
  const entered = modules.get('m') ?? new Uint32Array(8);
  return {
    warnings,
    frames,
    entered: [...entered.keys()].filter((at) => at > 0 && entered[at] !== 0),
  };
}

/**
 * Snapshot-and-subtract over the same interleaving: the file-level collector
 * this package ships, with a copy taken where `beforeEach` runs and the
 * difference read where `afterEach` does.
 */
async function subtract(): Promise<Record<string, number[]>> {
  const holder: Record<PropertyKey, unknown> = {};
  const collector = collectors.flat(holder);
  const { alpha, beta, floating } = cases(probeIn(holder));
  const entered = (): Uint32Array => collector.seal('').get('m') ?? new Uint32Array(8);
  const seen: Record<string, number[]> = {};
  const around = async (key: string, body: () => Promise<void>): Promise<void> => {
    const before = entered();
    await body();
    const after = entered();
    seen[key] = [...after.keys()].filter((at) => after[at] !== 0 && before[at] === 0);
  };
  await Promise.all([
    around('A', async () => {
      await alpha();
      floating();
    }),
    around('B', beta),
  ]);
  await nap(60);
  return seen;
}

describe('attributing crossings while two cases are in flight', () => {
  it('gives each case what it entered, including after the case is over', async () => {
    expect(await scoped()).toEqual({
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
    expect(await sequential()).toEqual({
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

  it('records the file whole when two cases open at once, rather than charging one to the other', async () => {
    const { warnings, frames, entered } = await tangled();
    // Both cases still ran: recording never fails a test the suite would pass.
    expect(entered).toEqual([1, 2, 3, 4]);
    // No case frame, so no case can be skipped on this file's record.
    expect(frames).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('A was still running when B started');
    expect(warnings[0]).toContain('continuations: true');
  });

  it('is what snapshot-and-subtract cannot do at any price', async () => {
    const drained = await subtract();

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
