import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { decodePortable, imageFormat, keepImage, KEEP_LIMIT } from './format.js';
import { diffImage, pngjsDecoder } from './compare.js';

/**
 * A kept image is a promise that the pixels a reviewer accepted are the pixels
 * the next run compares against. WebP is chosen for the bytes it saves in a
 * store, and it is only allowed to save bytes: every value in every channel
 * comes back, including the colour under a fully transparent pixel, which a
 * lossless WebP encoder discards unless it is told to keep it exactly.
 */

function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number],
): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      image.data.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return PNG.sync.write(image);
}

/** Colour under a transparent pixel, which `exact` exists to keep. */
const HIDDEN: readonly [number, number, number, number] = [10, 20, 30, 0];

const picture = png(7, 5, (x, y) =>
  x === 3 && y === 2 ? HIDDEN : [(x * 37) % 256, (y * 53) % 256, (x * y * 11) % 256, 128 + x * 10],
);

describe('imageFormat', () => {
  it('reads the format from the bytes, not from a name beside them', async () => {
    expect(imageFormat(picture)).toBe('png');
    expect(imageFormat(await keepImage(picture))).toBe('webp');
    expect(imageFormat(Buffer.from('<!doctype html> a proxy error page'))).toBe(null);
  });
});

describe('keepImage', () => {
  it('keeps every channel of every pixel, the colour under transparency included', async () => {
    const kept = await keepImage(picture);
    const before = PNG.sync.read(picture);
    const after = await decodePortable(kept);
    expect({ width: after.width, height: after.height }).toEqual({ width: 7, height: 5 });
    expect(Buffer.from(after.data).equals(before.data)).toBe(true);
    const hidden = (2 * 7 + 3) * 4;
    expect([...after.data.subarray(hidden, hidden + 4)]).toEqual(HIDDEN);
  });

  it('passes a WebP through untouched, so keeping an image twice encodes it once', async () => {
    const kept = await keepImage(picture);
    expect(await keepImage(kept)).toBe(kept);
  });

  it('refuses an image wider or taller than a WebP can hold, before decoding it', async () => {
    const tall = PNG.sync.write(new PNG({ width: 1, height: KEEP_LIMIT + 1 }));
    await expect(keepImage(tall)).rejects.toThrow(/16383/);
  });

  it('refuses bytes that are no image at all', async () => {
    await expect(keepImage(Buffer.from('not an image'))).rejects.toThrow(/neither a PNG nor a WebP/);
  });
});

describe('pngjsDecoder', () => {
  it('reads a kept WebP without a native addon', async () => {
    const decoded = await pngjsDecoder.decode(await keepImage(picture));
    expect(Buffer.from(decoded.data).equals(PNG.sync.read(picture).data)).toBe(true);
  });
});

describe('diffImage', () => {
  it('draws the difference between a kept baseline and a fresh capture', async () => {
    const moved = png(7, 5, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const blank = png(7, 5, () => [255, 255, 255, 255]);
    const diff = PNG.sync.read(await diffImage(await keepImage(blank), moved));
    expect({ width: diff.width, height: diff.height }).toEqual({ width: 7, height: 5 });
  });
});
