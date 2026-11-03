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

  it('leaves nothing when both sides changed the file every reason names', () => {
    expect(leftToMainline(narrowing, undefined, new Set(['src/total.ts']), relations)).toBeUndefined();
  });

  it('leaves every test when the checkout changed nothing a test is reached from', () => {
    expect(leftToMainline(narrowing, undefined, new Set(['README.md']), relations)?.narrowing.entered).toEqual([]);
  });

  it('keeps a test whose reason names a path the checkout removed, which no graph at the checkout holds', () => {
    const gone: ExecutionNarrowing = { ...narrowing, because: [
      { test: 'test/other.test.ts', via: [region('src/total.ts')] },
      { test: 'test/total.test.ts', via: [region('src/total.ts'), region('src/gone.ts')] },
    ] };

    expect(leftToMainline(gone, undefined, new Set(['src/gone.ts']), relations)?.narrowing.entered).toEqual(['test/total.test.ts']);
  });

  it('keeps no test the narrowing did not select, though the graph reaches it', () => {
    const one: ExecutionNarrowing = { ...narrowing, entered: ['test/total.test.ts'], because: [{ test: 'test/total.test.ts', via: [region('src/total.ts')] }] };

    expect(leftToMainline(one, undefined, new Set(['src/other.ts']), relations)?.narrowing.entered).toEqual([]);
  });
});
