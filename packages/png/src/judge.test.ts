import pixelmatch from "pixelmatch";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  STRICT_POLICY,
  type DiffPolicy,
} from "@variance-authority/raster";
import { judgeRows, type SourceStrip } from "./judge.js";
import type { DecodedImage } from "./mask.js";

/**
 * `judgeRows` against `pixelmatch` itself.
 *
 * The oracle is what this package did before the kernel: copy the before rows
 * into the after image's order, then run `pixelmatch` once per policy. The two
 * must agree on every count, every mask pixel and every byte of the picture,
 * over images built to reach each branch: noise, translucency, bytes that
 * differ only under zero alpha, and anti-aliased edges, aligned and not.
 * Where the alignment sets two before rows side by side that were not, the
 * kernel reads anti-aliasing around the row each came from and the copy cannot:
 * there the oracle is the two images unaligned.
 */

const LOOSE: DiffPolicy = { id: "loose", threshold: 0.1, includeAA: false };
const POLICIES = [DEFAULT_POLICY, STRICT_POLICY, LOOSE];

describe("one scan agrees with pixelmatch", () => {
  for (const [name, before, after, source] of cases()) {
    it(name, () => {
      const copied = warp(before, after, source);
      const masks = POLICIES.map((policy) =>
        oracle(copied, after, policy, true),
      );

      const judged = judgeRows(before, after, whole(after, source), POLICIES, {
        mask: 0,
      });
      expect(judged.changed).toEqual(masks.map((mask) => mask.changed));
      // Pixelmatch marks a pixel; the judge grades it, so they agree where it is non-zero.
      expect(judged.mask!.map((grade) => Math.min(grade, 1))).toEqual(alphaOf(masks[0]!.data));

      for (const diffMask of [true, false]) {
        for (const [index, policy] of POLICIES.entries()) {
          const picture = judgeRows(
            before,
            after,
            whole(after, source),
            POLICIES,
            { picture: { policy: index, diffMask } },
          ).picture;
          expect(picture).toEqual(oracle(copied, after, policy, diffMask).data);
        }
      }
    });
  }
});

describe("a byte view that cannot hold words", () => {
  it("is copied, and judged the same", () => {
    const [, before, after] = cases()[0]!;
    const offset = new Uint8Array(after.data.length + 1);
    offset.set(after.data, 1);
    const shifted = { ...after, data: offset.subarray(1) };

    expect(judgeRows(before, shifted, undefined, POLICIES).changed).toEqual(
      judgeRows(before, after, undefined, POLICIES).changed,
    );
  });
});

describe("a row on a seam", () => {
  it("is judged for anti-aliasing against its own before neighbours, not the rows the alignment set beside it", () => {
    // Rows 5 to 8 are drawn twice, so above the seam the verdict is the one
    // the two images give unaligned; flat greys make anti-aliasing decide.
    const random = seeded(SEAM_SEED);
    const width = 12;
    const height = 12;
    const levels = [0, 60, 128, 200, 255];
    const level = () => levels[Math.floor(random() * levels.length)]!;
    const grey = Array.from({ length: width * height }, level);
    const page = image(width, height, (x, y) => flat(grey[y * width + x]!));
    const moved = image(width, height, (x, y) =>
      flat(random() < 0.3 ? level() : grey[y * width + x]!),
    );
    const row = width * 4;
    const after: DecodedImage = {
      width,
      height: height + 4,
      data: Uint8Array.from([
        ...moved.data.subarray(0, 9 * row),
        ...moved.data.subarray(5 * row),
      ]),
    };
    const source = Array.from({ length: height + 4 }, (_, y) =>
      y < 5 ? y : y < 9 ? -1 : y - 4,
    );

    const above = 5 * width;
    const unaligned = judgeRows(page, moved, undefined, [DEFAULT_POLICY], {
      mask: 0,
    }).mask!.subarray(0, above);
    const seamed = judgeRows(
      page,
      after,
      whole(after, source),
      [DEFAULT_POLICY],
      { mask: 0 },
    ).mask!.subarray(0, above);
    expect(seamed).toEqual(unaligned);
  });
});

