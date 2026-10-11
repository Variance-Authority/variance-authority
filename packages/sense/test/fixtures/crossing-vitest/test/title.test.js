import { expect, it } from 'vitest';
import { page } from '../src/page.js';
import { title } from '../src/reader.js';

it('reads the title in the page', () => {
  expect(title(page)).toBe('Home');
});
