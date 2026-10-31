import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import {
  compareRasters,
  comparePixels,
  pixelDigest,
  pngjsDecoder,
  edgeDigest,
  type DecodedImage,
  type PngDecoder,
} from './index.js';
import { alignRows } from './align.js';

// Wrapped, not replaced: every comparison aligns as it would, and the one of
// equal pixels is held to aligning nothing.
vi.mock('./align.js', async (actual) => {
  const module = await actual<typeof import('./align.js')>();
  return { ...module, alignRows: vi.fn(module.alignRows) };
});

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

/** A card: a box of one colour on a ground of another, with a line of "text" in a third. */
function card(ground: Rgba, box: Rgba, ink: Rgba, left = 4): DecodedImage {
  return image(24, 16, (x, y) => {
    if (y === 8 && x >= left + 2 && x < left + 10) return ink;
    if (x >= left && x < left + 14 && y >= 3 && y < 13) return box;
    return ground;
  });
}
type Rgba = [number, number, number, number];
const WHITE: Rgba = [255, 255, 255, 255];
const BLUE: Rgba = [45, 108, 223, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const DARK: Rgba = [18, 18, 18, 255];
const MAGENTA: Rgba = [181, 23, 158, 255];

describe('the digest of a raster’s edges', () => {
  it('is the same when every colour is swapped for another, as a theme does', () => {
    expect(edgeDigest(card(DARK, MAGENTA, WHITE))).toBe(edgeDigest(card(WHITE, BLUE, BLACK)));
  });

  it('moves when the box moves by one pixel', () => {
    expect(edgeDigest(card(WHITE, BLUE, BLACK, 5))).not.toBe(edgeDigest(card(WHITE, BLUE, BLACK)));
  });

  it('moves when two colours become one, because an edge went with them', () => {
    expect(edgeDigest(card(WHITE, WHITE, BLACK))).not.toBe(edgeDigest(card(WHITE, BLUE, BLACK)));
  });

  it('is absent for an image whose pixels nearly all sit on an edge, which no change inside can move', () => {
    expect(edgeDigest(GRADIENT)).toBeUndefined();
  });

  it('is the same for pixels that differ only in the colour under full transparency', () => {
    const clear = (under: Rgba): DecodedImage => image(4, 4, (x) => (x < 2 ? under : BLUE));
    expect(edgeDigest(clear([255, 0, 0, 0]))).toBe(edgeDigest(clear([0, 0, 255, 0])));
  });
});

describe('a comparison of two images', () => {
  it('of equal pixels is the comparison of nothing, found without reading a row', () => {
    const copy = { ...GRADIENT, data: Buffer.from(GRADIENT.data) };
    vi.mocked(alignRows).mockClear();

    expect(comparePixels(GRADIENT, copy)).toEqual({
      width: 24,
      height: 16,
      dimensionsChanged: false,
      before: { width: 24, height: 16 },
      after: { width: 24, height: 16 },
      changed: { default: 0, strict: 0 },
      total: 24 * 16,
      mask: { width: 24, height: 16, data: new Uint8Array(24 * 16), changed: 0 },
      alignment: { inserted: [], removed: [], shifted: [] },
      edges: 'kept',
    });
    expect(alignRows).not.toHaveBeenCalled();
  });

  it('says the edges were kept when only the colours changed', () => {
    const comparison = comparePixels(card(WHITE, BLUE, BLACK), card(DARK, MAGENTA, WHITE));

    expect(comparison.changed['strict']).toBeGreaterThan(0);
    expect(comparison.edges).toBe('kept');
  });

  it('says the edges moved when the box moved', () => {
    expect(comparePixels(card(WHITE, BLUE, BLACK), card(WHITE, BLUE, BLACK, 5)).edges).toBe('moved');
  });

  it('says nothing of the edges when an image is too busy for its edges to say', () => {
    const notched = image(24, 16, (x, y) => (x === 7 && y === 3 ? WHITE : [x * 9, y * 13, (x + y) % 256, 255]));

    expect(comparePixels(GRADIENT, notched).edges).toBeUndefined();
  });

  it('says the edges moved when the size changed', () => {
    expect(comparePixels(GRADIENT, image(24, 17, () => WHITE)).edges).toBe('moved');
  });
});
