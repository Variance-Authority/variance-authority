import { expect, it } from 'vitest';
import { page } from '../src/page.js';
import { size } from '../src/reader.js';

it('sizes the page and leaves early', () => {
  expect(size(page, true)).toBe(3);
});
