import { services } from './services';

const shop = services();

it('refunds a small amount', async () => {
  expect(await shop.call('/refund?amount=5')).toBe('return accepted: refunded');
});
