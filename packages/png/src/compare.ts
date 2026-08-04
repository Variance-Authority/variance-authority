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

/**
 * One decoded image: raw 8-bit RGBA, row-major, no padding.
 *
 * The shape `pixelmatch` needs and the smallest thing every decoder agrees on.
 */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer | Uint8Array;
}

/**
 * How PNG bytes become pixels, so that *which* decoder is a deployment choice.
 *
 * Measured, because the difference is larger than it looks and not where it was
 * expected (journal 0016). Decoding is **90% of a comparison** — `pixelmatch`
 * itself is 9% — so this interface is where a run's raster cost actually lives.
 * On 1280×800: `pngjs` 22.6 ms, `sharp` 15.0 ms, and `sharp` again at **1.9 ms**
 * when several decode at once, because libvips runs on libuv's threadpool and
 * leaves the event loop free. Two wasm decoders were tried and both were
 * *slower* than the pure-JS one.
 *
 * Async for exactly that reason. A synchronous seam would forbid the threadpool,
 * which is where the order of magnitude is — not in the per-image constant.
 *
 * The default stays `pngjs` and this package keeps requiring nothing native, so
 * `observe` remains installable anywhere JavaScript runs. `sharp` is a native
 * addon that a Worker cannot load, which under ADR-0013 makes it a different
 * package's requirement rather than a conditional import here.
 */
export interface PngDecoder {
  decode(bytes: Buffer): Promise<DecodedImage>;
}

/** The portable default: no native addon, no wasm, works wherever Node does. */
export const pngjsDecoder: PngDecoder = {
  async decode(bytes: Buffer): Promise<DecodedImage> {
    return PNG.sync.read(bytes);
  },
};

/**
 * Compare two stored rasters, decoding both **concurrently**.
 *
 * The concurrency is the point rather than a tidy-up. Under a threadpool decoder
 * the two images decode on different threads and a pair costs about what one
 * image costs; under `pngjs` the second `await` resolves on the microtask queue
 * and it degrades to the sequential behaviour this always had.
 */
export async function compareRasters(
  before: Raster,
  after: Raster,
  options: CompareOptions & { readonly decoder?: PngDecoder } = {},
): Promise<RasterComparison> {
  const decoder = options.decoder ?? pngjsDecoder;
  const [left, right] = await Promise.all([
    decoder.decode(decode(before.bytes)),
    decoder.decode(decode(after.bytes)),
  ]);

  return comparePixels(left, right, options);
}

export function comparePngs(
  before: Buffer,
  after: Buffer,
  options: CompareOptions = {},
): RasterComparison {
  return comparePixels(PNG.sync.read(before), PNG.sync.read(after), options);
}

/**
 * The comparison itself, over pixels somebody else decoded.
 *
 * Split out so that swapping the decoder cannot change a verdict: every path
 * above reaches this same function with the same RGBA, and the only thing a
 * decoder is trusted to do is produce those bytes. `packages/png/src/decoder.test.ts`
 * holds the decoders to exactly that.
 */
export function comparePixels(
  left: DecodedImage,
  right: DecodedImage,
  options: CompareOptions = {},
): RasterComparison {
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
function padTo(image: DecodedImage, width: number, height: number): DecodedImage {
  if (image.width === width && image.height === height) return image;

  // Row-major RGBA copy rather than `PNG.bitblt`, because the input here is
  // whatever decoder the caller chose and only `pngjs` produces a `PNG`. Same
  // result: an opaque white canvas with the image at the top left.
  const data = Buffer.alloc(width * height * 4, 0xff);
  const rowBytes = image.width * 4;
  for (let y = 0; y < image.height; y += 1) {
    Buffer.from(image.data.buffer, image.data.byteOffset + y * rowBytes, rowBytes).copy(
      data,
      y * width * 4,
    );
  }
  return { width, height, data };
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
