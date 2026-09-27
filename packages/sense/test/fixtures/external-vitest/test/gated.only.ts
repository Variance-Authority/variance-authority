import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide.js';

// One test that runs, and a group behind a gate that is closed on this machine:
// what `READY ? describe : describe.skip` leaves on a machine without a browser.
it('takes the beta path', () => {
  expect(decide('beta')).toBe('B');
});

describe.skip('behind the gate', () => {
  it('takes the gamma path', () => {
    expect(decide('gamma')).toBe('G');
  });
});
