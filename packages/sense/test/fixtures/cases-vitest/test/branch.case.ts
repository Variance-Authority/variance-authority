import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide.js';

describe('decide', () => {
  it('takes the alpha branch', () => {
    expect(decide('alpha')).toBe('A');
  });

  it('takes the gamma branch', () => {
    expect(decide('gamma')).toBe('G');
  });

  it('falls through to B', () => {
    expect(decide('beta')).toBe('B');
  });
});
