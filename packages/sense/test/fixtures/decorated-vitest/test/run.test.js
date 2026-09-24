import { expect, it } from 'vitest';
import { Decorated } from '../src/decorated.ts';

it('runs', () => {
  expect(new Decorated().run()).toBe('run');
});
