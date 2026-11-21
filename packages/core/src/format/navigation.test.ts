import { describe, expect, it } from 'vitest';
import { navigationNote } from './navigation.js';

describe('navigationNote', () => {
  it('names the address a top frame loaded, without its query or fragment', () => {
    expect(navigationNote('http://shop.test/checkout?step=2#pay', false)).toBe('page navigated http://shop.test/checkout');
  });

  it('says a reload before the address, so a note cut to fit keeps it', () => {
    expect(navigationNote('http://reloading.test/', true)).toBe('page reloaded http://reloading.test/');
  });
});
