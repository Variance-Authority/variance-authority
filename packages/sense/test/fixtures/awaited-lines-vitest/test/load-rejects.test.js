import { expect, it } from 'vitest';
import { load } from '../src/load.js';

it('rejects with what the fetcher rejects with', async () => {
  await expect(load((key) => Promise.reject(new Error(key)))).rejects.toThrow('key');
});
