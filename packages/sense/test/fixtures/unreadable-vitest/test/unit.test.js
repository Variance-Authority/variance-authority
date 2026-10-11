import { expect, it } from 'vitest';
import { unit } from '../lib/limits';

it('names the unit', () => {
  expect(unit()).toBe('%');
});
