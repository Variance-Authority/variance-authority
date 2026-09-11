import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { identityDigest } from '@variance-authority/core/format';
import { declaredIdentity, foreignDigest, foreignRaster } from './foreign.js';

/**
 * The foreign-image seam, executed.
 *
 * `docs/gates.md` scores *existing raster library input* as **yes** and
 * `packages/observe/README.md` says `observeRasters` covers foreign-image
 * ingestion. Both of those are claims about this module, and every one of the
 * decisions its doc comments defend — dimensions read from the bytes, absent
 * components meaning *unknown*, a declaration that partitions identities — was
 * argued in prose and executed by nothing. A seam an adopter is told to use is
 * a seam that has to have been used once.
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

const FLAT = png(24, 16, () => [200, 200, 200]);
const IOS = { painter: 'ios-simulator-17.4' } as const;

describe('a PNG this system did not paint', () => {
  it('takes its dimensions from the bytes rather than the caller', () => {
    // The one physical fact the bytes actually contain, and the reason it is
    // not an option: a comparison pads to the union box, so a wrong height here
    // shifts every region's coordinates without failing anything.
    const raster = foreignRaster(png(64, 40, () => [0, 0, 0]), IOS);

    expect([raster.width, raster.height]).toEqual([64, 40]);
  });

  it('carries no components, because absent means unknown', () => {
    // An empty array would mean *this renders nothing*, and `--since` and every
    // sensitivity level read an absent list as "this could have changed". The
    // difference is whether a foreign baseline keeps being watched.
    expect(foreignRaster(FLAT, IOS).components).toBeUndefined();
  });

  it('uses the image as its own document digest', () => {
    // Everywhere else this field is the digest of a document a renderer was
    // handed. A foreign PNG has nothing behind it that could have differed
    // while the bytes matched, so the bytes are the artifact.
    expect(foreignRaster(FLAT, IOS).documentDigest).toBe(foreignDigest(FLAT));
  });

  it('gives byte-identical images the same digest and different ones a different digest', () => {
    const same = png(24, 16, () => [200, 200, 200]);
    const moved = png(24, 16, (x) => (x < 12 ? [200, 200, 200] : [0, 0, 0]));

    expect(foreignDigest(same)).toBe(foreignDigest(FLAT));
    expect(foreignDigest(moved)).not.toBe(foreignDigest(FLAT));
  });
});

describe('the declaration is what partitions the store', () => {
  it('puts two named painters in different partitions', () => {
    // Not cosmetic. Every field of `RenderIdentity` is folded into
    // `identityDigest`, and two operators sharing a store must not compare each
    // other's screenshots.
    expect(identityDigest(declaredIdentity(IOS))).not.toBe(
      identityDigest(declaredIdentity({ painter: 'figma-export' })),
    );
  });

  it('separates a 2x capture from a 1x one under the same painter', () => {
    // Recorded rather than derived: dividing pixels by an assumed viewport is
    // how a 2x capture and a 1x capture of a wider page become one identity.
    expect(identityDigest(declaredIdentity({ ...IOS, scale: 2 }))).not.toBe(
      identityDigest(declaredIdentity(IOS)),
    );
    expect(declaredIdentity(IOS).deviceScaleFactor).toBe(1);
  });

  it('claims no fonts, because it has seen no machine', () => {
    // The one thing worse than not knowing whether a font substituted is a
    // record saying it did not.
    expect(declaredIdentity(IOS).fonts).toEqual([]);
    expect(foreignRaster(FLAT, IOS).missingFonts).toEqual([]);
  });
});
