import { decide } from '../src/decide.mjs';

// Fails its first attempt and passes its second: the case a retry hides.
let attempt = 0;

test(['passes on its second attempt'], () => {
  attempt += 1;
  if (decide(attempt === 1 ? 'alpha' : 'beta') === 'took A') throw new Error('expected B');
});
