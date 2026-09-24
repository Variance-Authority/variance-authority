import { decide } from '../src/decide.mjs';

test(['decide', 'takes the alpha path'], () => {
  if (decide('alpha') !== 'took A') throw new Error('expected A');
});

test(['decide', 'waits, then takes the alpha path'], async () => {
  await new Promise((settle) => setTimeout(settle, 5));
  if (decide('alpha') !== 'took A') throw new Error('expected A');
});
