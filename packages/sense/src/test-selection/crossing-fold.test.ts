import { describe, expect, it } from 'vitest';
import journals from './journal-format.cjs';
import { crossingsOf, loadedOf } from './instrumented-modules.js';
import { foldCrossings } from './crossing-fold.js';
import { openCrossingSets } from './crossing-sets.js';

const EVALUATING = 0x80000000;

/** A deterministic stream, so a failing case is the same case next run. */
const stream = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
};

interface Run {
  readonly tests: readonly string[];
  readonly modules: readonly string[];
  readonly ordinals: number;
  readonly frames: readonly Uint8Array[];
}

/** A run of journals, and the shape a fold would be told about it. */
function run(seed: number, tests: number, modules: number, ordinals: number): Run {
  const next = stream(seed);
  const testFiles = Array.from({ length: tests }, (_, at) => `t/${at}.test.ts`);
  const moduleIds = Array.from({ length: modules }, (_, at) => `m/${at}.ts`);
  const frames = testFiles.map((file) => {
    const entered = new Map<string, Uint32Array>();
    const before = new Map<string, Uint32Array>();
    for (const id of moduleIds) {
      if (next() < 0.4) continue;
      const counters = new Uint32Array(ordinals);
      for (let ordinal = 0; ordinal < ordinals; ordinal += 1) {
        if (next() < 0.5) continue;
        counters[ordinal] = next() < 0.25 ? EVALUATING + 1 : 1;
      }
      entered.set(id, counters);
      if (next() < 0.5) {
        const early = new Uint32Array(ordinals);
        for (let ordinal = 0; ordinal < ordinals; ordinal += 1) {
          if (counters[ordinal] !== 0 && next() < 0.4) early[ordinal] = counters[ordinal]!;
        }
        before.set(id, early);
      }
    }
    return journals.encodeJournal(file, entered, before);
  });
  return { tests: testFiles, modules: moduleIds, ordinals, frames };
}

/** What the fold is asked, from the same run, region by region. */
function folded(held: Run, budget?: number) {
  const testId = new Map(held.tests.map((file, at) => [file, at]));
  const rowOf = new Map(held.modules.map((id, at) => [id, at]));
  const moduleBlocks = Uint32Array.from(
    { length: held.modules.length + 1 },
    (_, at) => at * held.ordinals,
  );
  const result = foldCrossings({
    replay: (visit) => {
      for (const frame of held.frames) journals.scanJournal(frame, visit);
    },
    testId,
    rowOf: (id) => rowOf.get(id as string),
    moduleBlocks,
    ...(budget === undefined ? {} : { budget }),
  });
  const entered = openCrossingSets(result.enteredSets.pool());
  const loaded = openCrossingSets(result.loadedSets.pool());
  // The fold answers in test-id order, which is the order the snapshot holds
  // the tests in; the rows answer in whatever order a `Set` was filled. What is
  // being compared is which tests, so both are sorted the same way.
  const names = (set: number, view: typeof entered): string[] =>
    [...view.members(set)].map((test) => held.tests[test]!).sort();
  return {
    passes: result.passes,
    entered: (module: number, ordinal: number) =>
      names(result.entered[module * held.ordinals + ordinal]!, entered),
    loaded: (module: number, ordinal: number) =>
      names(result.loaded[module * held.ordinals + ordinal]!, loaded),
  };
}

/** What the shipped fold says, from the same frames read as rows. */
function directly(held: Run) {
  const rows = held.frames.map((frame) => journals.decodeJournal(frame));
  const observed = crossingsOf(rows);
  const early = loadedOf(rows);
  const sorted = (
    relation: ReturnType<typeof crossingsOf>,
    module: number,
    ordinal: number,
  ): string[] => [...(relation.get(held.modules[module]!)?.get(ordinal) ?? [])].sort();
  return {
    entered: (module: number, ordinal: number) => sorted(observed, module, ordinal),
    loaded: (module: number, ordinal: number) => sorted(early, module, ordinal),
  };
}

