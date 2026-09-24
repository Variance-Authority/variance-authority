import { expect, it } from 'vitest';
import { unit } from '../src/meter';

it('names the unit', () => {
  expect(unit()).toBe('%');
});
