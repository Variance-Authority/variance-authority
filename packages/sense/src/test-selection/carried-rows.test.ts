// The carried row's two crossing lists, and the seats a re-cut is compared by.

import { describe, expect, it } from 'vitest';
import { crossedBlock, sameNumbering } from './carried-rows.js';
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

describe('sameNumbering', () => {
  const at = (path: string) => ({ name: 'apply', path });

  it('holds where every counter both readings share gave the same seats', () => {
    expect(sameNumbering([at('if#0'), at('if#1')], [at('if#1'), at('if#0')])).toBe(true);
  });

  it('fails where a counter of the same size gave other seats', () => {
    expect(sameNumbering([at('if#0'), at('if#1')], [at('if#0'), at('if#2')])).toBe(false);
  });

  it('fails where a counter changed population', () => {
    expect(sameNumbering([at('if#0')], [at('if#0'), at('if#1')])).toBe(false);
  });

  it('holds where a counter is gone from the second reading', () => {
    expect(sameNumbering([at('if#0'), at('for#0')], [at('if#0')])).toBe(true);
  });
});
