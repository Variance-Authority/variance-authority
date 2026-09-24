import { expect, it } from 'vitest';
import { loadChain } from '../src/load.js';

it('rejects before the chained step runs', async () => {
  await expect(loadChain((key) => Promise.reject(new Error(key)))).rejects.toThrow('key');
});
