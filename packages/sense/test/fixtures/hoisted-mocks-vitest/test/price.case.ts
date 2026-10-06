import { expect, it, vi } from 'vitest';
import { discount, total } from '../src/price.ts';

vi.mock('../src/price.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/price.ts')>()),
  discount: () => 0,
}));

it('discounts with the mock and totals with the original', () => {
  expect(discount(10)).toBe(0);
  expect(total(10)).toBe(9);
});
