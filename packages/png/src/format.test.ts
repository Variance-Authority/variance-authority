import { PNG } from 'pngjs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodePortable, imageFormat } from './format.js';
import { diffImage, pngjsDecoder } from './compare.js';

/**
 * A kept baseline is a lossless WebP, and a comparison reads it without a
 * native addon: the format comes from the bytes, and the pixels from libwebp
 * compiled to WebAssembly. Nothing here encodes; the encode is the accept's.
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

/** WebP bytes from the encoder an accept uses; nothing in this package encodes. */
function lossless(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).webp({ lossless: true }).toBuffer();
}

const picture = png(7, 5, (x, y) => [(x * 37) % 256, (y * 53) % 256, (x * y * 11) % 256, 128 + x * 10]);

describe('imageFormat', () => {
  it('reads the format from the bytes, not from a name beside them', async () => {
    expect(imageFormat(picture)).toBe('png');
    expect(imageFormat(await lossless(picture))).toBe('webp');
    expect(imageFormat(Buffer.from('<!doctype html> a proxy error page'))).toBe(null);
  });
});

describe('decodePortable', () => {
  it('refuses bytes in neither format by name, rather than as a corrupt PNG', async () => {
    await expect(decodePortable(Buffer.from('<!doctype html> a proxy error page'))).rejects.toThrow(
      /neither a PNG nor a WebP/,
    );
  });
});

describe('pngjsDecoder', () => {
  it('reads a kept WebP without a native addon, to every channel of every pixel', async () => {
    const decoded = await pngjsDecoder.decode(await lossless(picture));
    expect(Buffer.from(decoded.data).equals(PNG.sync.read(picture).data)).toBe(true);
  });
});

describe('diffImage', () => {
  it('draws the difference between a kept baseline and a fresh capture', async () => {
    const moved = png(7, 5, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const blank = png(7, 5, () => [255, 255, 255, 255]);
    const diff = PNG.sync.read(await diffImage(await lossless(blank), moved));
    expect({ width: diff.width, height: diff.height }).toEqual({ width: 7, height: 5 });
  });
});
