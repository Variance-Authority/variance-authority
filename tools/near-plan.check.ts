import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SuiteSelection } from '@variance-authority/sense/test-selection';
import { localNearFiles } from './near-plan.mjs';

const files = ['a.test.ts', 'b.test.ts', 'c.test.ts'];
const whole: SuiteSelection = { whole: new Set(files), skip: new Set(), declined: 'changed before entry', notes: [] };

describe('the repository local near wave', () => {
  it('defers a whole slice to CI, retaining directly edited collected tests', () => {
    expect(localNearFiles(whole, files, ['b.test.ts', 'deleted.test.ts'], true)).toEqual(['b.test.ts']);
    expect(localNearFiles(whole, files, [], true)).toEqual([]);
  });

  it('recognises a whole slice by collected membership, not a nonempty skip list alone', () => {
    expect(localNearFiles({ ...whole, declined: undefined, skip: new Set(['not-collected.test.ts']) }, files, [], true)).toEqual([]);
  });

  it('keeps canonical narrowed and empty selections on the existing runner path', () => {
    expect(localNearFiles({ ...whole, declined: undefined, skip: new Set(['c.test.ts']) }, files, [], true)).toBeUndefined();
    expect(localNearFiles({ ...whole, declined: undefined, only: new Set(['b.test.ts']) }, files, [], true)).toBeUndefined();
    expect(localNearFiles({ ...whole, declined: undefined, skip: new Set(files) }, files, [], true)).toBeUndefined();
    expect(localNearFiles(whole, [], [], true)).toBeUndefined();
  });

  it('never defers CI execution, and leaves full tests on their existing runner path', () => {
    expect(localNearFiles(whole, files, [], false)).toBeUndefined();
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(scripts.test).toBe('vitest run && vitest run --config vitest.integration.config.mts && vitest run --config vitest.chromium.config.mts');
    expect(scripts['verify:near']).toContain('node tools/near-tests.mjs');
    expect(scripts['verify:near']).toContain('node tools/gate.mjs stamp near');
  });
});
