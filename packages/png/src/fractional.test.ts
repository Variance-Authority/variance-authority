import { describe, expect, it } from "vitest";
import { comparePixels } from "./compare.js";
import { ALIGNMENT_LIMIT, alignRows } from "./align.js";

/**
 * Content pushed down by a height that is not whole rows: a browser snaps text
 * to a whole row and draws a rule across the two rows it half covers. These pin
 * that such a move is reported as the one move it is.
 */

const LINE = 8;

describe("content pushed down by a fractional height", () => {
  it("reads content pushed down by a fractional height as one move", () => {
    // A banner 23.5 rows tall went in at the top. A browser snaps each line of
    // text to a whole row, so lines move by 23 or by 24 by where they sat, and
    // draws each rule across the two rows its half-row position straddles, so no
    // rule row matches any row it had. Paired on exact rows alone, every line
    // is a shift of its own and every rule a row inserted and one removed.
    const before = page(0);
    const after = page(23.5);

    const comparison = comparePixels(before, after);

    // The page grew by 24 rows for content that moved by 23.5, so one white row
    // at the foot is new: the last rule, drawn across two rows before, is one row now.
    expect(comparison.alignment?.shifted).toEqual([
      { from: 24, to: 123, by: 24 },
    ]);
    expect(comparison.alignment?.inserted).toEqual([
      { from: 0, to: 24 },
      { from: 123, to: 124 },
    ]);
    expect(comparison.alignment?.removed).toEqual([]);
  });

  it("keeps a fractional move whole under a lenient policy", () => {
    // Its lines move by 23 and by 24 in turn, and a lenient policy forgives a
    // line read one row off: the move reported is still the one move.
    const alignment = alignRows(page(0), page(23.5), ALIGNMENT_LIMIT, 0.5);

    expect(alignment?.shifted).toEqual([{ from: 24, to: 123, by: 24 }]);
  });

  it("keeps a fractional move whole beside a band repainted in place above it", () => {
    // A header shaded row by row, one level lighter, above a page pushed down 23.5 rows.
    const header = (from: number) => [17, ...range(from, from + 10), 23];
    const alignment = comparePixels(greysAbove(header(100), page(0)), greysAbove(header(101), page(23.5))).alignment;

    expect(alignment).toMatchObject({ shifted: [{ from: 36, to: 135, by: 24 }], removed: [] });
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index);
}

/**
 * A page of ten blocks, each three lines of text over a rule, below a banner
 * `banner` rows tall. Text is placed at its position rounded to a whole row;
 * the banner and the rules are drawn by how much of each row they cover.
 */
function page(banner: number): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const height = 100 + Math.ceil(banner);
  const data = new Uint8Array(LINE * height * 4).fill(255);
  const cover = (y: number, top: number, bottom: number) =>
    Math.max(0, Math.min(y + 1, bottom) - Math.max(y, top));
  const shade = (y: number, ink: number, amount: number) => {
    for (let x = 0; x < LINE; x += 1) {
      const at = (y * LINE + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[at + channel] = Math.round(
          data[at + channel]! + (ink - data[at + channel]!) * amount,
        );
      }
    }
  };
  for (let y = 0; y < height; y += 1) shade(y, 0xc0, cover(y, 0, banner));
  for (let block = 0; block < 10; block += 1) {
    const top = banner + 4 + block * 9.5;
    for (let y = 0; y < height; y += 1)
      shade(y, 0x40, cover(y, top + 6, top + 7));
    for (let line = 0; line < 3; line += 1) {
      const y = Math.round(top) + line;
      for (let x = 0; x < LINE; x += 1) {
        if (
          Math.imul((x + 1) * 31 + line * 7 + block * 131, 0x9e3779b1) >>> 29 <
          3
        )
          data.set([0x22, 0x22, 0x22, 255], (y * LINE + x) * 4);
      }
    }
  }
  return { width: LINE, height, data };
}

/** `image` with rows of one grey each, `greys` top to bottom, drawn above it. */
function greysAbove(greys: readonly number[], image: { width: number; height: number; data: Uint8Array }) {
  const data = new Uint8Array(image.width * (greys.length + image.height) * 4);
  for (const [y, grey] of greys.entries()) data.fill(grey, y * image.width * 4, (y + 1) * image.width * 4);
  for (let at = 3; at < greys.length * image.width * 4; at += 4) data[at] = 255;
  data.set(image.data, image.width * greys.length * 4);
  return { width: image.width, height: greys.length + image.height, data };
}
