import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { shadowedFor } from './shadowed.js';

describe('the files a test reaches only through its mocks', () => {
  // `cart.test.ts` mocks `total.ts`, which loads `rates.ts` and imports the
  // types of `money.ts`. The test itself imports the types of `rates.ts`.
  const relations = relationsOfFiles(
    [
      { file: 'test/cart.test.ts', edges: [{ to: 'src/total.ts', kind: 'imports' }, { to: 'src/rates.ts', kind: 'type' }] },
      { file: 'src/total.ts', edges: [{ to: 'src/rates.ts', kind: 'imports' }, { to: 'src/money.ts', kind: 'type' }] },
      { file: 'src/rates.ts' },
      { file: 'src/money.ts' },
    ],
    { shadows: new Map([['test/cart.test.ts', ['src/total.ts']]]) },
  );

  it('follows what the mock would have loaded, and no type-only import on either side', () => {
    // Nothing behind `import type` runs: the test's own type import does not
    // load `rates.ts` past the mock, and `money.ts` is nothing the mock would
    // have loaded.
    expect([...shadowedFor(relations)!('test/cart.test.ts')].sort()).toEqual(['src/rates.ts', 'src/total.ts']);
  });
});
