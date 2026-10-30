import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide.js';

describe('in a page', () => {
  it('takes the alpha path', () => {
    console.log('deciding alpha');
    expect(decide('alpha')).toBe('A');
  });

  it('takes the gamma path', () => {
    expect(decide('gamma')).toBe('G');
  });
});
