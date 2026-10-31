import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { keepImage } from './format.js';
import { imageSize } from './header.js';

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

describe('imageSize', () => {
  it('reads the dimensions a PNG declares', () => {
    expect(imageSize(png(390, 871))).toEqual({ width: 390, height: 871 });
  });

  it('reads the dimensions a kept WebP declares, since a baseline is kept as one', async () => {
    expect(imageSize(await keepImage(png(390, 871)))).toEqual({ width: 390, height: 871 });
  });

  it('reads the canvas an extended WebP declares, as one carrying metadata is', () => {
    const extended = Buffer.alloc(30);
    extended.write('RIFF', 0);
    extended.writeUInt32LE(22, 4);
    extended.write('WEBPVP8X', 8);
    extended.writeUIntLE(390 - 1, 24, 3);
    extended.writeUIntLE(871 - 1, 27, 3);
    expect(imageSize(extended)).toEqual({ width: 390, height: 871 });
  });

  it('says nothing about a lossy WebP, which nothing here keeps', () => {
    const lossy = Buffer.alloc(30);
    lossy.write('RIFF', 0);
    lossy.write('WEBPVP8 ', 8);
    expect(imageSize(lossy)).toBe(null);
  });

  it('says nothing about bytes that are neither a PNG nor a WebP', () => {
    expect(imageSize(Buffer.from('a truncated download, or an HTML error page, or a JPEG'))).toBe(
      null,
    );
  });

  it('says nothing about a file too short to hold a header', () => {
    expect(imageSize(png(4, 4).subarray(0, 20))).toBe(null);
  });
});
