import { describe, expect, it, vi } from 'vitest';
import type { CommitChange } from '@variance-authority/sense';
import { TOTAL, queued, scratch, selected } from './select-tested.fixture.js';

/**
 * `variance select --ran-at` in a clone whose history stops between the merge
 * base and `--since`: a change the mainline landed and took back before its
 * oldest commit is out of sight, so nothing is narrowed on what it shows.
 */

vi.mock('@variance-authority/sense', async (original) => {
  const sense = await original<typeof import('@variance-authority/sense')>();
  // A shallow clone's oldest commit reads as having no parent, so git diffs it as the whole tree.
  const cut = (line: readonly CommitChange[]) => line.map((one, index) => (index === line.length - 1 ? { ...one, compared: false } : one));
  return { ...sense, firstParentChangesBetween: (...args: Parameters<typeof sense.firstParentChangesBetween>) => cut(sense.firstParentChangesBetween(...args)) };
});

const home = scratch();

describe('`variance select --ran-at` over a mainline history the clone holds only part of', () => {
  it('selects as without `--ran-at` when the clone holds no parent of a mainline commit past the merge base', async () => {
    const queue = await queued(home(), {
      base: { 'src/total.ts': TOTAL.replace('0.9', '0.8') },
      prs: [{ 'src/other.ts': "export function other(price: number): number {\n  return price + 2;\n}\n" }],
      recordAt: 'fork',
    });

    const here = await selected(queue.dir, queue.base, queue.tested);

    // Without `--ran-at` both tests run: the selection skips nothing.
    expect(here.out).toBe('');
    expect(here.err).toContain(`\`--ran-at ${queue.tested}\` selects as without it: the clone holds no parent of `);
  });
});
