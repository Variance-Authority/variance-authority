import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { foreignRaster } from '@variance-authority/png';
import { observeRasters } from './observe.js';

/**
 * *Existing raster library input* — the gate row, run.
 *
 * [`docs/gates.md`](../../../docs/gates.md) scores this **yes** against Argos on
 * the strength of `observeRasters` and a raster `CaptureArtifact`, and
 * [`docs/comparison.md`](../../../docs/comparison.md) sells it as the library
 * seam that replaces a CLI upload. Neither `observeRasters` nor
 * `@variance-authority/png`'s foreign-image constructor had a caller of any
 * kind, so the row was scored off a signature.
 *
 * These are two PNGs from a painter this process never ran, compared under a
 * name the operator chose. Nothing here renders, and nothing here needs a
 * browser — which is the whole claim.
 */

function screenshot(paint: (x: number, y: number) => readonly [number, number, number]): Buffer {
  const image = new PNG({ width: 40, height: 24 });
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 40; x += 1) {
      const [r, g, b] = paint(x, y);
      const index = (y * 40 + x) * 4;
      image.data[index] = r;
      image.data[index + 1] = g;
      image.data[index + 2] = b;
      image.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const IOS = { painter: 'ios-simulator-17.4' } as const;
const PLAIN = screenshot(() => [240, 240, 240]);

describe('two images from a painter this process never ran', () => {
  it('reports unchanged when the bytes match', async () => {
    const observation = await observeRasters(
      'ios:checkout',
      foreignRaster(PLAIN, IOS),
      foreignRaster(screenshot(() => [240, 240, 240]), IOS),
    );

    expect(observation.verdict).toBe('unchanged');
  });

  it('reports a change when pixels move, without a document between them', async () => {
    const observation = await observeRasters(
      'ios:checkout',
      foreignRaster(PLAIN, IOS),
      foreignRaster(screenshot((x) => (x < 20 ? [240, 240, 240] : [10, 10, 10])), IOS),
    );

    // `changed` and not `incomparable`: one declared painter, two images, and
    // the only thing that moved is the pixels.
    expect(observation.verdict).toBe('changed');
    const changed = Object.values(observation.comparison?.changed ?? {});
    expect(changed.length).toBeGreaterThan(0);
    expect(Math.max(...changed)).toBeGreaterThan(0);
  });

  it('refuses to compare two painters instead of calling them different', async () => {
    // The property that makes a declaration worth requiring. A run against
    // images from another tool is a wall of red in every product in this
    // category; here it is one word, and `accept` cannot promote it.
    const observation = await observeRasters(
      'ios:checkout',
      foreignRaster(PLAIN, IOS),
      foreignRaster(PLAIN, { painter: 'figma-export' }),
    );

    expect(observation.verdict).toBe('incomparable');
  });

  it('names no component, because an image carries none', async () => {
    // The seam's ceiling, asserted so it cannot quietly grow one: pixels in,
    // pixels out. Provenance, bands and causes need a document.
    const observation = await observeRasters(
      'ios:checkout',
      foreignRaster(PLAIN, IOS),
      foreignRaster(screenshot((x) => (x < 20 ? [240, 240, 240] : [10, 10, 10])), IOS),
    );

    expect(observation.regions ?? []).toEqual([]);
  });
});
