import { expect, it } from 'vitest';
import { next } from './counter.js';

// Two tests that run side by side: each counts, waits for the other to count,
// and counts again, so a session they share hands each the other's writes.
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

it.concurrent('counts from one beside another test', async () => {
  const first = next();
  await turn();
  expect([first, next()]).toEqual([1, 2]);
});

it.concurrent('counts from one beside the first test', async () => {
  const first = next();
  await turn();
  expect([first, next()]).toEqual([1, 2]);
});
