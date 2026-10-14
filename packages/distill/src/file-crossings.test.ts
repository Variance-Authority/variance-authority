import type { ExecutionIndex, TestCoverage } from '@variance-authority/sense/test-selection';
import { expect, it } from 'vitest';
import { distillFile } from './file.js';

it('reads shared entries once across test files, counting each case once per module', () => {
  const files = Array.from({ length: 64 }, (_, at) => `test/${at}.test.ts`);
  let visits = 0;
  const crossings = files.flatMap((_, test) => [
    { get test() { visits++; return test; }, distance: 0 },
    { get test() { visits++; return test; }, distance: 0 },
  ]);
  const execution: ExecutionIndex = {
    tests: files.map((file) => ({ file, id: file, name: 'case', stopped: false })),
    modules: [{ file: 'shared.ts', blocks: [
      { kind: 'function', name: 'shared', path: '', startLine: 2, endLine: 3, source: true, crossings },
      { kind: 'function', name: 'load', path: '', startLine: 4, endLine: 4, source: true,
        crossings: files.map((_, test) => ({ test, distance: 0, loaded: true })) },
    ] }],
  };
  const coverage: TestCoverage = {
    version: 3, instrumentation: 'fixture',
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [{ file: 'shared.ts', instrumented: true, sourceDigest: 'shared', blocks: [
      { ordinal: 0, kind: 'module', digest: 'root', name: '', path: '', source: true,
        startLine: 1, endLine: 4, loadedBy: files, testFiles: files },
      { ordinal: 1, owner: 0, kind: 'function', digest: 'fn', name: 'shared', path: '', source: true,
        startLine: 2, endLine: 3, testFiles: files },
    ] }],
  };
  for (const file of files) {
    expect(distillFile({ file, execution, coverage }).modules).toEqual([]);
  }
  expect(visits).toBeLessThanOrEqual(crossings.length);
});
