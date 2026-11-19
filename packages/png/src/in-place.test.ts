import { DEFAULT_POLICY, STRICT_POLICY } from "@variance-authority/raster";
import { describe, expect, it } from "vitest";
import { ALIGNMENT_LIMIT, alignRows } from "./align.js";
import { comparePixels } from "./compare.js";
import { pairWords, wordsOf } from "./rows.js";

/**
 * A row repainted by a level is, byte for byte, often the row under it: a
 * header shaded row by row and drawn one shade lighter. These pin that such a
 * band stays where it is, and the change beside it is the whole change.
 */

const WIDTH = 4;
// Content rows far apart in colour, so none reads as a repaint of another.
const [A, B, C, D, E, F, G, P, Q, X, Y] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => k * 0x1000);

describe("a band repainted in place", () => {
  it("pairs a band repainted by one level in place, beside a real insertion", () => {
    // The shortest edit pairs the header one row up, and the insertion lower
    // down outweighs that on the whole page. Paired in place the header
    // differs only by a level the default policy forgives.
    const before = distinct([A, B, C, ...range(200, 210), D, E, F, G]);
    const after = distinct([A, B, C, ...range(201, 211), D, E, X, Y, F, G]);

    const comparison = comparePixels(before, after);

    expect(comparison.alignment).toEqual({
      inserted: [{ from: 15, to: 17 }],
      removed: [],
      shifted: [{ from: 17, to: 19, by: 2 }],
    });
    expect(comparison.changed.default).toBe(2 * WIDTH);
    // What the pairing leaves differing is read anew for the rows paired in place.
    const paired = pairWords(wordsOf(before), wordsOf(after), before.height, after.height, WIDTH, 2000, 0.01).paired;
    expect(paired).toBe(12 * WIDTH);
  });

  it("keeps the detour when no compared policy forgives the repaint", () => {
    // Under the strict policy alone a level is a change, so the band's exact
    // copies one row off leave less differing than the band in place.
    const before = distinct([A, B, C, ...range(200, 210), D, E, F, G]);
    const after = distinct([A, B, C, ...range(201, 211), D, E, X, Y, F, G]);

    const comparison = comparePixels(before, after, { policies: [STRICT_POLICY], isolateWith: STRICT_POLICY });

    expect(comparison.alignment?.shifted).toContainEqual({ from: 3, to: 12, by: -1 });
  });

  it("pairs the band at the move of the page around it, below an earlier insertion", () => {
    const before = distinct([A, B, C, ...range(200, 210), D, E, F, G]);
    const after = distinct([A, P, Q, B, C, ...range(201, 211), D, E, X, Y, F, G]);

    expect(comparePixels(before, after).alignment).toEqual({
      inserted: [
        { from: 1, to: 3 },
        { from: 17, to: 19 },
      ],
      removed: [],
      shifted: [
        { from: 3, to: 17, by: 2 },
        { from: 19, to: 21, by: 4 },
      ],
    });
  });

  it("drops the runs the detour grew and shrank inside the band", () => {
    // Read one row off, the band's run of two 202s shrinks and its 203s grow.
    const before = distinct([A, B, C, 200, 201, 202, 202, 203, 204, 205, 206, 207, 208, D, E, F, G]);
    const after = distinct([A, B, C, 201, 202, 203, 203, 204, 205, 206, 207, 208, 209, D, E, X, Y, F, G]);

    expect(comparePixels(before, after).alignment).toEqual({
      inserted: [{ from: 15, to: 17 }],
      removed: [],
      shifted: [{ from: 17, to: 19, by: 2 }],
    });
    const [strip] = alignRows(before, after, ALIGNMENT_LIMIT, DEFAULT_POLICY.threshold)!.strips;
    expect([strip!.grown, strip!.shrunk]).toEqual([[], []]);
  });

  it("keeps content moved between an insertion and a removal", () => {
    // Paired in place every row of it would differ, more than the detour leaves.
    const before = distinct([A, B, C, D, E, F, G]);
    const after = distinct([A, X, B, C, D, F, G]);

    expect(comparePixels(before, after).alignment?.shifted).toEqual([{ from: 2, to: 5, by: 1 }]);
  });

  it("leaves a band that moved with the page where the edit put it", () => {
    // Nothing above the band moves differently from it, so it is no detour.
    const before = distinct([...range(200, 210), D, E, F, G]);
    const after = distinct([X, Y, ...range(200, 210), D, E, F, G]);

    expect(comparePixels(before, after).alignment).toEqual({
      inserted: [{ from: 0, to: 2 }],
      removed: [],
      shifted: [{ from: 2, to: 16, by: 2 }],
    });
  });
});

/** One image whose rows each hold one colour, `value` spread over two channels. */
function distinct(rows: readonly number[]): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(WIDTH * rows.length * 4);
  for (const [y, value] of rows.entries()) {
    for (let x = 0; x < WIDTH; x += 1) data.set([value & 0xff, value >>> 8, 0x80, 255], (y * WIDTH + x) * 4);
  }
  return { width: WIDTH, height: rows.length, data };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index);
}
