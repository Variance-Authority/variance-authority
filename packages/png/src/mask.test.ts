import { describe, expect, it } from 'vitest';
import { differencePixels, padTo } from './mask.js';

/**
 * The arithmetic both ends of a comparison run.
 *
 * Tested here rather than through `comparePixels` because the point of the
 * entrypoint is the caller that has pixels and no decoder: a test that reached
 * it through PNG bytes would prove the one thing this module exists not to
 * require.
 */

describe('padding onto the union box', () => {
  it('leaves an image that is already the size alone', () => {
    const image = solid(2, 2, [0, 0, 0]);
    expect(padTo(image, 2, 2)).toBe(image);
  });

  it('puts the image at the top left and the rest is opaque white', () => {
    const padded = padTo(solid(1, 1, [10, 20, 30]), 2, 2);

    expect([...padded.data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
    expect([...padded.data.subarray(4, 8)]).toEqual([255, 255, 255, 255]);
    expect([...padded.data.subarray(8, 16)]).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
  });
});

describe('two images onto one mask', () => {
  it('counts nothing where nothing differs', () => {
    const difference = differencePixels(solid(2, 2, [7, 7, 7]), solid(2, 2, [7, 7, 7]));

    expect(difference.changed).toBe(0);
    expect([difference.width, difference.height]).toEqual([2, 2]);
  });

  it('counts the pixels a policy calls different', () => {
    const difference = differencePixels(solid(2, 1, [0, 0, 0]), solid(2, 1, [255, 255, 255]));

    expect(difference.changed).toBe(2);
  });

  it('grows to the union box, so a taller image differs in the rows it gained', () => {
    // The shorter image pads to white, and the row the taller one added is
    // black: a story that grew by one row differs in that row and not in its
    // whole area, which is the reason padding exists rather than a refusal.
    const taller = solid(1, 2, [255, 255, 255]);
    taller.data.set([0, 0, 0, 255], 4);
    const difference = differencePixels(solid(1, 1, [255, 255, 255]), taller);

    expect([difference.width, difference.height]).toEqual([1, 2]);
    expect(difference.changed).toBe(1);
  });

  it('writes only the differing pixels when the caller wants the mask itself', () => {
    const opaque = differencePixels(solid(1, 1, [0, 0, 0]), solid(1, 1, [255, 255, 255]));
    const mask = differencePixels(
      solid(2, 1, [0, 0, 0]),
      solid(2, 1, [0, 0, 0]),
      undefined,
      { diffMask: true },
    );

    // Unchanged pixels are transparent under a mask, and merely dimmed without one.
    expect(mask.data[3]).toBe(0);
    expect(opaque.data[3]).toBe(255);
  });
});

function solid(
  width: number,
  height: number,
  [red, green, blue]: readonly number[],
): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set([red!, green!, blue!, 255], pixel * 4);
  }
  return { width, height, data };
}