describe("a row near the canvas edge", () => {
  it("is judged for anti-aliasing against the before rows its source row has, wherever the canvas ends", () => {
    // The top three rows are removed, so the after image's first row comes from
    // the before image's fourth, whose rows above are black. Kept above the
    // after image unchanged, they give the verdict the two images give unaligned.
    const width = 5;
    const grey = (value: number) => image(width, 1, () => flat(value)).data;
    const before = stack(width, [
      grey(0),
      grey(0),
      grey(0),
      grey(128),
      grey(255),
      grey(255),
    ]);
    const after = stack(width, [grey(0), grey(255), grey(255)]);
    const kept = stack(width, [
      grey(0),
      grey(0),
      grey(0),
      grey(0),
      grey(255),
      grey(255),
    ]);

    const aligned = judgeRows(
      before,
      after,
      whole(after, [3, 4, 5]),
      [DEFAULT_POLICY],
      { mask: 0 },
    ).mask!;
    const unaligned = judgeRows(before, kept, undefined, [DEFAULT_POLICY], {
      mask: 0,
    }).mask!;
    expect(aligned.subarray(0, width)).toEqual(
      unaligned.subarray(3 * width, 4 * width),
    );
  });
});

describe("a pixel whose neighbour has no row in the other image", () => {
  it("is not forgiven as anti-aliasing on that neighbour", () => {
    // The after image's first row comes from the before image's fourth. Its
    // darker neighbour in the before image is a row above it, which the after
    // image has none of, so that neighbour cannot show the pixel is an edge
    // both images draw; the brighter one below has no siblings in the after image.
    const width = 5;
    const grey = (value: number) => image(width, 1, () => flat(value)).data;
    const before = stack(width, [
      grey(0),
      grey(0),
      grey(0),
      grey(128),
      grey(255),
      grey(255),
    ]);
    const after = stack(width, [grey(0), grey(255), grey(200)]);

    const { changed, mask } = judgeRows(
      before,
      after,
      whole(after, [3, 4, 5]),
      [DEFAULT_POLICY],
      { mask: 0 },
    );

    expect([...mask!.subarray(0, width)].every((grade) => grade > 0)).toBe(true);
    // The third row differs too, as 200 against 255.
    expect(changed).toEqual([2 * width]);
  });
});

function stack(width: number, rows: readonly Uint8Array[]): DecodedImage {
  const data = new Uint8Array(rows.length * width * 4);
  rows.forEach((row, y) => data.set(row, y * width * 4));
  return { width, height: rows.length, data };
}

/** One strip across the whole width, or none when the rows are unaligned. */
function whole(
  image: DecodedImage,
  source: readonly number[] | undefined,
): SourceStrip[] | undefined {
  return source && [{ from: 0, to: image.width, source }];
}

/** A seed whose page puts a pixel on the seam that its neighbours decide. */
const SEAM_SEED = 16;

function flat(value: number): Pixel {
  return [value, value, value, 255];
}

type Case = readonly [
  string,
  DecodedImage,
  DecodedImage,
  readonly number[] | undefined,
];