describe('folding a run out of its journals', () => {
  it('names the tests a fold over the rows names, region for region', () => {
    const held = run(20250915, 24, 40, 6);
    const fold = folded(held);
    const rows = directly(held);
    for (let module = 0; module < held.modules.length; module += 1) {
      for (let ordinal = 0; ordinal < held.ordinals; ordinal += 1) {
        expect(fold.entered(module, ordinal)).toEqual(rows.entered(module, ordinal));
        expect(fold.loaded(module, ordinal)).toEqual(rows.loaded(module, ordinal));
      }
    }
  });

  it('says the same however few modules it holds at a time', () => {
    const held = run(4242, 20, 32, 5);
    const rows = directly(held);
    const wide = folded(held);
    expect(wide.passes).toBe(1);

    // Small enough that a slice is a module or two, so the journals are read
    // many times and every region still has to come out complete.
    const narrow = folded(held, 1);
    expect(narrow.passes).toBeGreaterThan(8);
    for (let module = 0; module < held.modules.length; module += 1) {
      for (let ordinal = 0; ordinal < held.ordinals; ordinal += 1) {
        expect(narrow.entered(module, ordinal)).toEqual(rows.entered(module, ordinal));
        expect(narrow.loaded(module, ordinal)).toEqual(rows.loaded(module, ordinal));
      }
    }
  });

  it('credits an evaluation-time region to everything that consumed the module', () => {
    const shared = new Uint32Array([EVALUATING + 1, 1]);
    const alone = new Uint32Array([0, 1]);
    const frames = [
      journals.encodeJournal('t/0.test.ts', new Map([['m/0.ts', shared]])),
      journals.encodeJournal('t/1.test.ts', new Map([['m/0.ts', alone]])),
      journals.encodeJournal('t/2.test.ts', new Map<string, Uint32Array>()),
    ];
    const held: Run = {
      tests: ['t/0.test.ts', 't/1.test.ts', 't/2.test.ts'],
      modules: ['m/0.ts'],
      ordinals: 2,
      frames,
    };
    const fold = folded(held);
    // Ordinal 0 was entered while the module evaluated, in the first file's
    // window; the second file consumed what that evaluation made and the third
    // never entered the module at all.
    expect(fold.entered(0, 0)).toEqual(['t/0.test.ts', 't/1.test.ts']);
    expect(fold.entered(0, 1)).toEqual(['t/0.test.ts', 't/1.test.ts']);
    expect(fold.entered(0, 0)).toEqual(directly(held).entered(0, 0));
  });

  it('drops an ordinal past the regions the module has', () => {
    const held: Run = {
      tests: ['t/0.test.ts'],
      modules: ['m/0.ts'],
      ordinals: 2,
      // Four counters where the module is known to have two regions: the file
      // this journal was written against is not the file on disk any more.
      frames: [journals.encodeJournal('t/0.test.ts', new Map([['m/0.ts', new Uint32Array([1, 0, 1, 1])]]))],
    };
    const fold = folded(held);
    expect(fold.entered(0, 0)).toEqual(['t/0.test.ts']);
    expect(fold.entered(0, 1)).toEqual([]);
  });

  it('holds nothing for a run with no tests or no modules', () => {
    const empty = folded({ tests: [], modules: [], ordinals: 0, frames: [] });
    expect(empty.passes).toBe(0);
  });
});

describe('reading a frame without rows', () => {
  it('reports what decoding it into rows reports', () => {
    const counters = new Map<string, Uint32Array>([
      ['m/0.ts', new Uint32Array([1, 0, EVALUATING + 2, 5])],
      [`m/1.ts`, new Uint32Array([0, 3])],
    ]);
    const early = new Map<string, Uint32Array>([['m/0.ts', new Uint32Array([1, 0, 0, 0])]]);
    const frame = journals.encodeJournal('t/0.test.ts', counters, early);

    const seen: Array<[string, number[], number[], number[]]> = [];
    let file = '';
    journals.scanJournal(frame, {
      test: (name: string) => { file = name; },
      module: (id: string, hits: Uint32Array, shared: Uint32Array, loaded: Uint32Array) => {
        seen.push([id, [...hits], [...shared], [...loaded]]);
      },
    });
    const rows = journals.decodeJournal(frame);
    expect(file).toBe(rows.testFile);
    expect(seen).toEqual(rows.modules.map((row) => [row.id, row.hits, row.shared, row.loaded]));
  });

  it('steps over the modules a reader does not want', () => {
    const counters = new Map<string, Uint32Array>([
      ['m/0.ts', new Uint32Array([1, 1, 1])],
      ['m/1.ts', new Uint32Array([0, 1, 0])],
      ['m/2.ts', new Uint32Array([1, 0, 1])],
    ]);
    const frame = journals.encodeJournal('t/0.test.ts', counters);
    const seen: string[] = [];
    journals.scanJournal(frame, {
      test: () => {},
      wants: (id: string) => id === 'm/1.ts',
      module: (id: string, hits: Uint32Array) => {
        seen.push(`${id}:${[...hits].join(',')}`);
      },
    });
    expect(seen).toEqual(['m/1.ts:1']);
  });

  it('refuses a frame that does not end where it says', () => {
    const frame = journals.encodeJournal('t/0.test.ts', new Map([['m/0.ts', new Uint32Array([1])]]));
    expect(() => journals.scanJournal(frame.subarray(0, frame.length - 1), { test: () => {}, module: () => {} }))
      .toThrow(/not a variance-authority journal/);
  });
});
