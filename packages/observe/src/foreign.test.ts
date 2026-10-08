import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { foreignRaster } from '@variance-authority/png';
import { observeRasters } from './observe.js';

/**
 * *Existing raster library input* — the gate row, run.
 *
 * [`docs/gates.md`](../../../docs/gates.md) scores this **yes** against Argos on
 * the strength of `observeRasters` and a raster `CaptureArtifact`, and
 * [`docs/compare-visual-review.md`](../../../docs/compare-visual-review.md) sells it as the library
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
    // A declared painter is its renderer, engine and platform at once, so the
    // three fields name one pair of painters, once.
    expect(observation.because).toContain(
      'renderer, engine, platform declared:ios-simulator-17.4 → declared:figma-export',
    );
  });

  it('names a recipe difference between two handed-in images without a command that has nothing to adopt', async () => {
    // No baseline and no candidate here: two images from outside. `accept`
    // promotes a run's candidate over a baseline, so naming it would send the
    // reader to a command with nothing to act on.
    const before = foreignRaster(PLAIN, IOS);
    const after = foreignRaster(PLAIN, IOS);
    const observation = await observeRasters(
      'ios:checkout',
      { ...before, identity: { ...before.identity, rasterization: 'v1:8040e1a2e35d148b301ebd30e5ed66c6' } },
      { ...after, identity: { ...after.identity, rasterization: 'v1:54323cded938fde38b41cdd3865368fe' } },
    );

    expect(observation.verdict).toBe('incomparable');
    expect(observation.because).toContain('the before image and the after image');
    expect(observation.because).toContain('rasterization e5ed66c6 → 865368fe');
    expect(observation.because).not.toContain('accept');
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
