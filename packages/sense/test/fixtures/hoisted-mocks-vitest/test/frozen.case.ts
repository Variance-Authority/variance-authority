import { expect, it } from 'vitest';
import { stamp } from '../src/frozen.ts';

it('stamps with the clock its module mocked', () => {
  expect(stamp('a')).toBe('a@42');
});
