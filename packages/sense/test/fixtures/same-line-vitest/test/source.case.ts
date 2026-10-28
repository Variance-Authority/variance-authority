import { expect, it } from 'vitest';
import { pick } from '../src/pick.ts';

it('finds the item itself', () => {
  expect(pick(['a'], 'a')).toBe('a');
});
