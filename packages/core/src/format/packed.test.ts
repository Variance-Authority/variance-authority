import { describe, expect, it } from 'vitest';
import { keepsSnapshot } from './packed.js';

/**
 * Whether a raster kept a snapshot, asked without unpacking it.
 *
 * Every store asks this, tribunal's inside a Worker with no `node:zlib`, and
 * `settle` decides from the answer whether a subject renders. So it is the
 * answer `unpackSnapshot` gives of the same text, as far as the header can say.
 */
describe('a kept snapshot', () => {
  it('is one of the format this code reads', () => {
    expect(keepsSnapshot('v1:H4sIAAAAAAAAA6uuBQBDv6ajAgAAAA==')).toBe(true);
  });

  it('is none when there is none', () => {
    expect(keepsSnapshot(undefined)).toBe(false);
  });

  it('is none when it is of another format', () => {
    expect(keepsSnapshot('v2:H4sIAAAAAAAAA6uuBQBDv6ajAgAAAA==')).toBe(false);
  });

  it('is none when it carries no header', () => {
    expect(keepsSnapshot('H4sIAAAAAAAAA6uuBQBDv6ajAgAAAA==')).toBe(false);
  });
});
