import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withIndexLock } from './index-lock.js';

// Only `stat` is cut, and it answers from the disk until a case says otherwise:
// a holder letting go between a waiter's attempt and its look at the lock's age
// is a window scheduling opens only sometimes.
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, stat: vi.fn(real.stat) };
});

describe('an index lock its holder lets go of', () => {
  const made: string[] = [];

  afterEach(async () => {
    vi.mocked(stat).mockRestore();
    for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true });
  });

  it('is taken by the waiter that found it held, when the holder lets go before the waiter reads its age', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-index-lock-released-'));
    made.push(directory);
    const file = resolve(directory, 'coverage.bin');
    const lock = `${file}.lock`;
    await writeFile(lock, '1\n');
    const real = vi.mocked(stat).getMockImplementation()!;
    vi.mocked(stat).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path !== lock) return (real as (...args: unknown[]) => unknown)(path, ...rest);
      await rm(lock);
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${lock}'`), { code: 'ENOENT' });
    }) as typeof stat);

    expect(await withIndexLock(file, async () => 'merged')).toEqual({ held: true, value: 'merged' });
    expect(stat).toHaveBeenCalledWith(lock);
  });
});
