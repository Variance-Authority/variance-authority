import { expect, it } from 'vitest';
import { fill } from '../src/meter';

it('fills', () => {
  expect(fill(5)).toBeGreaterThan(0);
});
