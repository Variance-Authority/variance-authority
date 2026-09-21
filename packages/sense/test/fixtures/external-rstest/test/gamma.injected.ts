// Declared with the realm's registrars and no import at all, which is what
// `globals: true` is for and the one spelling the other two configurations
// never take.
import { decide } from '../src/decide';

it('takes the gamma path with the registrars on the realm', () => {
  expect(decide('gamma')).toBe('G');
});
