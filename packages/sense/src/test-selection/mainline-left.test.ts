import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { leftToMainline } from './mainline-left.js';
import type { ExecutionNarrowing, SelectionReason } from './narrowing.js';

// Each test imports its own module; the record charged both through a mainline change to `src/total.ts`.
const relations = relationsOfFiles([
  { file: 'src/total.ts' },
  { file: 'src/other.ts' },
  { file: 'test/total.test.ts', edges: [{ to: 'src/total.ts', kind: 'imports' as const }] },
  { file: 'test/other.test.ts', edges: [{ to: 'src/other.ts', kind: 'imports' as const }] },
]);
const region = (file: string): SelectionReason => ({ kind: 'region', file, name: 'total', path: 'total', startLine: 1, endLine: 3 });
const narrowing: ExecutionNarrowing = {
  whole: ['test/other.test.ts', 'test/total.test.ts'],
  entered: ['test/other.test.ts', 'test/total.test.ts'],
  unread: [],
  because: [
    { test: 'test/other.test.ts', via: [region('src/total.ts')] },
    { test: 'test/total.test.ts', via: [region('src/total.ts')] },
  ],
};

describe('leftToMainline', () => {
  it('keeps the test the checkout change reaches through the graph and leaves the other', () => {
    const left = leftToMainline(narrowing, undefined, new Set(['src/other.ts']), relations);

    expect(left?.narrowing.entered).toEqual(['test/other.test.ts']);
    expect(left?.narrowing.because?.map((cause) => cause.test)).toEqual(['test/other.test.ts']);
    expect(left?.left).toBe(1);
  });

  it('leaves nothing when a reason names a file the checkout changed', () => {
    expect(leftToMainline(narrowing, undefined, new Set(['src/total.ts']), relations)).toBeUndefined();
  });
});
