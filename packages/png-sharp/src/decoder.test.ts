import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { compareRasters, comparePngs, pngjsDecoder } from '@variance-authority/png';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { sharpDecoder } from './index.js';

/**
 * The rule that makes the decoder a speed setting instead of a verdict setting.
 *
 * A run may pick libvips or `pngjs` depending on what a machine can load, and
 * `decoderFor` degrades silently when the native addon is missing. That is only
 * safe while the two produce the *same pixels*: a decoder that differed by one
 * byte would make a subject `changed` on a laptop and `unchanged` in CI, with
 * nothing in either report to say why.
 *
 * So this asserts bytes, not verdicts. Comparing verdicts would pass while both
 * decoders were wrong in the same direction, which is the failure a parity suite
 * exists to catch.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'test',
  engine: 'test@1',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = a;
    }
  }
  return PNG.sync.write(image);
}

function rasterOf(bytes: Buffer, width: number, height: number): Raster {
  return {
    documentDigest: 'sha256-test' as Raster['documentDigest'],
    identity: IDENTITY,
    width,
    height,
    bytes: bytes.toString('base64'),
    missingFonts: [],
  };
}

const CASES: readonly [string, Buffer][] = [
  ['flat opaque colour', png(16, 16, () => [12, 34, 56, 255])],
  ['a gradient, so every filter type gets exercised', png(64, 48, (x, y) => [x * 3, y * 5, (x + y) % 256, 255])],
  ['partial transparency', png(16, 16, (x) => [200, 100, 50, x * 16])],
  ['fully transparent, where a premultiplying decoder would lose the colour', png(8, 8, () => [255, 0, 0, 0])],
  ['one pixel', png(1, 1, () => [1, 2, 3, 4])],
];

describe('sharp and pngjs decode identically', () => {
  it.each(CASES)('%s', async (_name, bytes) => {
    const [fast, portable] = await Promise.all([
      sharpDecoder.decode(bytes),
      pngjsDecoder.decode(bytes),
    ]);

    expect(fast.width).toBe(portable.width);
    expect(fast.height).toBe(portable.height);
    expect(Buffer.from(fast.data).equals(Buffer.from(portable.data))).toBe(true);
  });

  it('reaches the same comparison, including the mask', async () => {
    // The bytes agreeing is the load-bearing claim; this checks it survives the
    // whole path, because a decoder could also disagree about `width` and stay
    // byte-identical on a square image.
    const before = png(40, 24, (x, y) => [x * 2, y * 2, 0, 255]);
    const after = png(40, 24, (x, y) => (x > 30 && y > 10 ? [255, 0, 0, 255] : [x * 2, y * 2, 0, 255]));

    const [fast, portable] = await Promise.all([
      compareRasters(rasterOf(before, 40, 24), rasterOf(after, 40, 24), { decoder: sharpDecoder }),
      compareRasters(rasterOf(before, 40, 24), rasterOf(after, 40, 24), { decoder: pngjsDecoder }),
    ]);

    expect(fast.changed).toEqual(portable.changed);
    expect(fast.mask.changed).toBe(portable.mask.changed);
    expect(Buffer.from(fast.mask.data).equals(Buffer.from(portable.mask.data))).toBe(true);
    // And the same answer the synchronous entry point gives, so the sync and
    // async paths cannot drift apart.
    expect(fast.changed).toEqual(comparePngs(before, after).changed);
  });

  it('pads a size mismatch the same way, rather than refusing it', async () => {
    // `padTo` was rewritten off `PNG.bitblt` onto a raw row copy so it could take
    // any decoder's output. This is the case that rewrite could have broken.
    const small = rasterOf(png(20, 10, () => [0, 0, 0, 255]), 20, 10);
    const large = rasterOf(png(30, 10, () => [0, 0, 0, 255]), 30, 10);

    const [fast, portable] = await Promise.all([
      compareRasters(small, large, { decoder: sharpDecoder }),
      compareRasters(small, large, { decoder: pngjsDecoder }),
    ]);

    expect(fast.dimensionsChanged).toBe(true);
    expect(fast.width).toBe(30);
    expect(fast.changed).toEqual(portable.changed);
    expect(Buffer.from(fast.mask.data).equals(Buffer.from(portable.mask.data))).toBe(true);
  });
});
