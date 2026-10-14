import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { encodeTestCoverage, decodeTestCoverage } from './format.js';
import { foldTestCoverage } from './merge.js';
import { foldCoverageArtifacts } from './native-coverage-fold.js';
import type { TestCoverage } from './index.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true }); });
function shard(file: string, instrumented = true): TestCoverage {
  return { version: 3, instrumentation: 'recipe', commit: 'commit', tests: [{ file, complete: true,
    duration: 23, preconditions: [{ name: 'flag', digest: 'off' }] }], modules: [{ file: 'shared.ts',
    sourceDigest: 'text', instrumented, blocks: instrumented ? [{ ordinal: 0, kind: 'module', name: 'shared', path: 'shared',
      digest: 'block', startLine: 1, endLine: 4, source: true, testFiles: [file], loadedBy: [file] }] : [] }] };
}
function records(models: TestCoverage[]): string[] {
  const root = mkdtempSync(join(tmpdir(), 'native-coverage-fold-')); roots.push(root);
  return models.map((model, at) => { const path = join(root, `${at}.bin`); writeFileSync(path, encodeTestCoverage(model)); return path; });
}
test('native stored-column fan-in preserves the logical coverage contract', () => {
  const models = [shard('a.test.ts', false), shard('b.test.ts'), shard('c.test.ts')];
  const files = records(models);
  expect(decodeTestCoverage(foldCoverageArtifacts(files).bytes)).toEqual(foldTestCoverage(models.map((coverage, at) => ({ path: files[at]!, coverage }))));
});
test.each(['instrumentation', 'commit'] as const)('refuses disagreeing %s', (field) => {
  const second = { ...shard('b.test.ts'), [field]: 'other' };
  expect(() => foldCoverageArtifacts(records([shard('a.test.ts'), second]))).toThrow(field);
});
test('refuses duplicate observations', () => {
  expect(() => foldCoverageArtifacts(records([shard('a.test.ts'), shard('a.test.ts')]))).toThrow('a.test.ts');
});
test('refuses different source', () => {
  const second = shard('b.test.ts');
  const changed = { ...second, modules: second.modules.map((module) => ({ ...module, sourceDigest: 'changed' })) };
  expect(() => foldCoverageArtifacts(records([shard('a.test.ts'), changed]))).toThrow('different source');
});
test('absent commits and durations stay absent; unknown rows survive when none measured', () => {
  const models = ['a.test.ts', 'b.test.ts'].map((file) => {
    const held = shard(file, false);
    return { version: held.version, instrumentation: held.instrumentation,
      tests: held.tests.map(({ duration: _duration, ...test }) => ({ ...test, complete: false })), modules: held.modules };
  });
  const files = records(models);
  expect(decodeTestCoverage(foldCoverageArtifacts(files).bytes)).toEqual(foldTestCoverage(models.map((coverage, at) => ({ path: files[at]!, coverage }))));
});
test('instrumented rows win in either shard order and preserve each region owner', () => {
  const measured = shard('b.test.ts');
  const held = measured.modules[0]!;
  const owned = { ...measured, modules: [{ ...held, blocks: [...held.blocks, { ...held.blocks[0]!,
    ordinal: 1, owner: 0, kind: 'function' as const, name: 'function', digest: 'function', testFiles: ['b.test.ts'], loadedBy: undefined }] }] };
  const models = [owned, shard('a.test.ts', false)];
  const files = records(models);
  for (const order of [files, [...files].reverse()]) {
    expect(decodeTestCoverage(foldCoverageArtifacts(order).bytes)).toEqual(foldTestCoverage(models.map((coverage, at) => ({ path: files[at]!, coverage }))));
  }
});
test('refuses an empty shard list', () => {
  expect(() => foldCoverageArtifacts([])).toThrow('at least one');
});
test('one shard preserves every recorded coverage field', () => {
  const model = shard('only.test.ts');
  expect(decodeTestCoverage(foldCoverageArtifacts(records([model])).bytes)).toEqual(model);
});
test('a positioned shard cannot supply a commit for an unpositioned one', () => {
  const { commit: _commit, ...withoutCommit } = shard('a.test.ts');
  expect(() => foldCoverageArtifacts(records([withoutCommit, shard('b.test.ts')]))).toThrow('commit');
});
