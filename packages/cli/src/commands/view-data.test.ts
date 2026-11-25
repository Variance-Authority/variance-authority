import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeExecutionIndex, encodeTestCoverage, testCoverageFile, withCaseSections } from '@variance-authority/sense/test-selection';
import type { FanIn, FanInFile } from '@variance-authority/sense/test-selection';
import { encodeRecordedAttempts } from '../../../sense/src/test-selection/attempts-record.js';
import { TOP, viewData } from './view-data.js';

/** What `variance view` cuts from a recording: the rows a page holds, and the true size of what it was cut from. */

let root: string;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-view-cache-')));
  root = mkdtempSync(join(tmpdir(), 'va-view-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function record(tests: { file: string; duration: number; start?: number }[], suite?: string): void {
  const at = testCoverageFile(root, suite === undefined ? {} : { suite });
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(
    at,
    encodeTestCoverage({ version: 3, instrumentation: 'fixture', tests: tests.map((test) => ({ ...test, complete: true, preconditions: [] })), modules: [] }),
  );
}

function fan(...rows: readonly Pick<FanInFile, 'file' | 'tests'>[]): FanIn {
  return { kinds: [], files: rows.map((row) => ({ ...row, regions: 1, run: 1, one: 0, entered: row.tests?.length ?? 0, peak: 1, median: 1, testFiles: 1, share: 1 })) };
}

describe('the rows a view page holds', () => {
  it('places the TOP slowest files with a start, ordered by start, and counts every file the cut left out', () => {
    const many = Array.from({ length: TOP + 50 }, (_, at) => ({ file: `e2e/f${String(at).padStart(3, '0')}.spec.ts`, duration: at + 1, start: 1_800_000_000_000 + (TOP + 50 - at) * 10 }));
    record([...many, { file: 'unit/a.test.ts', duration: 5 }, { file: 'unit/b.test.ts', duration: 6 }]);

    const { timeline: cut } = viewData(root, undefined, undefined);

    expect(cut.files).toHaveLength(TOP);
    expect(cut.files.map((file) => file.start)).toEqual(cut.files.map((file) => file.start).sort((a, b) => a! - b!));
    // The fastest 50 are the ones cut; the slowest was kept.
    expect(cut.files.some((file) => file.file === 'e2e/f149.spec.ts')).toBe(true);
    expect(cut.files.some((file) => file.file === 'e2e/f000.spec.ts')).toBe(false);
    expect(cut).toMatchObject({ recorded: TOP + 52, placed: TOP + 50, unplaced: 2 });
  });

  it('says on the Tests view that a declared suite has no recording, not only on the Timeline', () => {
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' }, e2e: { kind: 'e2e' } } }));
    record([{ file: 'a.test.ts', duration: 5 }], 'unit');

    const data = viewData(root, 'e2e');

    expect(data.tests.notes.join('\n')).toMatch(/durations/);
    expect(data.timeline.note).toBeDefined();
  });

  it('draws both directions of the covering relation from the counted fan-in, cut to the files shown', () => {
    record([{ file: 'a.test.ts', duration: 9, start: 1_800_000_000_000 }]);
    const fanIn = fan({ file: 'src/one.ts', tests: ['a.test.ts', 'z.test.ts'] }, { file: 'src/two.ts', tests: ['a.test.ts'] });

    const { reach } = viewData(root, undefined, fanIn);

    expect(reach.files).toEqual([
      { file: 'src/one.ts', tests: ['a.test.ts', 'z.test.ts'], total: 2 },
      { file: 'src/two.ts', tests: ['a.test.ts'], total: 1 },
    ]);
    expect(reach.tests).toEqual([{ file: 'a.test.ts', reached: ['src/one.ts', 'src/two.ts'], total: 2 }]);
  });

  it('says why the relation is empty when coverage was not counted', () => {
    record([{ file: 'a.test.ts', duration: 9 }]);

    const { reach } = viewData(root, undefined, { missed: 'no suite is declared' });

    expect(reach).toEqual({ tests: [], files: [], note: expect.stringContaining('no suite is declared') });
  });

  it('holds an attempt\'s nearest frame where the record has one, and none where it has not', () => {
    const at = testCoverageFile(root, {});
    mkdirSync(dirname(at), { recursive: true });
    const bytes = encodeTestCoverage({ version: 3, instrumentation: 'fixture', commit: 'f'.repeat(40), tests: [{ file: 'test/a.test.ts', duration: 30, complete: true, preconditions: [] }], modules: [] });
    writeFileSync(at, withCaseSections(bytes, {
      index: encodeExecutionIndex({ tests: [{ id: 'a', file: 'test/a.test.ts', name: 'pays twice', duration: 30 }], modules: [] }),
      attempts: encodeRecordedAttempts([
        { case: 'a', attempt: 1, ended: 'failed', duration: 12, message: 'boom', frame: 'test/a.test.ts:7' },
        { case: 'a', attempt: 2, ended: 'failed', duration: 12, message: 'boom' },
      ]),
    }));
    const [first, second] = viewData(root).tests.unpassed[0]!.attempts;
    expect(first!.frame).toBe('test/a.test.ts:7');
    expect(second).not.toHaveProperty('frame');
  });
});
