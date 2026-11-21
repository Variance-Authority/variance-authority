import { checked } from '@variance-authority/sense/checked';

jest.retryTimes(1);

let attempts = 0;
it('retries', () => { // retried case
  attempts += 1;
  if (attempts > 1) return;
  checked('create-event/retried-title', () => expect(attempts).toBe(1)); // retried check
  expect(attempts).toBe(2); // first attempt fails
});
