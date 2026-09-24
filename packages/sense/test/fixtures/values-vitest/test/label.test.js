import { expect, it } from 'vitest';
import { label } from '../src/slider';

it('names the control', () => {
  expect(label()).toBe('slider');
});
