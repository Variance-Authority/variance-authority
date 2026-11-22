import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultInclude, fileOrNone } from './instrumented-modules.js';

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

describe('the file a module is read from', () => {
  it('is none, and nothing is read, for a virtual module named by no absolute path or by one holding `\\0`', () => {
    const asked: string[] = [];
    const read = (path: string) => {
      asked.push(path);
      return 'export {};\n';
    };

    expect(fileOrNone('virtual:stories', read)).toBeUndefined();
    expect(fileOrNone(`${resolve('/repo')}/\0virtual`, read)).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
