import { total } from '../src/cart';

it('says nothing', () => {
  expect(total([9])).toBe(9);
});
