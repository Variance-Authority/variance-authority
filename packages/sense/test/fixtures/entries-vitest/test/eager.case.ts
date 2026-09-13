import { expect, it } from 'vitest';
import { cold, primed } from '../src/eager.js';

it('reads what loading already computed', () => {
  expect(primed).toBe(1);
});

it('calls what nothing called before it', () => {
  expect(cold(-2)).toBe(2);
});
