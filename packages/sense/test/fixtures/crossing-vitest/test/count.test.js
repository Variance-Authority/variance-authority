import { expect, it } from 'vitest';
import { page } from '../src/page.js';
import { count } from '../src/reader.js';

it('counts the items in the page', () => {
  expect(count(page)).toBe(2);
});
