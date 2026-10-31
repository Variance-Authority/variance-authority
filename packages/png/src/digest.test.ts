import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { compareRasters, comparePixels, pixelDigest, pngjsDecoder, type DecodedImage, type PngDecoder } from './index.js';

/**
 * A kept baseline records the digest of its pixels, and a comparison whose
 * capture decodes to the same digest is settled without decoding the baseline.
 *
 * The digest stands in for the comparison, never for a judgement: equal digests
 * are equal pixels, so the empty comparison it returns is the one the pixels
 * would have produced, and it is held to exactly that below.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'test',
  engine: 'test@1',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

function image(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): DecodedImage {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function rasterOf(pixels: DecodedImage, extra: Partial<Raster> = {}): Raster {
  const encoded = new PNG({ width: pixels.width, height: pixels.height });
  encoded.data = Buffer.from(pixels.data);
  return {
    documentDigest: 'v1-test' as Raster['documentDigest'],
    identity: IDENTITY,
    width: pixels.width,
    height: pixels.height,
    bytes: PNG.sync.write(encoded).toString('base64'),
    missingFonts: [],
    ...extra,
  };
}

function counting(): PngDecoder & { readonly calls: () => number } {
  let calls = 0;
  return {
    decode: async (bytes) => {
      calls += 1;
      return pngjsDecoder.decode(bytes);
    },
    calls: () => calls,
  };
}

const GRADIENT = image(24, 16, (x, y) => [x * 9, y * 13, (x + y) % 256, 255]);

describe('the digest of a raster’s pixels', () => {
  it('is the same for pixels that differ only in the colour under full transparency', () => {
    const red = image(4, 4, (x) => (x === 0 ? [255, 0, 0, 0] : [1, 2, 3, 255]));
    const blue = image(4, 4, (x) => (x === 0 ? [0, 0, 255, 0] : [1, 2, 3, 255]));

    expect(pixelDigest(red)).toBe(pixelDigest(blue));
  });

  it('moves when one channel of one visible pixel moves', () => {
    const nudged = image(24, 16, (x, y) =>
      x === 7 && y === 3 ? [x * 9, y * 13, ((x + y) % 256) + 1, 255] : [x * 9, y * 13, (x + y) % 256, 255],
    );

    expect(pixelDigest(nudged)).not.toBe(pixelDigest(GRADIENT));
  });

  it('moves when the same bytes are laid out at another width', () => {
    const wide = { width: 4, height: 1, data: Buffer.from(new Uint8Array(16).fill(255)) };
    const tall = { width: 1, height: 4, data: wide.data };

    expect(pixelDigest(wide)).not.toBe(pixelDigest(tall));
  });
});

describe('comparing a capture with a baseline that records its pixel digest', () => {
  it('decodes only the capture when the digests agree, and returns what the pixels would have', async () => {
    const decoder = counting();
    // Bytes no decoder can read: the comparison may not touch them.
    const before: Raster = { ...rasterOf(GRADIENT), bytes: 'bm90IGFuIGltYWdl', pixels: pixelDigest(GRADIENT) };

    const comparison = await compareRasters(before, rasterOf(GRADIENT), { decoder });

    expect(decoder.calls()).toBe(1);
    expect(comparison).toEqual(comparePixels(GRADIENT, GRADIENT));
  });

  it('decodes both when the digests disagree', async () => {
    const decoder = counting();
    const other = image(24, 16, () => [0, 0, 0, 255]);
    const before = rasterOf(other, { pixels: pixelDigest(other) });

    const comparison = await compareRasters(before, rasterOf(GRADIENT), { decoder });

    expect(decoder.calls()).toBe(2);
    expect(comparison).toEqual(comparePixels(other, GRADIENT));
  });

  it('decodes both when the baseline records no digest', async () => {
    const decoder = counting();

    const comparison = await compareRasters(rasterOf(GRADIENT), rasterOf(GRADIENT), { decoder });

    expect(decoder.calls()).toBe(2);
    expect(comparison).toEqual(comparePixels(GRADIENT, GRADIENT));
  });
});
