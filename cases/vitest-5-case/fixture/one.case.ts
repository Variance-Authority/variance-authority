import { describe, expect, it } from 'vitest';
import { add } from './add.js';

// Both cases are in flight at once under `sequence.concurrent`, and each awaits
// inside the module under test, so every continuation of one resumes while the
// other is open.
describe('add', () => {
  it('adds one', async () => {
    expect(await add(1, 1)).toBe(2);
  });

  it('adds more', async () => {
    expect(await add(1, 2)).toBe(3);
  });
});
