import { describe, expect, it } from 'vitest';

import { put, varints } from './varints.js';

const refused = () => new Error('refused');

describe('varints', () => {
  it('reads back the most five bytes hold, and refuses one past it', () => {
    const out: number[] = [];
    put(out, 2 ** 35 - 1);

    expect(out).toEqual([0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(varints(Uint8Array.from(out), refused).take()).toBe(2 ** 35 - 1);
    expect(() => put([], 2 ** 35)).toThrow(RangeError);
    expect(() => put([], -1)).toThrow(RangeError);
  });

  it('refuses a sixth byte, a varint cut short and a slice past the end', () => {
    expect(() => varints(Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0]), refused).take()).toThrow('refused');
    expect(() => varints(Uint8Array.from([0x80]), refused).take()).toThrow('refused');
    const read = varints(Uint8Array.from([1, 2]), refused);
    expect(read.left).toBe(2);
    expect(() => read.bytes(3)).toThrow('refused');
  });
});
