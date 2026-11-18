import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativelyUpdated } from './native-update.js';

const updateNatively = vi.hoisted(() => vi.fn<() => Promise<NativelyUpdated | undefined>>());
vi.mock('./native-update.js', () => ({ updateNatively }));

const { updateSourceIndex } = await import('./published.js');

const done: NativelyUpdated = { was: 'published', files: 3, reread: 0, parsed: 0 };
const lost: NativelyUpdated = { ...done, moved: true, refused: 'source-index.bin moved after it was read; run the index update again' };

describe('an update whose index another writer published under', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-moved-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    updateNatively.mockReset();
  });

  it('reads the index the other writer left and updates that, so two readers of one checkout both answer', async () => {
    updateNatively.mockResolvedValueOnce(lost).mockResolvedValueOnce(done);

    const update = await updateSourceIndex(root, { index: join(root, 'source-index.bin') });

    expect(update.refused).toBeUndefined();
    expect(updateNatively).toHaveBeenCalledTimes(2);
  });

  it('says the index kept moving when every attempt lost, and stops asking', async () => {
    updateNatively.mockResolvedValue(lost);

    const update = await updateSourceIndex(root, { index: join(root, 'source-index.bin') });

    expect(update.refused).toBe(lost.refused);
    expect(updateNatively).toHaveBeenCalledTimes(4);
  });

  it('asks once more for nothing the file system refused', async () => {
    updateNatively.mockResolvedValue({ ...done, refused: 'source-index.bin: permission denied' });

    const update = await updateSourceIndex(root, { index: join(root, 'source-index.bin') });

    expect(update.refused).toBe('source-index.bin: permission denied');
    expect(updateNatively).toHaveBeenCalledTimes(1);
  });
});
