import { describe, expect, it } from "vitest";
import { comparePixels } from "./compare.js";

/**
 * A row repainted by a level is, byte for byte, often the row under it: a
 * header shaded row by row and drawn one shade lighter. These pin that such a
 * band stays where it is, and the change beside it is the whole change.
 */

const WIDTH = 4;

describe("a band repainted in place", () => {
  it("pairs a band repainted by one level in place, beside a real insertion", () => {
    // The shortest edit pairs the header one row up, and the insertion lower
    // down outweighs that on the whole page. Paired in place the header
    // differs only by a level the default policy forgives.
    const before = distinct([0, 1, 2, ...range(200, 210), 1000, 1001, 1002, 1003]);
    const after = distinct([0, 1, 2, ...range(201, 211), 1000, 1001, 5000, 5001, 1002, 1003]);

    const comparison = comparePixels(before, after);

    expect(comparison.alignment).toEqual({
      inserted: [{ from: 15, to: 17 }],
      removed: [],
      shifted: [{ from: 17, to: 19, by: 2 }],
    });
    expect(comparison.changed.default).toBe(2 * WIDTH);
  });

  it("leaves a band that moved with the page where the edit put it", () => {
    // Nothing above the band moves differently from it, so it is no detour.
    const before = distinct([...range(200, 210), 1000, 1001, 1002, 1003]);
    const after = distinct([5000, 5001, ...range(200, 210), 1000, 1001, 1002, 1003]);

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
