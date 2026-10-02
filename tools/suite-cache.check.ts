import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pruneWhenDue } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { pruneCacheWhenDue } from '../packages/cli/dist/commands/prune-cache.js';
import { suite } from '../vitest.config.mjs';

/**
 * No test file in a run of the suite finds the cache's daily prune due.
 *
 * Every test file in a run shares the one temporary cache `vitest.config.mts`
 * names, and every fold that ends inside a test — a Jest reporter's run, a
 * Vitest seam's finish — calls `pruneWhenDue` on it. The prune runs at most once
 * a day per cache, so whichever file ended a fold first walked the cache, and
 * the recording credited that file with `planPrune` and everything under it.
 * Which file that was depended on scheduling and on which file had left a
 * layer behind, so the same regions moved between `jest.test.ts`,
 * `rstest.test.ts` and `vitest-preconditions.test.ts` from one run to the next,
 * and a pull request that touched none of them read as one that lost their
 * cases.
 *
 * The CLI keeps a second stamp at the cache's root, and `variance run` prunes
 * by it when it ends. The cases under `cases/` start that command in a process
 * of their own, which inherits the same cache, so the first of them to end a
 * run walked the CLI's directories and the rest did not.
 *
 * Both prunes are exercised on purpose, each in its own temporary cache, by
 * `packages/sense/src/test-selection/prune.test.ts` and
 * `packages/cli/src/commands/prune-cache.test.ts`.
 */
describe("the suite's cache", () => {
  it('is not due for a prune when the first file ends a fold, nor when the next one does', async () => {
    const cache = suite.test?.env?.['VARIANCE_AUTHORITY_CACHE'];
    expect(cache).toEqual(expect.any(String));
    // What an earlier file's fold leaves behind: a layer keyed by its fixture.
    mkdirSync(join(cache!, 'test-selection', 'a-fixture-layer'), { recursive: true });

    expect(await pruneWhenDue(cache!)).toBeUndefined();
    expect(await pruneWhenDue(cache!)).toBeUndefined();
  });

  it("is not due for the CLI's prune when the first run ends, nor when the next one does", async () => {
    const cache = suite.test?.env?.['VARIANCE_AUTHORITY_CACHE'];
    expect(cache).toEqual(expect.any(String));

    expect(await pruneCacheWhenDue({ cacheRoot: cache! })).toBeUndefined();
    expect(await pruneCacheWhenDue({ cacheRoot: cache! })).toBeUndefined();
  });
});
