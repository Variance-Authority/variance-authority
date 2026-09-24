import { expect, it } from 'vitest';
import { returned } from '../src/consumer.js';

it('calls the returned function', () => {
  expect(returned({ enabled: true })).toBe(true);
});
