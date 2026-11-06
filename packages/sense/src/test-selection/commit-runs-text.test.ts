import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitRunsFile, landRun, readCommitRuns } from './commit-runs.js';
import { writeTestCoverage, type TestCoverage } from './index.js';

/**
 * The runs record's text across builds: a build that keeps no landings reads
 * the files that ran at the record's commit from `files`, and rewrites that
 * list carrying the landings it does not read as they were.
 */

const DAY1 = '2026-01-01T00:00:00.000Z';
const DAY2 = '2026-01-02T00:00:00.000Z';

/** A run of `files` that instrumented one module, each finished unless `partly` names it. */
function run(commit: string, files: readonly string[], partly: readonly string[] = []): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: files.map((file) => ({ file, complete: !partly.includes(file), preconditions: [] })),
    modules: [{
      file: 'src/a.ts',
      sourceDigest: 'source',
      instrumented: true,
      blocks: [{ ordinal: 0, kind: 'module', digest: 'root', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [...files].sort() }],
    }],
  };
}

async function snapshot(): Promise<{ root: string; coverageFile: string }> {
  const root = await mkdtemp(join(tmpdir(), 'variance-commit-runs-text-'));
  return { root, coverageFile: join(root, 'coverage.bin') };
}

describe('the runs record a build that keeps no landings reads', () => {
  it('lists beside the landings the files they finished, and none a run ran only in part, which stands where it stood', async () => {
    const { root, coverageFile } = await snapshot();
    await writeTestCoverage(coverageFile, run('base', ['a.test.ts']));

    await landRun(coverageFile, run('head', ['a.test.ts', 'b.test.ts'], ['a.test.ts']), root);
    await landRun(coverageFile, run('head', ['c.test.ts']), root);

    const written = JSON.parse(await readFile(commitRunsFile(coverageFile), 'utf8')) as Record<string, unknown>;
    expect(written['files']).toEqual(['b.test.ts', 'c.test.ts']);
    expect(written['standing']).toContainEqual(expect.objectContaining({ commit: 'base', files: ['a.test.ts'] }));
  });

  it('is read as that build wrote it once it rewrote the list beside landings it carried unread', async () => {
    const { coverageFile } = await snapshot();
    const standing = [{ commit: 'M', files: ['b.test.ts'] }];
    const landing = { files: ['a.test.ts', 'b.test.ts'], first: DAY1, latest: DAY1, runs: 1, installed: {} };
    const records = {
      // A newer snapshot moved b.test.ts to its commit: the older build placed it there and listed what it kept.
      'a list it narrowed': [
        { commit: 'P', over: 'M', latest: DAY2, runs: 2, files: ['a.test.ts'], standing, landings: [landing] },
        { commit: 'P', over: 'M', latest: DAY2, runs: 2, standing, landings: [{ files: ['a.test.ts'], latest: DAY2, runs: 2 }] },
      ],
      'the list the landings were written beside': [
        { commit: 'P', over: 'M', latest: DAY2, runs: 1, files: ['b.test.ts', 'a.test.ts'], standing: [], landings: [landing] },
        { commit: 'P', over: 'M', latest: DAY2, runs: 1, standing: [], landings: [landing] },
      ],
      // Written by this build before it listed the files beside them.
      'no list': [
        { commit: 'P', over: 'M', latest: DAY2, runs: 1, standing: [], landings: [landing] },
        { commit: 'P', over: 'M', latest: DAY2, runs: 1, standing: [], landings: [landing] },
      ],
    };
    for (const [name, [held, read]] of Object.entries(records)) {
      await writeFile(commitRunsFile(coverageFile), JSON.stringify(held));
      expect(await readCommitRuns(coverageFile), name).toEqual(read);
    }
  });
});
