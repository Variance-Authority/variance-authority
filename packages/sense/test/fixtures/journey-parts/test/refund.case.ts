import { service } from './service';

const pricing = service();

it('refunds a small amount', async () => {
  expect(await pricing.call('/refund?amount=5')).toBe('refunded');
});

it('quotes in dollars without carrying its journey', async () => {
  expect(await pricing.call('/quote?currency=usd', false)).toBe('$9.99');
});
