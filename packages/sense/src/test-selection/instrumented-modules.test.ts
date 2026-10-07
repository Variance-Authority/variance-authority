import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  crossingsOf,
  defaultInclude,
  loadedOf,
  type ReadJournal,
} from './instrumented-modules.js';
import type { ModuleId } from '../instrument/index.js';

describe('what the default include calls product source', () => {
  const root = resolve('/repo');

  it('takes an ordinary module', () => {
    expect(defaultInclude(resolve(root, 'src/cart.ts'))).toBe(true);
  });

  it('leaves a config file alone, because no setup shim runs where one is read', () => {
    // A config module is evaluated by the loader, in the Vitest process, before
    // any test environment exists. Instrumented, its first probe throws and the
    // run dies before a test file loads.
    for (const file of [
      'vite.config.ts',
      'vitest.config.ts',
      'vitest.config.mts',
      'vitest.checks.config.ts',
      'jest.config.js',
    ]) expect([file, defaultInclude(resolve(root, file))]).toEqual([file, false]);
  });

  it('still takes a module that only has `config` in its name', () => {
    expect(defaultInclude(resolve(root, 'src/config.ts'))).toBe(true);
    expect(defaultInclude(resolve(root, 'src/app-config.ts'))).toBe(true);
  });
});

describe('the fold of a run\'s journals', () => {
  const journals: readonly ReadJournal[] = [
    { testFile: 'test/alpha.case.ts', modules: [{ id: 'src/cart.js', hits: [0, 1, 2], shared: [0, 1], loaded: [0, 1] }] },
    { testFile: 'test/beta.case.ts', modules: [{ id: 'src/cart.js', hits: [0, 3], shared: [0], loaded: [0] }] },
    { testFile: 'test/gamma.case.ts', modules: [] },
  ];
  const rows = (fold: ReadonlyMap<ModuleId, ReadonlyMap<number, ReadonlySet<string>>>): unknown =>
    [...fold.get('src/cart.js')!].map(([ordinal, tests]) => [ordinal, [...tests].sort()]);

  it('credits what a module did while evaluating to every file that consumed it', () => {
    expect(rows(crossingsOf(journals))).toEqual([
      [0, ['test/alpha.case.ts', 'test/beta.case.ts']],
      [1, ['test/alpha.case.ts', 'test/beta.case.ts']],
      [2, ['test/alpha.case.ts']],
      [3, ['test/beta.case.ts']],
    ]);
  });

  it('folds what ran before the first test under the same crediting', () => {
    // Ordinal 1 ran while the module evaluated, and evaluation happened before
    // the first test of every file that consumed it — beta included, whose own
    // snapshot never saw it because alpha's window evaluated the module.
    expect(rows(loadedOf(journals))).toEqual([
      [0, ['test/alpha.case.ts', 'test/beta.case.ts']],
      [1, ['test/alpha.case.ts', 'test/beta.case.ts']],
    ]);
  });
});
