import { decide } from '../src/decide.mjs';

test(['decide', 'takes the alpha path'], () => {
  if (decide('alpha') !== 'took A') throw new Error('expected A');
});

test(['decide', 'waits, then takes the alpha path'], async () => {
  // A timer can fire before `performance.now()` has moved its full delay: libuv
  // keeps its clock in whole milliseconds. Waiting on the clock the worker times
  // with makes the five milliseconds true by construction.
  const started = performance.now();
  while (performance.now() - started < 5) await new Promise((settle) => setTimeout(settle, 1));
  if (decide('alpha') !== 'took A') throw new Error('expected A');
});
