import { PNG } from 'pngjs';
import type { ChangeMask } from '@variance-authority/core/attribute';
import { picture, type Raster } from '@variance-authority/core/format';
import {
  DEFAULT_POLICY,
  STRICT_POLICY,
  type CompareOptions,
  type DiffPolicy,
  type RasterComparison,
} from '@variance-authority/raster';
import { differencePixels, type DecodedImage } from './mask.js';

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
 * Declared in [`mask.ts`](./mask.js), which is the half of this package a caller
 * can reach without a codec, and re-exported here because this is where the
 * decoder seam is.
 */
export type { DecodedImage };

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
  // A pixel comparison of a subject with no pixels is a caller mistake, not a
  // verdict: whoever decided these two are comparable had both records in hand
  // and could see that one carries no image.
  const left0 = picture(before, 'before');
  const right0 = picture(after, 'after');
  const [left, right] = await Promise.all([
    decoder.decode(decode(left0.bytes)),
    decoder.decode(decode(right0.bytes)),
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
 * decoder is trusted to do is produce those bytes.
 * `packages/png-sharp/src/decoder.test.ts` holds the decoders to exactly that,
 * one package over: the parity suite lives with the second decoder, because
 * that is the package that adds one.
 */
export function comparePixels(
  left: DecodedImage,
  right: DecodedImage,
  options: CompareOptions = {},
): RasterComparison {
  const width = Math.max(left.width, right.width);
  const height = Math.max(left.height, right.height);
  const dimensionsChanged = left.width !== right.width || left.height !== right.height;

  const policies = options.policies ?? [DEFAULT_POLICY, STRICT_POLICY];
  const isolateWith = options.isolateWith ?? DEFAULT_POLICY;

  const changed: Record<string, number> = {};
  let mask: ChangeMask | undefined;

  for (const policy of policies) {
    // `diffMask` makes pixelmatch write *only* the differing pixels and leave
    // everything else transparent — so the alpha channel is already the mask,
    // and deriving one from a rendered red-on-grey diff image is unnecessary.
    const out = differencePixels(left, right, policy, { diffMask: true });

    changed[policy.id] = out.changed;
    if (policy.id === isolateWith.id) mask = maskOf(out.data, width, height, out.changed);
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

function maskOf(
  pixels: Uint8Array,
  width: number,
  height: number,
  changed: number,
): ChangeMask {
  const data = new Uint8Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    if (pixels[index * 4 + 3] !== 0) data[index] = 1;
  }
  return { width, height, data, changed };
}

export function decode(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/** A visual diff, for the human who wants one after reading the report. */
export function diffImage(
  before: Buffer,
  after: Buffer,
  policy: DiffPolicy = DEFAULT_POLICY,
): Buffer {
  const difference = differencePixels(PNG.sync.read(before), PNG.sync.read(after), policy);

  const out = new PNG({ width: difference.width, height: difference.height });
  out.data.set(difference.data);
  return PNG.sync.write(out);
}
