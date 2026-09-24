import { expect, it } from 'vitest';
import { count } from '../src/registry';

it('counts', () => {
  expect(count()).toBe(1);
});
