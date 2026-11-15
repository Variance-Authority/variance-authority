// The carried row's two crossing lists.

import { describe, expect, it } from 'vitest';
import { crossedBlock } from './carried-rows.js';
import type { CoverageBlock } from './index.js';

const row: CoverageBlock = {
  ordinal: 1,
  kind: 'function',
  owner: 0,
  digest: 'd',
  name: 'apply',
  path: 'if#0',
  source: true,
  testFiles: ['b.test.ts'],
};

describe('crossedBlock', () => {
  it('writes both lists distinct and in code-unit order', () => {
    expect(crossedBlock(row, ['b.test.ts', 'a.test.ts', 'b.test.ts'], ['b.test.ts', 'b.test.ts'])).toEqual({
      ...row,
      testFiles: ['a.test.ts', 'b.test.ts'],
      loadedBy: ['b.test.ts'],
    });
  });

  it('drops a `loadedBy` the new lists leave empty, since absent is the same fact', () => {
    const crossed = crossedBlock({ ...row, loadedBy: ['b.test.ts'] }, ['a.test.ts'], []);
    expect(crossed).toEqual({ ...row, testFiles: ['a.test.ts'] });
    expect('loadedBy' in crossed).toBe(false);
  });
});
