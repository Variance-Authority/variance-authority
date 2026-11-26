import { resolve } from 'node:path';
import { readTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it, vi } from 'vitest';
import { createExecutionRecorder } from './execution.js';
import { ended, INSTRUMENTATION, inRoot, instrumented, pageReporting } from './execution.fixture.js';

// The fixture reads a describe's hooks from worker internals a cut `TestInfo`
// does not carry; see `execution.test.ts`.
vi.mock('./preconditions.js', async (original) => ({
  ...(await original<typeof import('./preconditions.js')>()),
  enterDescribes: async () => {},
}));

/** One worker's recorder, handed each `[file, lane]` as a finished test, then closed and read back. */
async function lanesOf(attempts: readonly (readonly [string, number | undefined])[]): Promise<readonly (readonly [string, number | undefined])[]> {
  let read: readonly (readonly [string, number | undefined])[] = [];
  await inRoot(async (root) => {
    const coverageFile = resolve(root, 'coverage.bin');
    const { cacheRoot, id } = await instrumented(root);
    const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
    vi.useFakeTimers();
    try {
      let clock = 1_800_000_000_000;
      for (const [owner, lane] of attempts) {
        await recorder.note(
          pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [0], shared: [] }] }),
          owner,
          { name: 'the one test', id: `${owner}-1` },
        );
        vi.setSystemTime((clock += 1_000));
        await ended(recorder, root, owner, 'passed', 40, undefined, lane);
      }
    } finally {
      vi.useRealTimers();
    }
    await recorder.close();
    read = (await readTestCoverage(coverageFile)).tests.map(({ file, lane }) => [file, lane]);
  });
  return read;
}

describe('a Playwright worker records which worker lane ran a file', () => {
  it('records two lanes for two files on two workers, and one lane for one worker', async () => {
    expect(await lanesOf([['tests/a.spec.ts', 0], ['tests/b.spec.ts', 1]])).toEqual([
      ['tests/a.spec.ts', 0],
      ['tests/b.spec.ts', 1],
    ]);
    expect(await lanesOf([['tests/a.spec.ts', 0], ['tests/b.spec.ts', 0]])).toEqual([
      ['tests/a.spec.ts', 0],
      ['tests/b.spec.ts', 0],
    ]);
  });

  it('keeps the lane of the earliest attempt, and records nothing for a file given none', async () => {
    expect(await lanesOf([['tests/a.spec.ts', 2], ['tests/a.spec.ts', 3], ['tests/b.spec.ts', undefined]])).toEqual([
      ['tests/a.spec.ts', 2],
      ['tests/b.spec.ts', undefined],
    ]);
  });
});
