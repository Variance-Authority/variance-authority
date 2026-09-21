// No import of `vitest` anywhere: the registrars are the ones `globals: true`
// puts on the realm.
import { decide } from '../src/decide.js';

it('takes the gamma path with the registrars on the realm', () => {
  expect(decide('gamma')).toBe('G');
});
