import { expect, it, vi } from 'vitest';
import { read } from './reader.js';

// The mock reaches `reader.ts` only if this file is the first to load it.
vi.mock('./value.js', () => ({ value: 'mocked' }));

it('reads the mocked module', () => {
  expect(read()).toBe('mocked');
});
