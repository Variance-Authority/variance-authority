import { variancePrecondition } from '@variance-authority/sense/precondition';

jest.retryTimes(1);

let attempts = 0;
it('retries', () => {
  attempts += 1;
  variancePrecondition('attempt', attempts); // retried
  expect(attempts).toBe(2);
});
