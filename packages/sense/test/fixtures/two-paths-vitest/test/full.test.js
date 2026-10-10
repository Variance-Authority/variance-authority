import { expect, it } from 'vitest';
import { full } from '../src/gauge';

it('fills to the ceiling', () => {
  expect(full()).toBe(10);
});
