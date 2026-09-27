import { shop } from './shop';

it('totals a cart', async () => {
  expect(await shop('/api/cart?items=kettle,tin')).toEqual({
    count: 2,
    subtotal: '58.00',
    discount: '0.00',
    total: '58.00',
  });
});
