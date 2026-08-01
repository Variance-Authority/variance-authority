import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { isolateRegions } from '@variance-authority/core';
import { comparePngs, DEFAULT_POLICY, STRICT_POLICY } from './compare.js';

/**
 * Comparison, on images built pixel by pixel rather than rendered.
 *
 * Nothing here needs a browser, which is the point: the arithmetic that decides
 * whether two images differ is separable from the machinery that produced them,
 * and a synthetic image is the only kind whose expected answer is known exactly.
 */

function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const index = (y * width + x) * 4;
      image.data[index] = r;
      image.data[index + 1] = g;
      image.data[index + 2] = b;
      image.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const WHITE = () => [255, 255, 255] as const;

describe('comparing two rasters', () => {
  it('reports nothing for two identical images', () => {
    const image = png(20, 20, WHITE);
    const comparison = comparePngs(image, image);

    expect(comparison.changed[DEFAULT_POLICY.id]).toBe(0);
    expect(comparison.mask.changed).toBe(0);
    expect(comparison.dimensionsChanged).toBe(false);
  });

  it('produces a mask whose set pixels are exactly the ones that differ', () => {
    // The mask is the artifact everything downstream computes on, so it has to
    // be positionally exact rather than merely correct in aggregate.
    const before = png(20, 20, WHITE);
    const after = png(20, 20, (x, y) =>
      x >= 5 && x < 10 && y >= 5 && y < 10 ? [0, 0, 0] : [255, 255, 255],
    );

    const comparison = comparePngs(before, after);

    expect(comparison.changed[DEFAULT_POLICY.id]).toBe(25);
    expect(comparison.mask.changed).toBe(25);

    const regions = isolateRegions(comparison.mask, { cell: 1 }).regions;
    expect(regions).toEqual([{ x: 5, y: 5, width: 5, height: 5, pixels: 25, density: 1 }]);
  });

  it('reports both a forgiving and an exact policy', () => {
    // Quoting one threshold is the most common way to lie with a pixel
    // measurement. A change under the default's tolerance is invisible at
    // `threshold: 0.1` and plainly there at `0`.
    const before = png(10, 10, () => [255, 255, 255]);
    const after = png(10, 10, () => [253, 255, 255]);

    const comparison = comparePngs(before, after);

    expect(comparison.changed[DEFAULT_POLICY.id]).toBe(0);
    expect(comparison.changed[STRICT_POLICY.id]).toBe(100);
  });

  it('pads a resized subject onto the union box instead of failing', () => {
    // Playwright's own `toHaveScreenshot` fails outright on a size mismatch,
    // which lets a layout change score "detected" without measuring anything.
    const before = png(20, 20, WHITE);
    const after = png(20, 30, WHITE);

    const comparison = comparePngs(before, after);

    expect(comparison.dimensionsChanged).toBe(true);
    expect(comparison.height).toBe(30);
    // Padded with white — the page's declared canvas — so a subject that grew by
    // ten rows of background differs in nothing.
    expect(comparison.changed[DEFAULT_POLICY.id]).toBe(0);
  });

  it('refuses to return a mask from a policy it was not asked to count', () => {
    // Otherwise the counts and the regions beside them describe two different
    // comparisons, and the report reads as one.
    const image = png(4, 4, WHITE);

    expect(() =>
      comparePngs(image, image, { policies: [DEFAULT_POLICY], isolateWith: STRICT_POLICY }),
    ).toThrow(/was not among the compared policies/);
  });
});
