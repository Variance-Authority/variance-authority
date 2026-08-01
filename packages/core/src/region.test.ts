import { describe, expect, it } from 'vitest';
import { attributeRegions, isolateRegions, type ChangeMask } from './region.js';
import type { SemanticNode, SemanticSnapshot } from './snapshot.js';

/**
 * The two phases that turn a pixel count into a place, tested on hand-written
 * inputs.
 *
 * Neither needs a browser, a PNG, or a render — which is the point of splitting
 * them out of the comparison. A mask is a bitmask and a snapshot is a value, so
 * the question "does 5482 pixels become a sentence about `Toggle`" is answerable
 * in milliseconds and does not depend on the thing that produced the pixels.
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

function node(
  path: string,
  rect: { x: number; y: number; width: number; height: number },
  extra: Partial<SemanticNode> = {},
): SemanticNode {
  return { path, tag: 'div', attributes: {}, style: {}, rect, children: [], ...extra };
}

function snapshotOf(root: SemanticNode): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: 'fixture', kind: 'fixture' },
    profile: { id: 'chromium', layout: true, computedStyle: true, paint: false, bands: [] } as never,
    environment: { digest: 'v1:x', semanticDigest: 'v1:x', inputs: {} as never },
    renderHash: 'v1:x',
    structureHash: 'v1:x',
    styleHash: 'v1:x',
    root,
    styleProvenance: [],
    diagnostics: [],
  };
}

const TREE = snapshotOf(
  node('0', { x: 0, y: 0, width: 400, height: 200 }, {
    role: 'main',
    children: [
      node('0/0', { x: 10, y: 10, width: 380, height: 60 }, {
        provenance: { owners: [{ name: 'Card', propsDigest: 'v1:a' }] },
        children: [
          node('0/0/0', { x: 20, y: 20, width: 100, height: 30 }, {
            provenance: { owners: [{ name: 'Card', propsDigest: 'v1:a' }], createdBy: 'Toggle' },
          }),
        ],
      }),
    ],
  }),
);

describe('attributing a region to the tree', () => {
  it('names the tightest box that contains the region, not the outermost', () => {
    // Every change inside a button is also inside the card and inside `main`.
    // Only the innermost answer can be acted on.
    const [attributed] = attributeRegions(
      [{ x: 30, y: 25, width: 20, height: 10, pixels: 200, density: 1 }],
      TREE,
      { scale: 1, origin: { x: 0, y: 0 } },
    );

    expect(attributed!.unattributed).toBe(false);
    expect(attributed!.path).toBe('0/0/0');
    expect(attributed!.component).toBe('Toggle');
  });

  it('converts device pixels to CSS pixels using the stated scale', () => {
    // The same region at 2x. Attributed at 1x it would land in `Card`, produce a
    // complete and plausible report, and name the wrong component.
    const [attributed] = attributeRegions(
      [{ x: 60, y: 50, width: 40, height: 20, pixels: 800, density: 1 }],
      TREE,
      { scale: 2, origin: { x: 0, y: 0 } },
    );

    expect(attributed!.path).toBe('0/0/0');
  });

  it('falls back to the enclosing box when nothing smaller contains the region', () => {
    // Paint escapes its own box routinely — shadows, outlines, overhanging
    // glyphs — and still lands inside an ancestor. Naming that ancestor is the
    // true answer, not a consolation one, so this is attributed rather than
    // refused.
    const [attributed] = attributeRegions(
      [{ x: 0, y: 190, width: 400, height: 10, pixels: 4000, density: 1 }],
      TREE,
      { scale: 1, origin: { x: 0, y: 0 } },
    );

    expect(attributed!.unattributed).toBe(false);
    expect(attributed!.path).toBe('0');
  });

  it('refuses, loudly, when a region lands outside the tree', () => {
    // The failure mode worth catching: a wrong scale or origin puts every region
    // somewhere the tree is not, and the report still comes out complete and
    // plausible. `nearest` is offered as orientation and kept out of `component`.
    const [attributed] = attributeRegions(
      [{ x: 250, y: 20, width: 200, height: 40, pixels: 8000, density: 1 }],
      TREE,
      { scale: 1, origin: { x: 100, y: 0 } },
    );

    expect(attributed!.unattributed).toBe(true);
    expect(attributed!.component).toBeUndefined();
    expect(attributed!.nearest?.component).toBe('Card');
  });

  it('describes where the region is in landmarks rather than coordinates', () => {
    const [attributed] = attributeRegions(
      [{ x: 30, y: 25, width: 20, height: 10, pixels: 200, density: 1 }],
      TREE,
      { scale: 1, origin: { x: 0, y: 0 } },
    );

    expect(attributed!.where).toContain('main');
  });

  it('attributes nothing under a profile that never observed a rect', () => {
    // A rect that was not observed must never be inferred. Every region comes
    // back unattributed, which is the correct answer and not a bug to fix.
    const flat = snapshotOf({
      path: '0',
      tag: 'div',
      attributes: {},
      style: {},
      children: [],
    });

    const [attributed] = attributeRegions(
      [{ x: 0, y: 0, width: 10, height: 10, pixels: 100, density: 1 }],
      flat,
      { scale: 1, origin: { x: 0, y: 0 } },
    );

    expect(attributed!.unattributed).toBe(true);
    expect(attributed!.nearest).toBeUndefined();
  });
});
