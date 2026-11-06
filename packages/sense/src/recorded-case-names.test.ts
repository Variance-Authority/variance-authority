import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedCaseNames } from './recorded-case-names.js';
import { index, ran } from './test-selection/__fixtures__/case-indexes.js';
import { layerCaseIndex } from './test-selection/case-layer.js';
import { withCaseSections } from './test-selection/case-record.js';
import { encodeTestCoverage } from './test-selection/format.js';
import { testCoverageFile } from './test-selection/record-location.js';

/**
 * The names `variance ask search` reads a test by: what each suite's nearest
 * record holds, and where a suite holds none, why.
 */

let root: string;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-case-names-cache-')));
  root = mkdtempSync(join(tmpdir(), 'va-case-names-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function record(cases: Uint8Array | undefined, suite?: string): string {
  const at = testCoverageFile(root, { suite });
  mkdirSync(dirname(at), { recursive: true });
  const bytes = encodeTestCoverage({ version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] });
  writeFileSync(at, cases === undefined ? bytes : withCaseSections(bytes, { index: Buffer.from(cases) }));
  return at;
}

describe('the case names a record holds', () => {
  it('reads each case as its file and the name the runner gave it', () => {
    const recording = record(index(['a.test.ts > reads > twice', 'b.test.ts > writes'], {}));

    expect(recordedCaseNames(root)).toEqual([{
      recording,
      cases: [{ file: 'a.test.ts', name: 'reads' }, { file: 'b.test.ts', name: 'writes' }],
    }]);
  });

  it('reads what a local run laid over its base, the run and the rest', () => {
    const base = index(['held.test.ts > carried', 'run.test.ts > before'], {});
    const { merged } = layerCaseIndex(base, index(['run.test.ts > after'], {}), { ...ran(['run.test.ts']), sameText: () => true });
    record(merged);

    const [read] = recordedCaseNames(root);
    expect(read !== undefined && 'cases' in read ? read.cases : read).toEqual(expect.arrayContaining([
      { file: 'held.test.ts', name: 'carried' },
      { file: 'run.test.ts', name: 'after' },
    ]));
    expect(read !== undefined && 'cases' in read ? read.cases : read).not.toContainEqual({ file: 'run.test.ts', name: 'before' });
  });

  it('answers each declared suite on its own, and says why one holds none', () => {
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' }, site: { kind: 'e2e' } } }));
    const recording = record(index(['a.test.ts > reads'], {}), 'unit');
    const site = record(undefined, 'site');

    expect(recordedCaseNames(root)).toEqual([
      { suite: 'site', recording: site, unread: 'no run kept its cases there' },
      { suite: 'unit', recording, cases: [{ file: 'a.test.ts', name: 'reads' }] },
    ]);
  });

  it('says so when nothing is recorded', () => {
    expect(recordedCaseNames(root)).toEqual([{ recording: testCoverageFile(root), unread: 'no run kept its cases there' }]);
  });

  it('says what the index would not read', () => {
    const recording = record(Buffer.from('not an index'));

    expect(recordedCaseNames(root)).toEqual([{ recording, unread: expect.any(String) }]);
  });
});
