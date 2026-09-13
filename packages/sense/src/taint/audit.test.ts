import { describe, expect, it } from 'vitest';
import { relationsOfFiles, type FileRecord } from '@variance-authority/core/relate';
import type { CoverageBlock, TestCoverage } from '../test-selection/index.js';
import { auditTaints } from './audit.js';

/**
 * `card.test.ts` mocks `api.ts` and imports `card.ts`, which imports `api.ts`.
 * `plain.test.ts` imports `card.ts` and mocks nothing.
 */
const RECORDS: readonly FileRecord[] = [
  { file: 'src/api.ts' },
  { file: 'src/card.ts', edges: [{ to: 'src/api.ts', kind: 'imports' }] },
  { file: 'src/card.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }, { to: 'src/api.ts', kind: 'imports' }] },
  { file: 'src/plain.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }] },
  { file: 'src/relay.ts' },
];
const relations = relationsOfFiles(RECORDS);
const shadows = new Map([['src/card.test.ts', ['src/api.ts']]]);
const additions = new Map<string, readonly string[]>();

const block = (tests: readonly string[], loadedBy?: readonly string[]): CoverageBlock => ({
  ordinal: 0, kind: 'module', digest: 'd', name: 'module', path: '', startLine: 1, endLine: 1, source: true, testFiles: tests,
  ...(loadedBy === undefined ? {} : { loadedBy }),
});

const record = (entered: Readonly<Record<string, readonly CoverageBlock[]>>, complete = true): TestCoverage => ({
  version: 3,
  instrumentation: 'fixture',
  tests: [
    { file: 'src/card.test.ts', complete, preconditions: [] },
    { file: 'src/plain.test.ts', complete, preconditions: [] },
  ],
  modules: Object.entries(entered).map(([file, blocks]) => ({ file, sourceDigest: 's', instrumented: true, blocks })),
});

describe('the taint audit', () => {
  it('is silent when the record agrees with the taints', () => {
    const coverage = record({
      'src/card.ts': [block(['src/card.test.ts', 'src/plain.test.ts'])],
      'src/api.ts': [block(['src/plain.test.ts'])],
    });

    expect(auditTaints(coverage, relations, { shadows, additions })).toEqual([]);
  });

  it('names a shadowed module the test entered anyway', () => {
    const coverage = record({
      'src/card.ts': [block(['src/card.test.ts', 'src/plain.test.ts'])],
      'src/api.ts': [block(['src/plain.test.ts'], ['src/card.test.ts'])],
    });

    expect(auditTaints(coverage, relations, { shadows, additions })).toEqual([
      { test: 'src/card.test.ts', module: 'src/api.ts', kind: 'shadowed-but-entered' },
    ]);
  });

  it('names a module the test reaches past its shadows and never entered', () => {
    // `plain.test.ts` mocks nothing on paper and never enters `api.ts`: a mock
    // no taint knows about, or an import the run never loaded.
    const coverage = record({
      'src/card.ts': [block(['src/card.test.ts', 'src/plain.test.ts'])],
      'src/api.ts': [block([])],
    });

    expect(auditTaints(coverage, relations, { shadows, additions })).toEqual([
      { test: 'src/plain.test.ts', module: 'src/api.ts', kind: 'reachable-but-not-entered' },
    ]);
  });

  it('asks nothing about absence of a partial observation', () => {
    const coverage = record({ 'src/card.ts': [block([])], 'src/api.ts': [block([])] }, false);

    expect(auditTaints(coverage, relations, { shadows, additions })).toEqual([]);
  });

  it('says nothing about a module no probe was in', () => {
    const coverage = record({ 'src/card.ts': [block(['src/card.test.ts', 'src/plain.test.ts'])] });

    expect(auditTaints(coverage, relations, { shadows, additions })).toEqual([]);
  });

  it('names an addition the record never saw the test in', () => {
    const coverage = record({
      'src/card.ts': [block(['src/card.test.ts', 'src/plain.test.ts'])],
      'src/api.ts': [block(['src/plain.test.ts'])],
      'src/relay.ts': [block([])],
    });
    const added = new Map([['src/plain.test.ts', ['src/relay.ts']]]);

    expect(auditTaints(coverage, relations, { shadows, additions: added })).toEqual([
      { test: 'src/plain.test.ts', module: 'src/relay.ts', kind: 'added-but-not-entered' },
    ]);
  });

  it('looks a module up under every name the record may hold it as', () => {
    const coverage = record({
      'dist/card.js': [block(['src/card.test.ts', 'src/plain.test.ts'])],
      'dist/api.js': [block(['src/plain.test.ts'])],
    });
    const knownAs = (file: string) => [file, file.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js')];

    expect(auditTaints(coverage, relations, { shadows, additions }, { knownAs })).toEqual([]);
  });
});
