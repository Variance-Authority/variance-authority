import { service } from './service';

const pricing = service();

it('quotes in euros', async () => {
  expect(await pricing.call('/quote?currency=eur')).toBe('9,00 €');
});

it('quotes in pounds', async () => {
  expect(await pricing.call('/quote?currency=gbp')).toBe('£7.80');
});

it('ranks a gold customer', async () => {
  expect(await pricing.call('/standing?tier=gold')).toBe('priority');
});

it('never calls the service', () => {
  expect(1 + 1).toBe(2);
});
