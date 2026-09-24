import { expect, it } from 'vitest';
import { returned } from '../src/consumer.js';

it('imports the returned function without calling it', () => {
  expect(typeof returned).toBe('function');
});
