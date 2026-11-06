import { describe, expect, it } from 'vitest';
import { coverageByOwner } from './coverage-owner.js';
import type { ExecutionBlock, ExecutionIndex, ExecutionModule } from './reverse.js';

const CORE = { id: 'core', file: 'packages/core/src/store.test.ts', name: 'stores', stopped: false };
const CLI = { id: 'cli', file: 'packages/cli/src/run.test.ts', name: 'runs', stopped: false };
const ROOT = { id: 'root', file: 'test/smoke.test.ts', name: 'boots', stopped: false };

function block(name: string, tests: readonly number[], extra: Partial<ExecutionBlock> = {}): ExecutionBlock {
  return {
    kind: 'function', name, path: 'entry', startLine: 1, endLine: 3, source: true,
    crossings: tests.map((test) => ({ test, distance: 0 })),
    ...extra,
  };
}

function index(...modules: ExecutionModule[]): ExecutionIndex {
  return { tests: [CORE, CLI, ROOT], modules };
}

function module(file: string, ...blocks: ExecutionBlock[]): ExecutionModule {
  return { file, blocks };
}

/** The package a file is in, by the directory it sits under. */
function ownerOf(file: string): string {
  const [, name] = /^packages\/([^/]+)\//u.exec(file) ?? [];
  return name === undefined ? '.' : `packages/${name}`;
}

describe('which package\'s tests ran each region', () => {
  it('counts a region its own package\'s tests ran as its own, whoever else ran it', () => {
    const [store] = coverageByOwner([{ index: index(module('packages/core/src/store.ts', block('put', [0, 1]))) }], ownerOf);

    expect(store).toEqual({ file: 'packages/core/src/store.ts', owner: 'packages/core', regions: 1, run: 1, own: 1, others: 0, by: {} });
  });

  it('counts a region only other packages\' tests ran apart, with every package that ran it', () => {
    const [store] = coverageByOwner([{
      index: index(module('packages/core/src/store.ts', block('put', [1, 2]), block('get', [1]), block('drop', [0]))),
    }], ownerOf);

    expect(store).toMatchObject({ regions: 3, run: 3, own: 1, others: 2, by: { 'packages/cli': 2, '.': 1 } });
  });

  it('leaves a region a case entered only while its module loaded out of every count but the regions', () => {
    const [store] = coverageByOwner([{
      index: index(module('packages/core/src/store.ts', block('module', [], { loaded: true }), {
        ...block('init', [1]),
        crossings: [{ test: 1, distance: 0, loaded: true }],
      })),
    }], ownerOf);

    expect(store).toMatchObject({ regions: 2, run: 0, own: 0, others: 0, by: {} });
  });

  it('joins one region across suites, so a suite of the own package claims what another suite\'s foreign test ran', () => {
    const files = coverageByOwner([
      { index: index(module('packages/core/src/store.ts', block('put', [1]))) },
      { index: index(module('packages/core/src/store.ts', block('put', [0]))) },
    ], ownerOf);

    expect(files).toEqual([{ file: 'packages/core/src/store.ts', owner: 'packages/core', regions: 1, run: 1, own: 1, others: 0, by: {} }]);
  });

  it('skips a synthesized region, and lists files in code-unit order', () => {
    const files = coverageByOwner([{
      index: index(
        module('packages/core/src/b.ts', block('b', [1])),
        module('packages/core/src/a.ts', block('a', [1]), block('helper', [1], { source: false })),
      ),
    }], ownerOf);

    expect(files.map((file) => [file.file, file.regions])).toEqual([['packages/core/src/a.ts', 1], ['packages/core/src/b.ts', 1]]);
  });

  it('leaves out a test file, which its own tests run by being one', () => {
    const files = coverageByOwner([{
      index: index(module('packages/core/src/store.test.ts', block('module', [0])), module('packages/core/src/store.ts', block('put', [1]))),
    }], ownerOf);

    expect(files.map((file) => file.file)).toEqual(['packages/core/src/store.ts']);
  });

  it('leaves a test file out of every suite once one suite runs it as a test', () => {
    const helper = { index: { tests: [], modules: [module(CORE.file, block('stores', []))] } };

    expect(coverageByOwner([{ index: index() }, helper], ownerOf)).toEqual([]);
  });

  it('counts a package named like an object\'s own property as any other', () => {
    const names: Record<string, string> = { 'a.test.ts': 'constructor', 'b.test.ts': '__proto__', 'x.ts': 'libs/x' };
    const tests = ['a.test.ts', 'b.test.ts'].map((file) => ({ id: file, file, name: file, stopped: false }));

    const [file] = coverageByOwner([{ index: { tests, modules: [module('x.ts', block('x', [0, 1]))] } }], (at) => names[at]!);

    expect(Object.entries(file!.by)).toEqual([['__proto__', 1], ['constructor', 1]]);
  });
});
