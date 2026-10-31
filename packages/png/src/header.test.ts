import { PNG } from 'pngjs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { KEEP_LIMIT, imageSize, isLosslessWebp, refuseOversize, refuseUnkept } from './header.js';

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

/** WebP bytes from the encoder an accept uses; nothing in this package encodes. */
function lossless(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).webp({ lossless: true }).toBuffer();
}

/** A lossy WebP: a format no store keeps, for a test that it is refused. */
function lossy(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).webp({ quality: 50 }).toBuffer();
}

describe('imageSize', () => {
  it('reads the dimensions a PNG declares', () => {
    expect(imageSize(png(390, 871))).toEqual({ width: 390, height: 871 });
  });

  it('reads the dimensions a kept WebP declares, since a baseline is kept as one', async () => {
    expect(imageSize(await lossless(png(390, 871)))).toEqual({ width: 390, height: 871 });
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

describe('isLosslessWebp', () => {
  it('holds for a lossless WebP, transparent or opaque', async () => {
    expect(isLosslessWebp(await lossless(png(3, 2)))).toBe(true);
    const opaque = new PNG({ width: 3, height: 2 });
    opaque.data.fill(255);
    expect(isLosslessWebp(await lossless(PNG.sync.write(opaque)))).toBe(true);
  });

  it('does not hold for a lossy WebP, extended with an alpha chunk or not', async () => {
    expect(isLosslessWebp(await lossy(png(3, 2)))).toBe(false);
    const opaque = new PNG({ width: 3, height: 2 });
    opaque.data.fill(255);
    expect(isLosslessWebp(await lossy(PNG.sync.write(opaque)))).toBe(false);
  });

  it('does not hold for a PNG, or a RIFF that ends before its chunks do', () => {
    expect(isLosslessWebp(png(3, 2))).toBe(false);
    const cut = Buffer.alloc(16);
    cut.write('RIFF', 0);
    cut.write('WEBPVP8L', 8);
    expect(isLosslessWebp(cut)).toBe(false);
  });
});

describe('refuseUnkept', () => {
  it('lets a lossless WebP through', async () => {
    const kept = await lossless(png(3, 2));
    expect(() => refuseUnkept(kept)).not.toThrow();
  });

  it('refuses a PNG, a lossy WebP and bytes in neither format, each by name', async () => {
    expect(() => refuseUnkept(png(3, 2))).toThrow(/are a PNG/);
    expect(() => refuseUnkept(Buffer.alloc(0))).toThrow(/neither a PNG nor a WebP/);
    const lossyKept = await lossy(png(3, 2));
    expect(() => refuseUnkept(lossyKept)).toThrow(/a lossy WebP/);
  });
});

describe('refuseOversize', () => {
  it('lets an image through at the limit and refuses one a pixel past it, by its size', () => {
    expect(() => refuseOversize(png(KEEP_LIMIT, 1))).not.toThrow();
    expect(() => refuseOversize(png(1, KEEP_LIMIT + 1))).toThrow(/a 1x16384 image cannot be kept/);
  });
});
