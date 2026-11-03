import { relationsOfFiles } from '@variance-authority/core/relate';
import type { TestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { driftWords, reviewDrift, type DriftInput, type DriftRecord } from './review-drift.js';

/** `test/a.test.ts` imports `src/a.ts`; `src/lazy.ts` is imported by nothing, so a load of it is drift. */
const RELATIONS = relationsOfFiles([
  { file: 'test/a.test.ts', edges: [{ to: 'src/a.ts', kind: 'imports' as const }] },
  { file: 'src/a.ts' },
  { file: 'src/lazy.ts' },
]);

function record(commit: string, loads: readonly string[], instrumentation = 'probes-1'): DriftRecord {
  const modules = ['src/a.ts', ...loads].map((file) => ({ file, blocks: [{ kind: 'module', testFiles: ['test/a.test.ts'] }] }));
  const coverage = { version: 3, instrumentation, tests: [{ file: 'test/a.test.ts' }], modules } as unknown as TestCoverage;
  return { commit, coverage, observed: new Set(['test/a.test.ts']) };
}

function input(partial: Partial<DriftInput>): DriftInput {
  return {
    root: '.',
    relations: RELATIONS,
    sources: new Set(['src/a.ts', 'src/lazy.ts', 'test/a.test.ts']),
    before: [],
    unrelated: false,
    baseline: record('base', []),
    head: record('head', []),
    mergeBase: 'base',
    changes: [],
    present: () => true,
    ...partial,
  };
}

const LAZY = { file: 'src/lazy.ts', test: 'test/a.test.ts' };

describe('the drift a review reports', () => {
  it('changes no shape when the run drifts where the mainline did', () => {
    const both = record('base', ['src/lazy.ts']);
    expect(reviewDrift(input({ baseline: both, head: { ...both, commit: 'head' } }))).toMatchObject({ baseline: 'base', compared: 1, grown: [], shrunk: [] });
  });

  it('names a row the run grew and one it shrank', () => {
    expect(reviewDrift(input({ head: record('head', ['src/lazy.ts']) }))).toMatchObject({ grown: [LAZY], shrunk: [] });
    expect(reviewDrift(input({ baseline: record('base', ['src/lazy.ts']) }))).toMatchObject({ grown: [], shrunk: [LAZY] });
  });

  it('is not checked for a suite with no walk, a missing record or records cut by different probes', () => {
    expect(reviewDrift(input({ unrelated: true }))).toEqual({ unchecked: expect.stringContaining('relations: false') });
    expect(reviewDrift(input({ baseline: { missing: 'the share has none' } }))).toEqual({ unchecked: 'the share has none' });
    expect(reviewDrift(input({ head: record('head', [], 'probes-2') }))).toEqual({ unchecked: expect.stringContaining('probes-2') });
  });

  it('compares nothing when the change edits what configures the walk', () => {
    const changes = [{ file: 'tsconfig.json', before: '{}', after: '{"compilerOptions":{}}' }];
    expect(reviewDrift(input({ changes }))).toEqual({ unchecked: expect.stringContaining('`tsconfig.json`') });
    expect(reviewDrift(input({ before: ['test/setup.ts'], changes: [{ file: 'test/setup.ts', before: '', after: 'x' }] }))).toEqual({
      unchecked: expect.stringContaining('`test/setup.ts`'),
    });
  });

  it('takes a record at an earlier mainline commit when the commits between move nothing the walk reads', () => {
    const earlier = record('earlier', ['src/lazy.ts']);
    expect(reviewDrift(input({ baseline: earlier, between: ['README.md', 'docs/a.md'], distance: 3, head: record('head', ['src/lazy.ts']) }))).toMatchObject({
      baseline: 'earlier',
      grown: [],
    });
  });

  it('names a record at an earlier mainline commit incompatible when the commits between moved the walk', () => {
    const drift = reviewDrift(input({ baseline: record('0123456789abcdef', []), between: ['README.md', 'src/a.ts'], distance: 3 }));
    expect(drift).toEqual({ unchecked: "the mainline's record stands at 0123456789ab, 3 commits before the merge base, and `src/a.ts` moved the walk between them, so it is not a baseline for this change" });
    expect(reviewDrift(input({ between: ['yarn.lock'] }))).toEqual({ unchecked: expect.stringContaining('`yarn.lock`') });
  });

  it.todo('is not checked for a suite whose test files share a realm, Vitest\'s `isolate: false` or a reused page — needs the record to say its files shared a worker');
});

describe('the drift in words', () => {
  const code = (value: string) => `\`${value}\``;

  it('names each grown row with its test file and loaded file', () => {
    const words = driftWords(reviewDrift(input({ baseline: record('0123456789abcdef', []), head: record('head', ['src/lazy.ts']) })), code);
    expect(words).toEqual({
      sentence: "Drift from the walk against the mainline's record at `0123456789ab`: 1 test file compared, 1 row grew and 0 shrank. A row is an observed load, not a defect.",
      changed: true,
      lists: [{ label: 'Grown: loads the walk does not reach, which the baseline lacks', items: ['`test/a.test.ts` loaded `src/lazy.ts`'] }],
    });
  });

  it('says no shape change, and why a drift was not checked', () => {
    expect(driftWords(reviewDrift(input({})), code)).toMatchObject({ changed: false, lists: [], sentence: expect.stringContaining('no shape change') });
    expect(driftWords({ unchecked: 'the share has none' }, code)).toEqual({ sentence: 'Drift from the walk was not checked: the share has none.', changed: false, lists: [] });
  });
});
