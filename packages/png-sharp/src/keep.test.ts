import { PNG } from 'pngjs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { imageFormat, isLosslessWebp, KEEP_LIMIT, pngjsDecoder } from '@variance-authority/png';
import { keepImage } from './index.js';

/**
 * A kept image is a promise that the picture a reviewer accepted is the picture
 * the next run compares against. WebP is chosen for the bytes it saves in a
 * store, and it may only save bytes: every pixel the comparison sees comes back.
 * A fully transparent pixel is seen as transparent whatever colour sits under
 * it, and libwebp, through sharp, does not keep that colour.
 */

function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number],
): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) image.data.set(paint(x, y), (y * width + x) * 4);
  }
  return PNG.sync.write(image);
}

const picture = png(7, 5, (x, y) =>
  x === 3 && y === 2 ? [10, 20, 30, 0] : [(x * 37) % 256, (y * 53) % 256, (x * y * 11) % 256, 128 + x * 10],
);

describe('keepImage', () => {
  it('keeps a lossless WebP of every pixel the comparison sees', async () => {
    const kept = await keepImage(picture);
    expect(isLosslessWebp(kept)).toBe(true);
    const before = PNG.sync.read(picture).data;
    const after = (await pngjsDecoder.decode(kept)).data;
    for (let at = 0; at < before.length; at += 4) {
      if (before[at + 3] === 0) expect(after[at + 3]).toBe(0);
      else expect([...after.subarray(at, at + 4)]).toEqual([...before.subarray(at, at + 4)]);
    }
  });

  it('passes a lossless WebP through untouched, so keeping an image twice encodes it once', async () => {
    const kept = await keepImage(picture);
    expect(await keepImage(kept)).toBe(kept);
  });

  it('refuses a lossy WebP rather than pass it through as kept', async () => {
    const lossy = await sharp(picture).webp({ quality: 50 }).toBuffer();
    expect(imageFormat(lossy)).toBe('webp');
    await expect(keepImage(lossy)).rejects.toThrow(/a lossy WebP/);
  });

  it('refuses an image wider or taller than a WebP can hold, before encoding it', async () => {
    const tall = PNG.sync.write(new PNG({ width: 1, height: KEEP_LIMIT + 1 }));
    await expect(keepImage(tall)).rejects.toThrow(/16383/);
  });

  it('refuses bytes that are no image at all', async () => {
    await expect(keepImage(Buffer.from('not an image'))).rejects.toThrow(/neither a PNG nor a WebP/);
  });
});
