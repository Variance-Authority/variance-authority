import { expect, it } from 'vitest';
import { pick } from '../build/pick.js';

it('falls back to an item that starts with it', () => {
  expect(pick(['ab'], 'a')).toBe('ab');
});
