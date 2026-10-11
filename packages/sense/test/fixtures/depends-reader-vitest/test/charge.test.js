import { expect, it } from 'vitest';
import { charge } from '../src/rate';

it('charges at the rate', () => {
  expect(charge(2)).toBe(6);
});
