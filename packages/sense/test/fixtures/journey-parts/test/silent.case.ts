import { service } from './service';

const pricing = service();

it('quotes in dollars from a service no journey reaches', async () => {
  expect(await pricing.call('/quote?currency=usd', false)).toBe('$9.99');
});
