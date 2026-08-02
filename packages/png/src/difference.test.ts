import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  YIQ_DISTANCE,
  compareDifferenceObservations,
  fieldStatistics,
  measureYiqDistance,
  yiqThresholdForSeverity,
} from '@variance-authority/raster/difference';
import { decodeImage, observePngDifference } from './difference.js';

const WIDTH = 64;
const HEIGHT = 48;

/** Deterministic noise; a seeded LCG so a failure is reproducible. */
function noise(seed: number, width = WIDTH, height = HEIGHT, alpha = 255): PNG {
  const png = new PNG({ width, height });
  let state = seed >>> 0;
  for (let index = 0; index < width * height; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    png.data[index * 4] = state & 0xff;
    png.data[index * 4 + 1] = (state >>> 8) & 0xff;
    png.data[index * 4 + 2] = (state >>> 16) & 0xff;
    png.data[index * 4 + 3] = alpha;
  }
  return png;
}

/**
 * Two regions that differ by the *same* amount for two different reasons.
 *
 * Left: a black/white boundary whose single transition column carries
 * `transition` — the shape `pixelmatch`'s antialias detector is built to find.
 * Right: a flat block carrying `block`, where every neighbour is equal and the
 * detector bails out immediately.
 *
 * Choosing `transition` and `block` so both move by the same grey delta puts
 * identical values in the difference field at pixels the antialias rule treats
 * oppositely, which is what makes the level-set argument below airtight.
 */
function edgeAndBlock(transition: number, block: number): PNG {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let value: number;
      if (x < 16) value = 0;
      else if (x === 16) value = transition;
      else if (x < 32) value = 255;
      else value = block;

      const at = (y * WIDTH + x) * 4;
      png.data[at] = value;
      png.data[at + 1] = value;
      png.data[at + 2] = value;
      png.data[at + 3] = 255;
    }
  }
  return png;
}

const bytes = (png: PNG): Buffer => PNG.sync.write(png);

/** Pixels strictly above a severity — the count `pixelmatch` produces. */
function countAbove(values: Float32Array, severity: number): number {
  let count = 0;
  for (const value of values) if (value > severity) count += 1;
  return count;
}

describe('YIQ_DISTANCE against pixelmatch itself', () => {
  const a = noise(1);
  const b = noise(2);
  const first = decodeImage(bytes(a));
  const second = decodeImage(bytes(b));
  const field = measureYiqDistance(first, second);

  it.each([0, 0.0025, 0.01, 0.04, 0.16, 0.36, 0.64])(
    'reproduces the pixelmatch count exactly at severity %s',
    (severity) => {
      const expected = pixelmatch(a.data, b.data, null, WIDTH, HEIGHT, {
        threshold: yiqThresholdForSeverity(severity),
        includeAA: true,
        checkerboard: false,
      });
      expect(countAbove(field.values, severity)).toBe(expected);
    },
  );

  it('agrees on semi-transparent pixels when pixelmatch blends against white', () => {
    const translucentA = noise(3, WIDTH, HEIGHT, 128);
    const translucentB = noise(4, WIDTH, HEIGHT, 200);
    const alphaField = measureYiqDistance(
      decodeImage(bytes(translucentA)),
      decodeImage(bytes(translucentB)),
    );

    for (const severity of [0.01, 0.16]) {
      const expected = pixelmatch(translucentA.data, translucentB.data, null, WIDTH, HEIGHT, {
        threshold: yiqThresholdForSeverity(severity),
        includeAA: true,
        checkerboard: false,
      });
      expect(countAbove(alphaField.values, severity)).toBe(expected);
    }
  });
});

