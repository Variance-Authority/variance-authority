import { describe, expect, it, vi } from 'vitest';
import { indexOutput } from './index-command.js';
import { git } from './mainline-fixture.js';
import { selectOutput } from './select-command.js';
import { OTHER, TOTAL, queued, scratch } from './select-tested.fixture.js';

/**
 * `variance select --ran-at` where the source index could not be brought up
 * to the checkout: the graph it reads may be an older commit's, so a test the
 * merge's own imports reach runs, as it does without `--ran-at`.
 */

const STALE = 'the source index at /cache/index could not be updated to the checkout: EACCES';
vi.mock('./source-graph.js', async (original) => ({
  ...await original<typeof import('./source-graph.js')>(),
  indexUpToCheckout: async () => STALE,
}));

const home = scratch();

describe('`variance select --ran-at` over a source index that could not be updated', () => {
  it('selects as without `--ran-at` when the index still holds the fork\'s graph', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      // HEAD's `other` imports `total`; the fork's does not, so a graph indexed there misses the edge.
      prs: [{ 'src/other.ts': "import { total } from './total';\n" + OTHER.replace('price + 1', 'total(price) + 1') }],
      recordAt: 'fork',
    });
    await git(queue.dir, 'checkout', '--quiet', queue.fork);
    process.chdir(queue.dir);
    await indexOutput({ cwd: queue.dir });
    await git(queue.dir, 'checkout', '--quiet', '-');

    const here = await selectOutput({ cwd: queue.dir, format: 'plain', since: queue.base, ranAt: queue.tested });

    // Without `--ran-at` both tests run: the selection skips nothing.
    expect(here.out).toBe('');
    expect(here.err).toContain(`\`--ran-at ${queue.tested}\` selects as without it: ${STALE}`);
  });
});
