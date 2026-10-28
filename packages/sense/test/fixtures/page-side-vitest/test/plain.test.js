import { expect, it } from 'vitest';
import { plain } from '../src/plain';

it('runs no page', () => {
  expect(plain()).toBe('plain');
});
