import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CaseLinesBuilder, lineValue } from '../test-selection/case-lines.js';
import { encodeOwnedSetExecutionIndex } from '../test-selection/execution-set-format.js';
import { writeTestCoverage } from '../test-selection/index.js';
import { testCoverageFile } from '../test-selection/record-location.js';
import type { ReadRegion } from '../test-selection/readings-bytes.js';
import { recordedStatements, statementsOf } from './explain.js';

const WIRE = { file: 'src/page.ts', name: 'wire', path: 'entry', startLine: 1, endLine: 3 };
const HANDLE = { file: 'src/page.ts', name: 'handle', path: 'entry', startLine: 5, endLine: 8 };
const ERROR = { file: 'src/page.ts', name: 'handle', path: 'if#0/then', startLine: 6, endLine: 6 };
const SETUP = { file: 'src/setup.ts', name: 'setup', path: 'entry', startLine: 1, endLine: 2 };
const LATE = { file: 'src/late.ts', name: 'late', path: 'entry', startLine: 1, endLine: 4 };

type At = typeof WIRE;
const crossed = (region: At, line: number | null, hook = false): ReadRegion =>
  [region.file, region.name, region.path, region.startLine, region.endLine, line === null ? null : lineValue(line, hook)];
const CASE = { file: 'test/page.spec.ts', name: 'clicks' };

describe('statementsOf', () => {
  it('lists each statement in the order the case first reached it, with its time and the regions it was the first to run', () => {
    const explained = statementsOf(
      { ...CASE, duration: 12, times: [{ line: 9, time: 400 }, { line: 4, time: 8000 }, { line: 11, time: 30 }] },
      [crossed(WIRE, 4), crossed(HANDLE, 9), crossed(ERROR, 9)],
    );

    expect(explained).toEqual({
      ...CASE,
      duration: 12,
      timed: true,
      lined: true,
      statements: [
        { line: 9, time: 400, regions: [HANDLE, ERROR] },
        { line: 4, time: 8000, regions: [WIRE] },
        { line: 11, time: 30, regions: [] },
      ],
      hooks: [],
      unlined: [],
    });
  });

  it('lists what ran before the first statement first, a hook\'s regions apart, and the regions no line was recorded for', () => {
    const explained = statementsOf(
      { ...CASE, times: [{ line: 4, time: 10 }] },
      [crossed(SETUP, 0), crossed(SETUP, 2, true), crossed(WIRE, 4), crossed(LATE, null)],
    );

    expect(explained).toMatchObject({
      statements: [{ line: 0, regions: [SETUP] }, { line: 4, time: 10, regions: [WIRE] }],
      hooks: [{ line: 2, regions: [SETUP] }],
      unlined: [LATE],
    });
  });

  it('lists an untimed case\'s statements by line, and says it was not timed', () => {
    const explained = statementsOf(CASE, [crossed(HANDLE, 9), crossed(WIRE, 4)]);

    expect(explained).toMatchObject({
      timed: false,
      lined: true,
      statements: [{ line: 4, regions: [WIRE] }, { line: 9, regions: [HANDLE] }],
    });
    expect(explained.statements[0]).not.toHaveProperty('time');
  });

  it('says a case recorded without statement lines has none', () => {
    const explained = statementsOf(CASE, [crossed(WIRE, null), crossed(HANDLE, null)]);

    expect(explained).toMatchObject({ timed: false, lined: false, statements: [], unlined: [WIRE, HANDLE] });
  });
});

describe('recordedStatements', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  /** A checkout whose record holds `clicks` in each of `files`, timed at lines 4 and 9, crossing `wire` from line 4 and `handle` from line 9. */
  async function checkout(files: readonly string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'variance-authority-explain-'));
    roots.push(root);
    const tests = files.map((file) => ({ id: `${file} > clicks`, file, name: 'clicks', duration: 2, times: [{ line: 9, time: 300 }, { line: 4, time: 1500 }] }));
    const blocks = [WIRE, HANDLE].map(({ name, path, startLine, endLine }) => ({
      kind: 'function' as const, name, path, startLine, endLine, source: true, crossings: tests.map((_, test) => ({ test, distance: 0 })),
    }));
    const lines = tests.map(() => {
      const builder = new CaseLinesBuilder();
      builder.add(0, 0, lineValue(4, false));
      builder.add(0, 1, lineValue(9, false));
      return builder.finish();
    });
    await writeTestCoverage(testCoverageFile(root), { version: 3, instrumentation: 'fixture', tests: [], modules: [] }, {
      index: encodeOwnedSetExecutionIndex({ tests, modules: [{ file: 'src/page.ts', blocks }] }, [], lines),
    });
    return root;
  }

  it('explains a case of the record by its name, from its newest run', async () => {
    const root = await checkout(['test/page.spec.ts']);

    const [found, ...more] = recordedStatements(root, 'clicks');

    expect(more).toEqual([]);
    expect(found).toMatchObject({
      ...CASE,
      duration: 2,
      record: testCoverageFile(root),
      statements: [{ line: 9, time: 300, regions: [HANDLE] }, { line: 4, time: 1500, regions: [WIRE] }],
    });
  });

  it('finds a name two files hold in both, and in the one `file` names', async () => {
    const root = await checkout(['a.test.ts', 'b.test.ts']);

    expect(recordedStatements(root, 'clicks').map(({ file }) => file)).toEqual(['a.test.ts', 'b.test.ts']);
    expect(recordedStatements(root, 'clicks', 'b.test.ts').map(({ file }) => file)).toEqual(['b.test.ts']);
    expect(recordedStatements(root, 'missing')).toEqual([]);
  });
});
