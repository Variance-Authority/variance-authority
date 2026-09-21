// The registrars imported rather than injected, which is what a project running
// with `injectGlobals: false` has and what any file may do regardless of that
// option. This case must be named in the index and must own the branch it
// walked, the same as the three files beside it that take the injected ones.
import { expect, it } from '@jest/globals';
import { decide } from '../src/decide';

it('takes the delta path with registrars it imported', () => {
  expect(decide('delta')).toBe('D');
});