describe('what a severity threshold cannot express', () => {
  it('antialias forgiveness is spatial, so it is not a level set of any field', () => {
    // Both regions move by a grey delta of 89, so the difference field holds one
    // single non-zero value across every changed pixel. `includeAA: false` keeps
    // some of those pixels and drops others — a partition no threshold on that
    // field can produce, because thresholding a constant is all-or-nothing.
    //
    // This is why the curve generalises a *magnitude* policy and does not
    // subsume `DEFAULT_POLICY`: that policy moves two knobs, and only one of them
    // lives on the severity axis.
    const a = edgeAndBlock(255, 100);
    const b = edgeAndBlock(166, 11);

    const field = measureYiqDistance(decodeImage(bytes(a)), decodeImage(bytes(b)));
    const distinct = new Set([...field.values].filter((value) => value > 0));
    expect(distinct.size).toBe(1);

    const included = pixelmatch(a.data, b.data, null, WIDTH, HEIGHT, {
      threshold: 0.1,
      includeAA: true,
      checkerboard: false,
    });
    const forgiven = pixelmatch(a.data, b.data, null, WIDTH, HEIGHT, {
      threshold: 0.1,
      includeAA: false,
      checkerboard: false,
    });

    expect(included).toBe(countAbove(field.values, 0.01));
    expect(forgiven).toBeGreaterThan(0);
    expect(forgiven).toBeLessThan(included);

    // Every level set of this field is either everything or nothing, and the
    // forgiven count is strictly between. No severity reproduces it.
    const levels = [0, 0.0001, 0.001, 0.01, 0.02, 0.04, 0.08, 0.11, 0.12, 0.16, 0.64];
    expect(levels.map((level) => countAbove(field.values, level))).toEqual(
      levels.map((level) => (level < [...distinct][0]! ? included : 0)),
    );
    expect(levels.some((level) => countAbove(field.values, level) === forgiven)).toBe(false);
  });
});

describe('decodeImage', () => {
  it('declares alpha opaque only when every pixel is', () => {
    expect(decodeImage(bytes(noise(5))).alphaMode).toBe('opaque');
    expect(decodeImage(bytes(noise(5, WIDTH, HEIGHT, 254))).alphaMode).toBe('straight');
  });

  it('declares the colour space rather than sniffing it', () => {
    expect(decodeImage(bytes(noise(6))).colorSpace).toBe('srgb');
    expect(decodeImage(bytes(noise(6)), 'display-p3').colorSpace).toBe('display-p3');
  });
});

describe('observePngDifference', () => {
  const levels = [0, 0.01, 0.04, 0.16, 0.64];

  it('hashes the encoded bytes, not the decoded pixels', async () => {
    const observation = await observePngDifference({
      firstImage: bytes(noise(7)),
      secondImage: bytes(noise(8)),
      metric: YIQ_DISTANCE,
      severityLevels: levels,
    });

    expect(observation.sourceHashes.firstImage).not.toBe(observation.sourceHashes.secondImage);
    expect(observation.image).toEqual({
      width: WIDTH,
      height: HEIGHT,
      colorSpace: 'srgb',
      alphaMode: 'opaque',
    });
    expect(observation.curve.map((point) => point.severity)).toEqual(levels);
  });

  it('refuses two PNGs of different sizes', async () => {
    await expect(
      observePngDifference({
        firstImage: bytes(noise(9)),
        secondImage: bytes(noise(9, WIDTH, HEIGHT + 1)),
        metric: YIQ_DISTANCE,
        severityLevels: levels,
      }),
    ).rejects.toThrow(/does not resize, pad or align/);
  });

  it('measures a known difference and then how it moved', async () => {
    // Two engines that never agreed: B has always drawn the edge one step softer
    // and the block one step darker. That difference is the baseline, not a fault.
    const chromiumish = bytes(edgeAndBlock(255, 100));

    const baseline = await observePngDifference({
      firstImage: chromiumish,
      secondImage: bytes(edgeAndBlock(166, 11)),
      metric: YIQ_DISTANCE,
      severityLevels: levels,
    });
    expect(fieldStatistics(baseline.field).changedPixels).toBeGreaterThan(0);

    const current = await observePngDifference({
      firstImage: chromiumish,
      secondImage: bytes(edgeAndBlock(60, 0)),
      metric: YIQ_DISTANCE,
      severityLevels: levels,
    });

    const comparison = compareDifferenceObservations(baseline, current);
    expect(comparison.summary.totalIncrease).toBeGreaterThan(comparison.summary.totalDecrease);
    expect(comparison.curveDelta.some((point) => point.pixelCountDelta > 0)).toBe(true);
  });
});
