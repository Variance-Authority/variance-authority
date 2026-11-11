import { expect, it } from 'vitest';
import { main } from '../src/entry';

it('steps twice', () => {
  expect(main()).toBe(2);
});
