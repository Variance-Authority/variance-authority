import { next } from '../src/counter';

// Each body awaits between its calls, so the two run interleaved.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test.concurrent('counts once, while another test counts', async () => {
  await tick();
  expect(next()).toBe(1);
});

test.concurrent.each([[2], [3]])('counts to %i, while other tests count', async (times) => {
  let last = 0;
  for (let n = 0; n < times; n++) {
    last = next();
    await tick();
  }
  expect(last).toBe(times);
});
