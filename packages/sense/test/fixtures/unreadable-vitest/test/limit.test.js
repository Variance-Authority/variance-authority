import { expect, it } from 'vitest';
import { LIMIT } from '../lib/relay';

it('reads the limit through the relay', () => {
  expect(LIMIT).toBe(10);
});
