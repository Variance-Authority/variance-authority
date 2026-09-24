import { expect, it } from 'vitest';
import { load, loadAll, loadChain } from '../src/load.js';

it('resolves what the fetcher resolves', async () => {
  await expect(load(async (key) => key)).resolves.toBe('key');
});

it('resolves every value, in order', async () => {
  await expect(loadAll(async () => 1, async () => 2)).resolves.toEqual([1, 2]);
});

it('resolves the chained value', async () => {
  await expect(loadChain(async (key) => key)).resolves.toBe('KEY');
});
