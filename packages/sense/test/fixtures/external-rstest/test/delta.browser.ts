import { describe, expect, it } from '@rstest/core';
import { decide } from '../src/decide';

describe('in a page', () => {
  it('takes the alpha path', () => {
    console.log('deciding alpha');
    expect(decide('alpha')).toBe('A');
  });

  it('takes the gamma path', () => {
    expect(decide('gamma')).toBe('G');
  });
});
