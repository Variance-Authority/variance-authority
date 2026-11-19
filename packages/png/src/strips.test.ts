import { describe, expect, it } from "vitest";
import { comparePixels } from "./compare.js";
import type { DecodedImage } from "./mask.js";

/**
 * A page laid out in columns moves each column on its own: rows inserted in
 * one leave the one beside it where it was. These pin that only the rows a
 * column gained count, and nothing either column kept.
 */

describe("a column that moved beside a column that stayed", () => {
  it("counts the inserted band, and none of the content either column kept", () => {
    // A still sidebar 20 pixels wide beside a main column 40 wide, into which
    // 48 rows were inserted 60 rows down. The sidebar's background reaches the
    // foot of the taller page, so the page grew by 48 whole rows and nothing else.
    const [before, after] = sidebarPair();

    const comparison = comparePixels(before, after);

    expect(comparison.changed.default).toBe(48 * SIDEBAR_PAGE);
    expect(comparison.alignment?.inserted).toEqual([
      { from: 200, to: 248, columns: { from: 0, to: 20 } },
      { from: 60, to: 108, columns: { from: 20, to: 60 } },
    ]);
  });
});

describe("a column that moved between margins that stayed", () => {
  it("counts a row drawn into the column, and none of the margins beside it", () => {
    // Margins of one colour 16 pixels wide each side of a column 28 wide, which
    // lost three rows 40 rows down and gained one row 50 rows later. The margins
    // read the same at every height, so only the column has a row to show.
    const width = 60;
    const margin = 16;
    const draw = (rows: readonly number[]): DecodedImage => {
      const data = new Uint8Array(width * rows.length * 4);
      for (const [y, value] of rows.entries()) {
        for (let x = 0; x < width; x += 1) {
          const inside = x >= margin && x < width - margin;
          data.set(
            !inside
              ? [240, 240, 240, 255]
              : value < 0
                ? [200, 0, 0, 255]
                : [(value * 7) % 256, (value * 13) % 256, 100, 255],
            (y * width + x) * 4,
          );
        }
      }
      return { width, height: rows.length, data };
    };
    const before = draw(range(0, 120));
    const after = draw([
      ...range(0, 40),
      ...range(43, 90),
      -1,
      ...range(90, 120),
    ]);

    const comparison = comparePixels(before, after);

    expect(comparison.changed.default).toBe(width - 2 * margin);
  });
});

/** The page width of {@link sidebarPair}. */
const SIDEBAR_PAGE = 60;

function sidebarPair(): [DecodedImage, DecodedImage] {
  const side = 20;
  const height = 200;
  const sidebar = (y: number) => [(y * 11) % 256, 50, (y * 5) % 256];
  const main = (y: number) => [(y * 7) % 256, (y * 13) % 256, 100];
  const inserted = (y: number) => [200, (y * 3) % 256, 0];
  const draw = (
    rows: number,
    paint: (x: number, y: number) => number[],
  ): DecodedImage => {
    const data = new Uint8Array(SIDEBAR_PAGE * rows * 4);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < SIDEBAR_PAGE; x += 1)
        data.set([...paint(x, y), 255], (y * SIDEBAR_PAGE + x) * 4);
    }
    return { width: SIDEBAR_PAGE, height: rows, data };
  };
  const before = draw(height, (x, y) => (x < side ? sidebar(y) : main(y)));
  const after = draw(height + 48, (x, y) =>
    x < side
      ? sidebar(Math.min(y, height - 1))
      : y < 60
        ? main(y)
        : y < 108
          ? inserted(y)
          : main(y - 48),
  );
  return [before, after];
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index);
}
