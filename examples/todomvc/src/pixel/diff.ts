import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * The pixel arm's comparison stage: two PNGs in, a count of differing pixels out.
 *
 * This is deliberately the *strongest honest* implementation of what a visual
 * regression tool does, because a straw man here would make the whole head-to-head
 * worthless. `pixelmatch` is the differ behind most of the ecosystem (Playwright's
 * own `toHaveScreenshot`, jest-image-snapshot, and others), and it is used at its
 * own defaults rather than at settings chosen to flatter either arm.
 *
 * Two policies are computed for every pair and both are reported, because the
 * single most common way to lie with a pixel measurement is to quote one
 * threshold. See {@link DEFAULT_POLICY} and {@link STRICT_POLICY}.
 */

export interface DiffPolicy {
  readonly id: string;
  /**
   * Per-pixel colour-distance tolerance, 0–1, in `pixelmatch`'s YIQ metric.
   * Higher admits more difference before a pixel is called changed.
   */
  readonly threshold: number;
  /**
   * `true` counts antialiased pixels as differences. `pixelmatch` defaults to
   * `false`, i.e. it detects and *forgives* antialiasing, which is the setting a
   * real VR deployment runs because text edges are otherwise permanently red.
   */
  readonly includeAA: boolean;
}

/**
 * `pixelmatch`'s own defaults, which is what a VR tool ships with.
 *
 * This is the number quoted as "what a pixel differ would report". Anything
 * stricter would be a configuration nobody survives in practice; anything looser
 * would be us choosing the pixel arm's sensitivity for it.
 */
export const DEFAULT_POLICY: DiffPolicy = { id: 'default', threshold: 0.1, includeAA: false };

/**
 * Exact comparison: any channel difference at all, antialiasing included.
 *
 * Reported alongside the default so that "zero differing pixels" can be
 * distinguished from "zero differing pixels *after* forgiveness". For the
 * `visible: false` mutations that distinction is the entire question, and a
 * measurement that only quoted the forgiving policy would be assuming its answer.
 */
export const STRICT_POLICY: DiffPolicy = { id: 'strict', threshold: 0, includeAA: true };

export const POLICIES: readonly DiffPolicy[] = [DEFAULT_POLICY, STRICT_POLICY];

export interface PixelComparison {
  /** Dimensions of the canvas the two images were compared on. */
  readonly width: number;
  readonly height: number;
  /** True when the two shots were not the same size. See {@link comparePngs}. */
  readonly dimensionsChanged: boolean;
  readonly baseline: { readonly width: number; readonly height: number; readonly bytes: number };
  readonly after: { readonly width: number; readonly height: number; readonly bytes: number };
  /** Differing pixel count per policy id. */
  readonly changed: Readonly<Record<string, number>>;
  /** `width * height`, so a count can be read as a fraction. */
  readonly total: number;
}

/**
 * Compare two screenshots.
 *
 * **Size mismatch.** `pixelmatch` requires equal dimensions, and Playwright's own
 * `toHaveScreenshot` simply fails the comparison when they differ. Failing would
 * be the easy choice and it would also be the dishonest one — it would let the
 * pixel arm score a "change detected" on every layout mutation without measuring
 * anything. Instead both images are padded onto the union box with **white**, the
 * page's declared canvas colour, and the diff runs on that. The padding is
 * reported as `dimensionsChanged` so a reader can see which comparisons involved
 * it, and it is the more generous treatment: a story that grew by one row differs
 * in that row rather than in its entire area.
 */
export function comparePngs(baselineBytes: Buffer, afterBytes: Buffer): PixelComparison {
  const baseline = PNG.sync.read(baselineBytes);
  const after = PNG.sync.read(afterBytes);

  const width = Math.max(baseline.width, after.width);
  const height = Math.max(baseline.height, after.height);
  const dimensionsChanged = baseline.width !== after.width || baseline.height !== after.height;

  const left = padTo(baseline, width, height);
  const right = padTo(after, width, height);

  const changed: Record<string, number> = {};
  for (const policy of POLICIES) {
    // No output buffer: the diff image is not rendered here. Producing one per
    // policy per pair would be ~2000 PNGs per run and none of them is read by
    // the measurement — the runner writes diffs only for the pairs it is asked to.
    changed[policy.id] = pixelmatch(left.data, right.data, undefined, width, height, {
      threshold: policy.threshold,
      includeAA: policy.includeAA,
    });
  }

  return {
    width,
    height,
    dimensionsChanged,
    baseline: { width: baseline.width, height: baseline.height, bytes: baselineBytes.length },
    after: { width: after.width, height: after.height, bytes: afterBytes.length },
    changed,
    total: width * height,
  };
}

/** Render a visual diff for a pair, for the runner's `--write` mode. */
export function diffImage(
  baselineBytes: Buffer,
  afterBytes: Buffer,
  policy: DiffPolicy = DEFAULT_POLICY,
): Buffer {
  const baseline = PNG.sync.read(baselineBytes);
  const after = PNG.sync.read(afterBytes);
  const width = Math.max(baseline.width, after.width);
  const height = Math.max(baseline.height, after.height);

  const out = new PNG({ width, height });
  pixelmatch(padTo(baseline, width, height).data, padTo(after, width, height).data, out.data, width, height, {
    threshold: policy.threshold,
    includeAA: policy.includeAA,
  });
  return PNG.sync.write(out);
}

/**
 * Copy `png` onto an opaque white canvas of the given size, top-left aligned.
 *
 * White and not transparent: the harness page declares `color-scheme: light` and
 * the tokens declare `--va-color-bg: #ffffff`, so white is the colour the browser
 * would actually have painted in the region the smaller shot did not cover.
 * Padding with transparency would invent a difference wherever a story's own
 * background is opaque, which is every story.
 */
function padTo(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;

  const padded = new PNG({ width, height });
  padded.data.fill(0xff);
  PNG.bitblt(png, padded, 0, 0, png.width, png.height, 0, 0);
  return padded;
}
