import { describe, expect, it } from 'vitest';
import { isolateRegions, subtractRegions, type ChangeMask } from './mask.js';

/**
 * A change as a bitmask, tested on hand-drawn masks.
 *
 * Arithmetic, and testable as arithmetic: no browser, no PNG, no render, and no
 * snapshot. That is the whole reason this half is a file of its own — the
 * question "does 5482 pixels become a place" is answerable in milliseconds and
 * does not depend on the thing that produced the pixels. `region.test.ts` covers
 * the other half, which joins those places to a tree and fails differently.
 */

function mask(rows: readonly string[]): ChangeMask {
  const width = rows[0]!.length;
  const height = rows.length;
  const data = new Uint8Array(width * height);
  let changed = 0;

  for (const [y, row] of rows.entries()) {
    for (let x = 0; x < width; x += 1) {
      if (row[x] === '#') {
        data[y * width + x] = 1;
        changed += 1;
      }
    }
  }

  return { width, height, data, changed };
}

describe('isolating a change', () => {
  it('finds nothing in an empty mask', () => {
    const isolation = isolateRegions(mask(['....', '....']), { cell: 1 });
    expect(isolation.regions).toHaveLength(0);
  });

  it('reports one region per separated cluster', () => {
    const isolation = isolateRegions(
      mask([
        '##....##',
        '##....##',
        '........',
        '........',
      ]),
      { cell: 1 },
    );

    expect(isolation.regions).toHaveLength(2);
    expect(isolation.regions.map((r) => r.pixels)).toEqual([4, 4]);
  });

  it('tightens the box onto the changed pixels, not the grid it clustered on', () => {
    // The clustering is coarse; the coordinates are not. A region reported at
    // grid resolution would land attribution on whatever the padding overlapped.
    const isolation = isolateRegions(
      mask([
        '........',
        '..##....',
        '..##....',
        '........',
      ]),
      { cell: 4 },
    );

    expect(isolation.regions).toEqual([
      { x: 2, y: 1, width: 2, height: 2, pixels: 4, density: 1 },
    ]);
  });

  it('groups neighbouring changes into one place at the default grid', () => {
    // Antialiased text produces a fragment per glyph edge. At cell 1 this is
    // four regions; at the default it is the word someone would point at.
    const fragments = mask(['#.#.#.#.', '#.#.#.#.']);

    expect(isolateRegions(fragments, { cell: 1 }).regions).toHaveLength(4);
    expect(isolateRegions(fragments).regions).toHaveLength(1);
  });

  it('says what it dropped when it caps the list', () => {
    const scattered = mask([
      '#.#.#.#.',
      '........',
      '#.#.#.#.',
    ]);

    const isolation = isolateRegions(scattered, { cell: 1, limit: 3 });

    expect(isolation.regions).toHaveLength(3);
    expect(isolation.truncated).toBe(5);
    expect(isolation.truncatedPixels).toBe(5);
  });

  it('survives a mask that changed everywhere', () => {
    // One component covering every cell. A recursive flood fill overflows here.
    const rows = Array.from({ length: 200 }, () => '#'.repeat(200));
    const isolation = isolateRegions(mask(rows), { cell: 1 });

    expect(isolation.regions).toHaveLength(1);
    expect(isolation.regions[0]!.pixels).toBe(40_000);
  });
});

describe('subtracting an excluded box', () => {
  it('clears the pixels inside it and counts them', () => {
    const before = mask([
      '##..##',
      '##..##',
      '......',
    ]);

    const { mask: after, ignored } = subtractRegions(before, [
      { x: 0, y: 0, width: 2, height: 2 },
    ]);

    expect(ignored).toBe(4);
    expect(after.changed).toBe(4);
    // The input is untouched: a comparison that mutated its own mask could not
    // report both numbers, and both numbers are the point.
    expect(before.changed).toBe(8);
  });

  it('lets the part outside the box cluster on its own', () => {
    // The reason this subtracts pixels rather than filtering regions afterwards.
    // A change straddling the boundary is neither wholly ignored nor wholly
    // reported, and dropping or keeping it whole are both wrong answers.
    const straddling = mask([
      '####..',
      '####..',
      '......',
    ]);

    const { mask: after } = subtractRegions(straddling, [
      { x: 0, y: 0, width: 2, height: 2 },
    ]);

    const isolation = isolateRegions(after, { cell: 1 });
    expect(isolation.regions).toHaveLength(1);
    expect(isolation.regions[0]!.x).toBe(2);
    expect(isolation.regions[0]!.pixels).toBe(4);
  });

  it('rounds outward, so no rim of residue survives an ignore', () => {
    const before = mask([
      '###',
      '###',
      '###',
    ]);

    // A CSS box landing on fractional pixels. Rounding inward would leave a
    // one-pixel border changed around every ignored element, forever.
    const { ignored } = subtractRegions(before, [
      { x: 0.4, y: 0.4, width: 2.2, height: 2.2 },
    ]);

    expect(ignored).toBe(9);
  });

  it('does not call the second of two overlapping boxes inert', () => {
    // Clearing is first-come, so the second box clears zero however much of the
    // change it covers. Judged on that it reads as "this rule caught nothing,
    // delete it" — about a rule that is doing exactly what it says. Two rules
    // over one element is ordinary: a config selector and a markup marker.
    const before = mask([
      '##..',
      '##..',
    ]);

    const { inert } = subtractRegions(before, [
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 0, y: 0, width: 2, height: 2 },
    ]);

    expect(inert).toEqual([]);
  });

  it('reports a box that covered nothing, which is a hole nobody can see', () => {
    const before = mask([
      '..##',
      '..##',
    ]);

    const { inert } = subtractRegions(before, [
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 2, y: 0, width: 2, height: 2 },
    ]);

    expect(inert).toEqual([{ x: 0, y: 0, width: 2, height: 2 }]);
  });

  it('is the identity when nothing is excluded', () => {
    const before = mask(['##', '..']);
    const result = subtractRegions(before, []);

    expect(result.mask).toBe(before);
    expect(result.ignored).toBe(0);
  });

  it('clips a box that runs off the canvas', () => {
    const before = mask(['##', '##']);
    const { ignored, mask: after } = subtractRegions(before, [
      { x: -10, y: -10, width: 100, height: 100 },
    ]);

    expect(ignored).toBe(4);
    expect(after.changed).toBe(0);
  });
});
