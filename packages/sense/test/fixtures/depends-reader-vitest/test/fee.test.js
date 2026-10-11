import { expect, it } from 'vitest';
import { FEE } from '../src/fee';

it('charges a fee', () => {
  expect(FEE).toBe(2);
});
