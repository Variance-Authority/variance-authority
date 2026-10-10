import { expect, it } from 'vitest';
import { label } from '../src/gauge';

it('names the unit', () => {
  expect(label()).toBe('%');
});
