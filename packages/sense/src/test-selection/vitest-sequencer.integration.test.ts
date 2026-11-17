import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { vitestSequencer } from './__fixtures__/vitest-sequencer.js';

// The order the selecting sequencer gives files and tests under a shuffle. The
// seed it names, and where, is a file of its own.
const { scratch, output, started, startedWith } = vitestSequencer();

describe('the selecting sequencer under `sequence.shuffle`', () => {
  // Two seeds that put these four files in two different orders, so an order
  // that ignores the seed cannot match both.
  it.each([1, 2])('runs the files in the order Vitest\'s own shuffle gives seed %i', async (seed) => {
    const flags = ['--sequence.shuffle', `--sequence.seed=${seed}`];
    const own = await started('vitest.plain.config.ts', ...flags);
    expect(own).not.toEqual(own.toSorted());

    expect(await started('vitest.default.config.ts', ...flags)).toEqual(own);
  });

  // Selection removes files before Vitest orders them, so a shuffled selected
  // run is the run Vitest gives the files it kept, with the same seed.
  it.each([1, 2, 3])('runs the files a selection keeps in the order Vitest gives those files alone with seed %i', async (seed) => {
    const flags = ['--sequence.shuffle', `--sequence.seed=${seed}`];
    const own = await started('vitest.plain.config.ts', ...flags, 'test/alpha', 'test/beta', 'test/delta');
    expect(own.toSorted()).toEqual(['alpha.case.ts', 'beta.case.ts', 'delta.case.ts']);

    expect(await startedWith({ FIXTURE_SKIP: JSON.stringify(['packages/sense/test/fixtures/external-vitest/test/gamma.case.ts']) }, 'vitest.default.config.ts', ...flags)).toEqual(own);
  });

  // Vitest folds `{ files, tests }` into `shuffle: tests` once it has picked
  // its sequencer, so the resolved config reads `--sequence.shuffle.tests` as
  // `--sequence.shuffle` and `--sequence.shuffle.files` as no shuffle. Without
  // the cache, the files Vitest leaves unshuffled run largest first, which no
  // shuffle by seed 1 gives these four.
  it.each(['files', 'tests'])('orders the files as Vitest does under `--sequence.shuffle.%s`', async (part) => {
    const flags = [`--sequence.shuffle.${part}`, '--sequence.seed=1', '--no-cache'];
    const own = await started('vitest.plain.config.ts', ...flags);

    expect(await started('vitest.default.config.ts', ...flags)).toEqual(own);
  });

  // A file's tests are shuffled in the worker, by the seed the config hands it.
  it.each(['--sequence.shuffle', '--sequence.shuffle.tests'])('runs the tests in a file in the order Vitest gives them under `%s`', async (shuffle) => {
    const ran = async (config: string): Promise<string[]> => {
      const order = resolve(await scratch(), 'order.txt');
      await output(await scratch(), { FIXTURE_INCLUDE: 'test/several.order.ts', FIXTURE_ORDER: order }, config, shuffle, '--sequence.seed=1');
      return (await readFile(order, 'utf8')).trim().split('\n');
    };
    const own = await ran('vitest.plain.config.ts');
    expect(own).not.toEqual(own.toSorted());

    expect(await ran('vitest.default.config.ts')).toEqual(own);
  });
});
