import { services } from './services';

const shop = services();

// Outside any case: the tracer carries a trace no case handed out.
beforeAll(async () => {
  expect(await shop.call('/quote?currency=usd')).toBe('basket in dollars: $9.99');
});

it('quotes in euros', async () => {
  expect(await shop.call('/quote?currency=eur')).toBe('basket in euros: 9,00 €');
});

it('quotes in pounds', async () => {
  expect(await shop.call('/quote?currency=gbp')).toBe('basket in pounds: £7.80');
});

it('never calls the service', () => {
  expect(1 + 1).toBe(2);
});
