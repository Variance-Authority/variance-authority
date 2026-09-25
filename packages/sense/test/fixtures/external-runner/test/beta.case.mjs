import { decide } from '../src/decide.mjs';

test(['decide', 'takes the beta path'], () => {
  if (decide('beta') !== 'took B, light') throw new Error('expected B');
});
