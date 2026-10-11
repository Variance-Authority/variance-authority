import { expect, it } from 'vitest';
import { page } from '../src/page.js';
import { kind } from '../src/reader.js';

it('counts on the page in the case that sends the function', () => {
  expect(kind(page, 'count')).toBe(3);
});
