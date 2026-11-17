import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { describe, expect, it } from 'vitest';
import { at, jestSelection, repository } from './__fixtures__/jest-selection.js';

// The order a selected Jest run gives the tests of the files it kept, under
// `--randomize`, against the order Jest gives those files alone.
const { directory, runConfig } = jestSelection();

describe('a Jest run handed a selection, under --randomize', () => {
  /** Each file's tests in the order they ran, by file, and the seed Jest printed. */
  async function shuffled(config: string, name: string, skip: readonly string[], ...args: string[]) {
    const report = resolve(directory(), `${name}.json`);
    const { stderr } = await runConfig(config, name, { FIXTURE_SKIP: JSON.stringify(skip) }, '--randomize', '--json', '--outputFile', report, ...args);
    const { testResults } = JSON.parse(await readFile(report, 'utf8')) as {
      testResults: { name: string; assertionResults: { title: string }[] }[];
    };
    const order = testResults
      .map((file) => [relative(repository, file.name), file.assertionResults.map((test) => test.title)] as const)
      .toSorted(([a], [b]) => codeUnitOrder(a, b));
    return { order, seed: /^Seed: +(-?\d+)$/m.exec(stderr)?.[1] };
  }

  const skip = [at('test/gamma.case.ts')];
  const kept = 'test/(alpha|beta|delta|each)';

  // Two seeds that put the tests of `alpha` and `each` in two different orders,
  // so an order that ignores the seed cannot match both.
  it.each([1, 2])('runs each kept file\'s tests in the order Jest gives those files alone with seed %i, and prints the seed', async (seed) => {
    const own = await shuffled('jest.plain.config.mjs', `own-${seed}`, [], `--seed=${seed}`, kept);
    const wrapped = await shuffled('jest.config.mjs', `wrapped-${seed}`, skip, `--seed=${seed}`);

    expect(wrapped.order).toEqual(own.order);
    expect(wrapped.seed).toBe(String(seed));
  });

  it('prints the seed it picked, and that seed runs the tests in the same order', async () => {
    const picked = await shuffled('jest.config.mjs', 'picked', skip);
    expect(picked.seed).toBeDefined();

    expect((await shuffled('jest.config.mjs', 'again', skip, `--seed=${picked.seed}`)).order).toEqual(picked.order);
  });
});
