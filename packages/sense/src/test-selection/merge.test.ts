// Where an index stands after two runs are folded together, and what a reader
// does with one it cannot decode at all.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { existingCoverage, mergeCoverage } from './merge.js';
import type { TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';

function at(commit: string | undefined, test: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    ...(commit === undefined ? {} : { commit }),
    tests: [{ file: test, complete: true, preconditions: [{ name: test, digest: 'source:test' }] }],
    modules: [
      {
        file: 'src/decide.ts',
        sourceDigest: 'source:decide',
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: 'block:decide',
            name: '',
            path: 'module',
            startLine: 1,
            endLine: 8,
            source: true,
            testFiles: [test],
          },
        ],
      },
    ],
  };
}

describe('mergeCoverage', () => {
  it('stands where the run that just happened stands', () => {
    // A local layer over a baseline is the ordinary shape, so the two sides
    // naming different commits is not a conflict. The question a later reader
    // asks is what has changed since this index was last written, and that is
    // answered by the newer of the two and never by the one underneath it.
    const merged = mergeCoverage(at(BASELINE, 'test/alpha.test.ts'), at(LOCAL, 'test/beta.test.ts'));

    expect(merged.commit).toBe(LOCAL);
    expect(merged.tests.map((test) => test.file)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('leaves an index unpositioned when the run that wrote it was', () => {
    expect(mergeCoverage(at(BASELINE, 'test/alpha.test.ts'), at(undefined, 'test/beta.test.ts')))
      .not.toHaveProperty('commit');
  });
});

describe('existingCoverage', () => {
  it('treats a file it cannot decode as one that is not there', async () => {
    // The read half of a read-modify-write. Refusing here would stop every
    // later run from recording anything until somebody deleted the file by
    // hand; replacing it costs this machine evidence the next full run
    // restores, and which meanwhile widens selection rather than narrowing it.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-merge-'));
    try {
      const file = resolve(root, 'coverage.bin');
      await writeFile(file, 'half a copy of something else', 'utf8');

      expect(await existingCoverage(file)).toBeUndefined();
      expect(await existingCoverage(resolve(root, 'absent.bin'))).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