function cases(): Case[] {
  const random = seeded(7);
  const width = 23;
  const height = 17;

  const noise = image(width, height, () => [
    random() * 256,
    random() * 256,
    random() * 256,
    255,
  ]);
  const nudged = image(width, height, (x, y) => {
    const [r, g, b] = pixel(noise, x, y);
    return random() < 0.3
      ? [r + random() * 20 - 10, g, b + random() * 6 - 3, 255]
      : [r, g, b, 255];
  });

  const glass = image(width, height, () => [
    random() * 256,
    random() * 256,
    random() * 256,
    random() * 256,
  ]);
  const fogged = image(width, height, (x, y) => {
    const [r, g, b, a] = pixel(glass, x, y);
    return random() < 0.4 ? [r, g, b, a + random() * 40 - 20] : [r, g, b, a];
  });

  // Bytes that differ where nothing shows: a strict policy must not count them.
  const clear = image(width, height, () => [
    random() * 256,
    random() * 256,
    random() * 256,
    0,
  ]);
  const cleared = image(width, height, () => [
    random() * 256,
    random() * 256,
    random() * 256,
    0,
  ]);

  // A diagonal edge, softened, against one moved by a pixel: the detector's case.
  const edge = (shift: number) =>
    image(width, height, (x, y) => {
      const distance = x - y * 0.7 - 5 - shift;
      const ink = distance < -1 ? 0 : distance > 1 ? 255 : 128 + distance * 100;
      return [ink, ink, ink, 255];
    });
  const text = image(width, height, (x, y) => {
    const on = (x + y) % 7 < 2 || (x * 3 + y) % 11 === 0;
    return on ? [40, 40, 40, 255] : [250, 250, 250, 255];
  });
  const retext = image(width, height, (x, y) => {
    const [r, g, b] = pixel(text, x, y);
    return x % 5 === 2 && y % 3 === 1 ? [140, 140, 150, 255] : [r, g, b, 255];
  });

  // Rows reordered, one row with no partner: the aligned path.
  const moved = Array.from({ length: height }, (_, y) =>
    y === 4 ? -1 : y < 4 ? y : y - 1,
  );
  const taller = image(
    width,
    height + 5,
    (x, y) => pixel(nudged, x, y % height) as Pixel,
  );

  return [
    ["noise", noise, nudged, undefined],
    ["translucent noise", glass, fogged, undefined],
    ["bytes under zero alpha", clear, cleared, undefined],
    ["an anti-aliased edge moved by a pixel", edge(0), edge(1), undefined],
    ["text re-rendered", text, retext, undefined],
    ["identical", text, text, undefined],
    ["rows inserted", noise, nudged, moved],
    [
      "a taller before image",
      taller,
      nudged,
      moved.map((from) => (from < 0 ? -1 : from + 3)),
    ],
  ];
}

/** The copy this package made before the kernel, row by row. */
function warp(
  before: DecodedImage,
  after: DecodedImage,
  source: readonly number[] | undefined,
): Uint8Array {
  if (source === undefined) return new Uint8Array(before.data);
  const row = after.width * 4;
  const copy = new Uint8Array(after.height * row);
  for (let y = 0; y < after.height; y += 1) {
    const from = source[y]!;
    const data = from < 0 ? after.data : before.data;
    const at = from < 0 ? y : from;
    copy.set(data.subarray(at * row, (at + 1) * row), y * row);
  }
  return copy;
}

function oracle(
  copied: Uint8Array,
  after: DecodedImage,
  policy: DiffPolicy,
  diffMask: boolean,
) {
  const data = new Uint8Array(copied.length);
  const changed = pixelmatch(
    copied,
    after.data,
    data,
    after.width,
    after.height,
    {
      threshold: policy.threshold,
      includeAA: policy.includeAA,
      diffMask,
    },
  );
  return { changed, data };
}

function alphaOf(picture: Uint8Array): Uint8Array {
  const mask = new Uint8Array(picture.length / 4);
  for (let index = 0; index < mask.length; index += 1)
    mask[index] = picture[index * 4 + 3] === 0 ? 0 : 1;
  return mask;
}

type Pixel = readonly [number, number, number, number];

function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => Pixel,
): DecodedImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      paint(x, y).forEach((value, channel) => {
        data[at + channel] = Math.max(0, Math.min(255, Math.round(value)));
      });
    }
  }
  return { width, height, data };
}

function pixel(image: DecodedImage, x: number, y: number): Pixel {
  const at = (y * image.width + x) * 4;
  return [
    image.data[at]!,
    image.data[at + 1]!,
    image.data[at + 2]!,
    image.data[at + 3]!,
  ];
}

/** A small deterministic generator, so a failure reproduces. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x80000000;
  };
}
