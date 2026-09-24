import { expect, it } from 'vitest';
import { STEP } from '../src/limits';

const twice = STEP * 2;

it('steps', () => {
  expect(twice).toBeGreaterThan(0);
});
