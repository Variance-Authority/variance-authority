import { expect, it } from 'vitest';
import { label } from '../src/reader.js';

it('labels in this process', () => {
  expect(label('x')).toBe('[x]');
});
