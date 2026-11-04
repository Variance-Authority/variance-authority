import { expect, it } from 'vitest';
import { read } from './reader.js';

it('reads the module as it is', () => {
  expect(read()).toBe('real');
});
