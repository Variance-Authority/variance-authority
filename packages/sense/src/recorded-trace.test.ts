import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedTrace } from './recorded-trace.js';
import { withCaseSections } from './test-selection/case-record.js';
import { encodeExecutionIndex } from './test-selection/execution-format.js';
import { encodeTestCoverage } from './test-selection/format.js';
import { testCoverageFile } from './test-selection/record-location.js';
import type { ExecutionIndex, TestCoverage } from './test-selection/index.js';

/** What a timeline reads from a recording: a start where the runner gave one, and nothing where it did not. */

let root: string;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-trace-cache-')));
  root = mkdtempSync(join(tmpdir(), 'va-trace-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function record(tests: TestCoverage['tests'], cases?: ExecutionIndex): void {
  const at = testCoverageFile(root);
  mkdirSync(dirname(at), { recursive: true });
  const bytes = encodeTestCoverage({ version: 3, instrumentation: 'fixture', tests, modules: [] });
  writeFileSync(at, cases === undefined ? bytes : withCaseSections(bytes, { index: encodeExecutionIndex(cases) }));
}

describe('the recorded trace', () => {
  it('carries each file with the start the runner gave it, the phases it timed and its cost, in path order', () => {
    record([
      { file: 'e2e/b.spec.ts', complete: true, preconditions: [], duration: 40, start: 1_800_000_002_000 },
      { file: 'e2e/a.spec.ts', complete: true, preconditions: [], duration: 900, start: 1_800_000_001_250, phases: { setup: 100, cases: 800 } },
    ]);

    const trace = recordedTrace(root);

    expect('files' in trace && trace.files).toEqual([
      { file: 'e2e/a.spec.ts', start: 1_800_000_001_250, cost: 900, phases: [{ name: 'setup', ms: 100 }, { name: 'cases', ms: 800 }], cases: [] },
      { file: 'e2e/b.spec.ts', start: 1_800_000_002_000, cost: 40, phases: [], cases: [] },
    ]);
  });

  it('leaves the start out of a file whose runner gave none, never a zero', () => {
    record([{ file: 'test/vitest.test.ts', complete: true, preconditions: [], duration: 33 }]);

    const trace = recordedTrace(root);

    expect('files' in trace && trace.files).toEqual([{ file: 'test/vitest.test.ts', cost: 33, phases: [], cases: [] }]);
  });

  it('carries the timed cases a file declared, in index order, and leaves an untimed one out', () => {
    record(
      [{ file: 'e2e/a.spec.ts', complete: true, preconditions: [], duration: 900, start: 1_800_000_001_250, phases: { setup: 100, cases: 800 } }],
      {
        tests: [
          { id: 'a1', file: 'e2e/a.spec.ts', name: 'opens', duration: 300 },
          { id: 'a2', file: 'e2e/a.spec.ts', name: 'skipped' },
          { id: 'a3', file: 'e2e/a.spec.ts', name: 'closes', duration: 200 },
        ],
        modules: [],
      },
    );

    const trace = recordedTrace(root);

    expect('files' in trace && trace.files[0]?.cases).toEqual([
      { name: 'opens', duration: 300 },
      { name: 'closes', duration: 200 },
    ]);
  });

  it('carries the cases of a file whose runner timed no `cases` phase', () => {
    record(
      [{ file: 'e2e/a.spec.ts', complete: true, preconditions: [], duration: 500, start: 1_800_000_001_250, phases: { setup: 100 } }],
      { tests: [{ id: 'a1', file: 'e2e/a.spec.ts', name: 'opens', duration: 400 }], modules: [] },
    );

    const trace = recordedTrace(root);

    expect('files' in trace && trace.files[0]).toMatchObject({ phases: [{ name: 'setup', ms: 100 }], cases: [{ name: 'opens', duration: 400 }] });
  });

  it('carries the worker lane each file ran on, and leaves it out of a file with none, never a zero', () => {
    record([
      { file: 'e2e/a.spec.ts', complete: true, preconditions: [], duration: 40, start: 1_800_000_001_000, lane: 0 },
      { file: 'e2e/b.spec.ts', complete: true, preconditions: [], duration: 40, start: 1_800_000_001_000, lane: 3 },
      { file: 'e2e/c.spec.ts', complete: true, preconditions: [], duration: 40, start: 1_800_000_001_000 },
    ]);

    const trace = recordedTrace(root);

    expect('files' in trace && trace.files.map((file) => [file.file, file.lane])).toEqual([
      ['e2e/a.spec.ts', 0],
      ['e2e/b.spec.ts', 3],
      ['e2e/c.spec.ts', undefined],
    ]);
  });

  it('says there is nothing to read where nothing is recorded', () => {
    expect(recordedTrace(root)).toMatchObject({ unread: 'nothing is recorded there' });
  });
});
