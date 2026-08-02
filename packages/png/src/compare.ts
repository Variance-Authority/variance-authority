import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { ChangeMask, Raster } from '@variance-authority/core';
import {
  DEFAULT_POLICY,
  STRICT_POLICY,
  type CompareOptions,
  type DiffPolicy,
  type RasterComparison,
} from '@variance-authority/raster';

/**
 * Comparison — phase three: two images become a mask.
 *
 * A mask, not a number and not a picture. The number is what makes a pixel differ
 * unactionable ("5482 pixels changed" cannot be assigned to anyone) and the
 * picture is what makes it expensive (someone has to look). Both are derivable
 * from a mask; neither can produce one. So this phase stops at the last artifact
 * that still has *positions* in it, and the phases that turn positions into
 * places and places into files come after.
 *
 * `pixelmatch` does the per-pixel work at its own defaults. It is the differ
 * behind most of the ecosystem — Playwright's `toHaveScreenshot`,
 * jest-image-snapshot — and using it at settings chosen to flatter this project
 * would make every comparison against a pixel tool worthless.
 */

export function compareRasters(
  before: Raster,
  after: Raster,
  options: CompareOptions = {},
): RasterComparison {
  return comparePngs(decode(before.bytes), decode(after.bytes), options);
}

export function comparePngs(
  before: Buffer,
  after: Buffer,
  options: CompareOptions = {},
): RasterComparison {
  const left = PNG.sync.read(before);
  const right = PNG.sync.read(after);

  const width = Math.max(left.width, right.width);
  const height = Math.max(left.height, right.height);
  const dimensionsChanged = left.width !== right.width || left.height !== right.height;

  const a = padTo(left, width, height);
  const b = padTo(right, width, height);

  const policies = options.policies ?? [DEFAULT_POLICY, STRICT_POLICY];
  const isolateWith = options.isolateWith ?? DEFAULT_POLICY;

  const changed: Record<string, number> = {};
  let mask: ChangeMask | undefined;

  for (const policy of policies) {
    // `diffMask` makes pixelmatch write *only* the differing pixels and leave
    // everything else transparent — so the alpha channel is already the mask,
    // and deriving one from a rendered red-on-grey diff image is unnecessary.
    const out = new PNG({ width, height });
    const count = pixelmatch(a.data, b.data, out.data, width, height, {
      threshold: policy.threshold,
      includeAA: policy.includeAA,
      diffMask: true,
    });

    changed[policy.id] = count;
    if (policy.id === isolateWith.id) mask = maskOf(out, width, height, count);
  }

  if (mask === undefined) {
    throw new Error(
      `isolation policy "${isolateWith.id}" was not among the compared policies ` +
        `(${policies.map((p) => p.id).join(', ')}); the mask would describe a different ` +
        'comparison from the counts beside it',
    );
  }

  return {
    width,
    height,
    dimensionsChanged,
    before: { width: left.width, height: left.height },
    after: { width: right.width, height: right.height },
    changed,
    total: width * height,
    mask,
  };
}

function maskOf(png: PNG, width: number, height: number, changed: number): ChangeMask {
  const data = new Uint8Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    if (png.data[index * 4 + 3] !== 0) data[index] = 1;
  }
  return { width, height, data, changed };
}

export function decode(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/**
 * Copy `png` onto an opaque white canvas, top-left aligned.
 *
 * `pixelmatch` requires equal dimensions and Playwright's own `toHaveScreenshot`
 * simply fails when they differ. Failing is the easy choice and the dishonest
 * one — it lets a layout change score "detected" without measuring anything. So
 * both are padded onto the union box and the padding is reported, which is the
 * more generous treatment: a story that grew by one row differs in that row
 * rather than in its entire area.
 *
 * White because a page's declared canvas is white. Transparent padding would
 * invent a difference wherever the shorter image's own background is opaque,
 * which is every subject.
 */
function padTo(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;

  const padded = new PNG({ width, height });
  padded.data.fill(0xff);
  PNG.bitblt(png, padded, 0, 0, png.width, png.height, 0, 0);
  return padded;
}

/** A visual diff, for the human who wants one after reading the report. */
export function diffImage(
  before: Buffer,
  after: Buffer,
  policy: DiffPolicy = DEFAULT_POLICY,
): Buffer {
  const left = PNG.sync.read(before);
  const right = PNG.sync.read(after);
  const width = Math.max(left.width, right.width);
  const height = Math.max(left.height, right.height);

  const out = new PNG({ width, height });
  pixelmatch(
    padTo(left, width, height).data,
    padTo(right, width, height).data,
    out.data,
    width,
    height,
    { threshold: policy.threshold, includeAA: policy.includeAA },
  );
  return PNG.sync.write(out);
}
