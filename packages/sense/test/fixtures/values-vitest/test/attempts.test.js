import { expect, it } from 'vitest';
import { attempts } from '../src/retries';

it('attempts', () => {
  expect(attempts()).toBe(1);
});
