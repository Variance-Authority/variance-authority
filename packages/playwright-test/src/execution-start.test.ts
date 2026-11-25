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

describe('a Playwright worker records when a file started', () => {
  it('records when the runner started the file, the earliest of its attempts, and nothing for a file it gave no start', async () => {
    await inRoot(async (root) => {
      const coverageFile = resolve(root, 'coverage.bin');
      const { cacheRoot, id } = await instrumented(root);
      const timed = 'tests/timed.spec.ts';
      const untimed = 'tests/untimed.spec.ts';

      const recorder = createExecutionRecorder({ root, cacheRoot, coverageFile });
      vi.useFakeTimers();
      try {
        for (const [owner, at] of [
          [timed, 1_800_000_005_000],
          [timed, 1_800_000_001_250],
          [untimed, undefined],
        ] as const) {
          await recorder.note(
            pageReporting({ instrumentation: INSTRUMENTATION, modules: [{ id, hits: [0], shared: [] }] }),
            owner,
            { name: 'the one test', id: `${owner}-1` },
          );
          if (at === undefined) {
            // A caller that has no clock to give hands none.
            recorder.mark(owner, true, { name: 'the one test', id: `${owner}-1` }, 40);
          } else {
            vi.setSystemTime(at);
            await ended(recorder, root, owner, 'passed', 40);
          }
        }
      } finally {
        vi.useRealTimers();
      }
      await recorder.close();

      const { tests } = await readTestCoverage(coverageFile);
      expect(tests.map(({ file, start }) => [file, start])).toEqual([
        [timed, 1_800_000_001_250],
        [untimed, undefined],
      ]);
    });
  });
});
