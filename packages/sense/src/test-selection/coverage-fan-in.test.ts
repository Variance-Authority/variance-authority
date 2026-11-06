import { describe, expect, it } from 'vitest';
import { coverageFanIn } from './coverage-fan-in.js';
import type { ExecutionBlock, ExecutionIndex, ExecutionModule, ExecutionTest } from './reverse.js';

function test(file: string, duration?: number): ExecutionTest {
  return { id: `${file} > one`, file, name: 'one', stopped: false, ...(duration === undefined ? {} : { duration }) };
}

function block(name: string, tests: readonly number[], extra: Partial<ExecutionBlock> = {}): ExecutionBlock {
  return {
    kind: 'function', name, path: `entry/${name}`, startLine: 1, endLine: 3, source: true,
    crossings: tests.map((at) => ({ test: at, distance: 0 })),
    ...extra,
  };
}

function index(tests: readonly ExecutionTest[], ...modules: ExecutionModule[]): ExecutionIndex {
  return { tests, modules };
}

function module(file: string, ...blocks: ExecutionBlock[]): ExecutionModule {
  return { file, blocks };
}

const FOUR = [test('a.test.ts', 10), test('b.test.ts', 20), test('c.test.ts', 30), test('d.test.ts', 40)];

describe('how many test files each region and each file sends to a change', () => {
  it('counts, per kind, how many test files called into each region it ran', () => {
    const unit = index(FOUR, module('src/total.ts', block('apply', [0, 1, 2]), block('round', [3]), block('clamp', [])));
    const e2e = index([test('flow.test.ts')], module('src/total.ts', block('apply', [0]), block('round', []), block('clamp', [])));

    const fanIn = coverageFanIn([
      { name: 'unit', kind: 'unit', index: unit },
      { name: 'checkout', kind: 'e2e', index: e2e },
    ]);

    expect(fanIn.kinds).toEqual([
      { kind: 'unit', testFiles: 4, regions: 2, one: 1, median: 1, p90: 3, max: 3 },
      { kind: 'e2e', testFiles: 1, regions: 1, one: 1, median: 1, p90: 1, max: 1 },
    ]);
  });

  it('counts a test file once per region however many of its cases called in', () => {
    const twice = [test('a.test.ts'), test('a.test.ts')];
    const fanIn = coverageFanIn([{ index: index(twice, module('src/total.ts', block('apply', [0, 1]))) }]);

    expect(fanIn.kinds).toEqual([{ testFiles: 1, regions: 1, one: 1, median: 1, p90: 1, max: 1 }]);
    expect(fanIn.files[0]).toMatchObject({ entered: 1, peak: 1, one: 1 });
  });

  it('names the test files that entered a file beside the test files its busiest and its median region hold', () => {
    // Two halves with disjoint callers: one module in the shape of two.
    const record = index(FOUR, module('src/both.ts', block('left', [0, 1]), block('right', [2, 3]), block('both', [0, 1, 2])));

    const [file] = coverageFanIn([{ name: 'unit', kind: 'unit', index: record }]).files;

    expect(file).toEqual({
      file: 'src/both.ts', regions: 3, run: 3, one: 0,
      entered: 4, by: { unit: 4 }, peak: 3, median: 2,
      testFiles: 4, share: 1, duration: 1,
    });
  });

  it('counts no test file that only loaded the file, whether the crossing or the region says so', () => {
    const record = index(FOUR, module(
      'src/total.ts',
      block('<module>', [], { crossings: [0, 1, 2].map((at) => ({ test: at, distance: 0, loaded: true })) }),
      block('setup', [], { loaded: true }),
      block('apply', [0]),
    ));

    const [file] = coverageFanIn([{ index: record }]).files;

    expect(file).toMatchObject({ entered: 1, regions: 3, run: 1 });
    expect(file).not.toHaveProperty('loadedOnly');
  });

  it('weighs the test files a file sends by their share of the suite, and by time only when every case was timed', () => {
    const timed = index(FOUR, module('src/total.ts', block('apply', [0, 3])));
    const [file] = coverageFanIn([{ index: timed }]).files;
    expect(file).toMatchObject({ testFiles: 4, share: 0.5, duration: 0.5 });

    const untimed = index([...FOUR, test('e.test.ts')], module('src/total.ts', block('apply', [0, 3])));
    const [other] = coverageFanIn([{ index: untimed }]).files;
    expect(other).toMatchObject({ testFiles: 5, share: 0.4 });
    expect(other).not.toHaveProperty('duration');
  });

  it('joins a region across suites by its address and counts each suite\'s test files under its kind', () => {
    const unit = index(FOUR.slice(0, 2), module('src/total.ts', block('apply', [0, 1])));
    const e2e = index([test('flow.test.ts')], module('src/total.ts', block('apply', [0])));

    const [file] = coverageFanIn([
      { name: 'unit', kind: 'unit', index: unit },
      { name: 'checkout', kind: 'e2e', index: e2e },
    ]).files;

    expect(file).toMatchObject({ regions: 1, run: 1, one: 0, entered: 3, by: { unit: 2, e2e: 1 }, peak: 3, median: 3 });
  });

  it('counts nothing for a test file, and no region with no source of its own', () => {
    const record = index(FOUR, module('a.test.ts', block('suite', [0])), module('src/total.ts', block('apply', [1]), block('lowered', [1], { source: false })));

    const { files } = coverageFanIn([{ index: record }]);

    expect(files.map((one) => [one.file, one.regions])).toEqual([['src/total.ts', 1]]);
  });

  it('gives a kind whose test files called into nothing zero at every percentile', () => {
    const record = index(FOUR, module('src/total.ts', block('apply', [])));

    expect(coverageFanIn([{ index: record, kind: 'unit' }]).kinds).toEqual([{ kind: 'unit', testFiles: 4, regions: 0, one: 0, median: 0, p90: 0, max: 0 }]);
  });

  it('lists files in code-unit order', () => {
    const record = index(FOUR, module('src/b.ts', block('x', [0])), module('src/B.ts', block('x', [0])), module('src/a.ts', block('x', [0])));

    expect(coverageFanIn([{ index: record }]).files.map((one) => one.file)).toEqual(['src/B.ts', 'src/a.ts', 'src/b.ts']);
  });
});
