import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { testHops } from './coverage-distance.js';
import { earnedCoverage } from './coverage-earned.js';
import type { ExecutionBlock, ExecutionIndex } from './reverse.js';

// ui/button imports ui/icon; app/page imports ui/button; each test imports its own file.
const relations = relationsOfFiles([
  { file: 'ui/icon.ts', edges: [] },
  { file: 'ui/button.ts', edges: [{ to: 'ui/icon.ts', kind: 'imports' }] },
  { file: 'ui/button.test.ts', edges: [{ to: 'ui/button.ts', kind: 'imports' }] },
  { file: 'app/page.ts', edges: [{ to: 'ui/button.ts', kind: 'imports' }] },
  { file: 'app/page.test.ts', edges: [{ to: 'app/page.ts', kind: 'imports' }] },
]);
const ownerOf = (file: string): string => file.split('/')[0]!;

const BUTTON = { id: 'button', file: 'ui/button.test.ts', name: 'clicks', stopped: false };
const PAGE = { id: 'page', file: 'app/page.test.ts', name: 'renders', stopped: false };

function block(path: string, crossings: ExecutionBlock['crossings']): ExecutionBlock {
  return { kind: 'function', name: path, path, startLine: 1, endLine: 3, source: true, crossings };
}
const ran = (...tests: number[]): ExecutionBlock['crossings'] => tests.map((test) => ({ test, distance: 0 }));

const unit: ExecutionIndex = {
  tests: [BUTTON, PAGE],
  modules: [
    {
      file: 'ui/button.ts',
      blocks: [
        block('both', ran(0, 1)), // its own test one hop away, and another package's: in and out
        block('page', ran(1)), // only another package's test: out alone, accidental
        block('loaded', [{ test: 1, distance: 0, loaded: true }]), // loading runs nothing
        block('idle', []),
      ],
    },
    { file: 'ui/icon.ts', blocks: [block('far', ran(0))] }, // its own test, two hops away: out alone
    { file: 'app/page.ts', blocks: [block('render', ran(1))] }, // its own test, one hop away: in
    { file: 'ui/button.test.ts', blocks: [block('suite', ran(0))] }, // a test file runs itself
  ],
};

describe('coverage a package earns with its own near tests, against what it gets from the rest', () => {
  it('counts a region in when its own package runs it from one hop, out when any other test runs it, and accidental when only out', () => {
    const { suites: [counted] } = earnedCoverage([{ name: 'unit', kind: 'unit', index: unit }], ownerOf, testHops([unit], { relations }));

    expect(counted).toEqual({ name: 'unit', kind: 'unit', regions: 6, in: 2, out: 3, accidental: 2, unmeasured: 0 });
  });

  it('joins a region across suites, so one suite earning it makes it in for the total', () => {
    const e2e: ExecutionIndex = {
      tests: [PAGE],
      modules: [{ file: 'app/page.ts', blocks: [block('render', ran(0))] }, { file: 'ui/button.ts', blocks: [block('both', ran(0)), block('page', ran(0))] }],
    };
    const own: ExecutionIndex = { tests: [BUTTON], modules: [{ file: 'ui/button.ts', blocks: [block('both', ran(0)), block('page', [])] }] };
    const { suites, total } = earnedCoverage(
      [{ name: 'e2e', kind: 'e2e', index: e2e }, { name: 'unit', kind: 'unit', index: own }],
      ownerOf,
      testHops([e2e, own], { relations }),
    );

    expect(suites.map((suite) => [suite.name, suite.in, suite.accidental])).toEqual([['e2e', 1, 2], ['unit', 1, 0]]);
    expect(total).toEqual({ regions: 3, in: 2, out: 2, accidental: 1, unmeasured: 0 });
  });

  it('earns nothing from a test no walk placed, and counts what only such tests ran as unmeasured', () => {
    const stray = { id: 'stray', file: 'ui/stray.test.ts', name: 'wanders', stopped: false };
    const index: ExecutionIndex = { tests: [stray], modules: [{ file: 'ui/icon.ts', blocks: [block('far', ran(0))] }] };
    const { total } = earnedCoverage([{ index }], ownerOf, testHops([index], { relations }));

    expect(total).toEqual({ regions: 1, in: 0, out: 1, accidental: 1, unmeasured: 1 });
  });
});
