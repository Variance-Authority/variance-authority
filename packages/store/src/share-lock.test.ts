import { mkdir, mkdtemp, rm, rmdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishLine, type ShareEntry } from '@variance-authority/core/share';
import { createDirectoryLineCell } from './share.js';

// Only `stat` is cut, and it answers from the disk until a case says otherwise:
// a holder letting go between a writer's `mkdir` and its look at the lock's age
// is a window scheduling opens only sometimes.
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, stat: vi.fn(real.stat) };
});

const MAIN = { kind: 'mainline', name: 'main' } as const;
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const entry: ShareEntry = { name: 'report-v1', commit: 'cccc', bytes: ascii('r') };
const descends = async (): Promise<boolean> => false;
const image = async (): Promise<Uint8Array> => ascii('png');

describe('a line lock its holder lets go of', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-line-lock-'));
  });

  afterEach(async () => {
    vi.mocked(stat).mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it('is taken by the writer that found it held, when the holder lets go before the writer reads its age', async () => {
    const lock = join(root, 'mainline', 'main', '.lock');
    await mkdir(lock, { recursive: true });
    const real = vi.mocked(stat).getMockImplementation()!;
    vi.mocked(stat).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path !== lock) return (real as (...args: unknown[]) => unknown)(path, ...rest);
      await rmdir(lock);
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${lock}'`), { code: 'ENOENT' });
    }) as typeof stat);

    expect(await publishLine(createDirectoryLineCell(root), MAIN, [entry], { descends, image })).toMatchObject({ written: ['report-v1'] });
    expect(stat).toHaveBeenCalledWith(lock);
  });
});
