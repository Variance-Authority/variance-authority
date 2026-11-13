import { expect, it } from '@rstest/core';
import { decide } from '../src/decide';

/** Resolves no sooner than `ms` on the real clock: a timer may fire a fraction early. */
const sleep = (ms: number): Promise<void> => new Promise((done) => {
  const from = performance.now();
  const check = (): unknown => (performance.now() - from >= ms ? done() : setTimeout(check, 1));
  setTimeout(check, ms);
});

it('waits on one line', async () => {
  expect(decide('alpha')).toBe('A');
  await sleep(200);
  expect(decide('beta')).toBe('B');
});
