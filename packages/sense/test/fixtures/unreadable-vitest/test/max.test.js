import { expect, it } from 'vitest';
import { MAX } from '../lib/gate';

it('reads the most through the gate', () => {
  expect(MAX).toBe(10);
});
