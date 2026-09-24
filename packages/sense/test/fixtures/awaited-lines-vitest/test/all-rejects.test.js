import { expect, it } from 'vitest';
import { loadAll } from '../src/load.js';

it('rejects when the first value rejects', async () => {
  await expect(loadAll(() => Promise.reject(new Error('first')), async () => 2)).rejects.toThrow('first');
});
