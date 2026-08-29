import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { pngSize } from './size.js';

/**
 * Reading a header is only worth doing if it refuses to answer when it cannot.
 *
 * The caller is a push deciding whether it can tell a reviewer that two captures
 * are different shapes. A guess would be worse than silence: it would put a claim
 * about a raster nobody read next to the ones that were measured.
 */

function png(width: number, height: number): Buffer {
  return PNG.sync.write(new PNG({ width, height }));
}

describe('pngSize', () => {
  it('reads the dimensions a PNG declares', () => {
    expect(pngSize(png(390, 871))).toEqual({ width: 390, height: 871 });
  });

  it('says nothing about bytes that are not a PNG', () => {
    expect(pngSize(Buffer.from('a truncated download, or an HTML error page, or a JPEG'))).toBe(
      null,
    );
  });

  it('says nothing about a file too short to hold a header', () => {
    expect(pngSize(png(4, 4).subarray(0, 20))).toBe(null);
  });
});
