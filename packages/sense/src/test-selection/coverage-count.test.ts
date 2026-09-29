import { describe, expect, it } from 'vitest';
import { countCoverage, coverageChange, type SuiteChange } from './coverage-count.js';
import type { ExecutionBlock, ExecutionIndex, ExecutionModule } from './reverse.js';

const A = { id: 'a.test.ts > one', file: 'a.test.ts', name: 'one', stopped: false };
const B = { id: 'b.test.ts > two', file: 'b.test.ts', name: 'two', stopped: false };

function block(name: string, tests: readonly number[], extra: Partial<ExecutionBlock> = {}): ExecutionBlock {
  return {
    kind: 'function', name, path: 'entry', startLine: 1, endLine: 3, source: true,
    crossings: tests.map((test) => ({ test, distance: 0 })),
    ...extra,
  };
}

function index(...modules: ExecutionModule[]): ExecutionIndex {
  return { tests: [A, B], modules };
}

function module(file: string, ...blocks: ExecutionBlock[]): ExecutionModule {
  return { file, blocks };
}

describe('how much of what the suites loaded each suite ran', () => {
  it('counts every suite over the regions any suite loaded, and the overlap by kind', () => {
    const unit = index(module('src/total.ts', block('apply', [0]), block('round', [0]), block('clamp', [])));
    const e2e = index(
      module('src/total.ts', block('apply', [1]), block('round', []), block('clamp', [])),
      module('src/pay.ts', block('charge', [0])),
    );

    const count = countCoverage([
      { name: 'unit', kind: 'unit', index: unit },
      { name: 'checkout', kind: 'e2e', index: e2e },
    ]);

    expect(count).toMatchObject({ regions: 4, files: 2, run: 3, load: 0, none: 1, unjoined: 0 });
    expect(count.suites.map((suite) => [suite.name, suite.run, suite.regions])).toEqual([
      ['unit', 2, 3],
      ['checkout', 2, 4],
    ]);
    expect(count.overlap).toEqual({ several: 1, alone: { unit: 1, e2e: 1 } });
  });

  it('counts two suites of one kind as one kind', () => {
    const one = index(module('src/total.ts', block('apply', [0])));
    const two = index(module('src/total.ts', block('apply', [1])));

    const count = countCoverage([
      { name: 'checkout', kind: 'e2e', index: one },
      { name: 'account', kind: 'e2e', index: two },
    ]);

    expect(count.overlap).toEqual({ several: 0, alone: { e2e: 1 } });
  });

  it('counts a region that ran only while its module evaluated apart from one a case called into', () => {
    const record = index(module(
      'src/total.ts',
      block('<module>', [], { loaded: true }),
      block('init', [0], { crossings: [{ test: 0, distance: 0, loaded: true }] }),
      block('apply', [0]),
    ));

    expect(countCoverage([{ index: record }])).toMatchObject({ regions: 3, run: 1, load: 2, none: 0 });
  });

  it('counts no region that has no source of its own', () => {
    const record = index(module('src/total.ts', block('apply', [0]), block('lowered', [0], { source: false })));

    expect(countCoverage([{ index: record }])).toMatchObject({ regions: 1, run: 1 });
  });

  it('prints no overlap for one record with no kind', () => {
    const count = countCoverage([{ index: index(module('src/total.ts', block('apply', [0]))) }]);

    expect(count.overlap).toBeUndefined();
    expect(count.suites).toEqual([{ run: 1, load: 0, regions: 1 }]);
  });

  it('counts a region two suites cut differently as not joined, under each suite that holds it', () => {
    const unit = index(module('src/total.ts', block('apply', [0]), block('apply', [0], { path: 'entry/if#0/then', kind: 'branch' })));
    const e2e = index(module('src/total.ts', block('apply', [1])));

    const count = countCoverage([
      { name: 'unit', kind: 'unit', index: unit },
      { name: 'checkout', kind: 'e2e', index: e2e },
    ]);

    expect(count).toMatchObject({ regions: 2, run: 2, unjoined: 1 });
    expect(count.overlap).toEqual({ several: 1, alone: { unit: 1, e2e: 0 } });
  });

  it.todo('tells a source file a seam loaded and chose not to instrument from one no suite loaded — needs each seam to publish which files it would instrument, so the count is not a guess at its include and exclude patterns');
});

describe('what changed one suite\'s count', () => {
  function sums(change: SuiteChange): { run: number; regions: number } {
    return {
      run: change.gained - change.lost - change.hidden + change.written.run - change.deleted.run + change.arrived.run - change.departed.run,
      regions: change.written.regions - change.deleted.regions + change.arrived.regions - change.departed.regions,
    };
  }

  it('is the motion plus the regions written and deleted, and the parts add up to the change in the count', () => {
    const base = index(
      module('src/total.ts', block('apply', [0]), block('round', []), block('gone', [1])),
      module('src/old.ts', block('legacy', [0]), block('unused', [])),
    );
    const now = index(
      module('src/total.ts', block('apply', []), block('round', [1]), block('fresh', [0]), block('idle', [])),
      module('src/new.ts', block('shiny', [1])),
    );

    const change = coverageChange(base, now);
    const [was] = countCoverage([{ index: base }]).suites;
    const [is] = countCoverage([{ index: now }]).suites;

    expect(change).toMatchObject({
      gained: 1,
      lost: 1,
      written: { regions: 2, run: 1 },
      deleted: { regions: 1, run: 1 },
      arrived: { regions: 1, run: 1, files: ['src/new.ts'] },
      departed: { regions: 2, run: 1, files: ['src/old.ts'] },
    });
    expect(sums(change)).toEqual({ run: is!.run - was!.run, regions: is!.regions - was!.regions });
  });

  it('counts a region whose kind changed under one address as deleted and written, since the motion never paired it', () => {
    const base = index(module('src/total.ts', block('apply', [0])));
    const now = index(module('src/total.ts', block('apply', [0], { kind: 'method' })));

    const change = coverageChange(base, now);

    expect(change).toMatchObject({ gained: 0, lost: 0, written: { regions: 1, run: 1 }, deleted: { regions: 1, run: 1 } });
    expect(sums(change)).toEqual({ run: 0, regions: 0 });
  });

  it('counts a loss behind a stopped case as hidden, and still adds up', () => {
    const base = index(module('src/total.ts', block('apply', [0, 1])));
    const now: ExecutionIndex = { tests: [A, { ...B, stopped: true }], modules: [module('src/total.ts', block('apply', []))] };

    const change = coverageChange(base, now);

    expect(change).toMatchObject({ hidden: 1, lost: 0 });
    expect(sums(change).run).toBe(-1);
  });
});
