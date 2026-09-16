import { describe, expect, it } from 'vitest';
import { slowly } from '../src/decide.js';

// Both cases are in flight at once and each awaits inside the module under
// test, so every continuation of one resumes while the other is open. A
// snapshot-and-subtract drain attributes both to whichever finished second.
describe.concurrent('slowly', () => {
  it('takes the alpha branch while the other case is open', async () => {
    expect(await slowly('alpha')).toBe('slow A');
  });

  it('takes the fallthrough while the other case is open', async () => {
    expect(await slowly('beta')).toBe('slow B');
  });
});
