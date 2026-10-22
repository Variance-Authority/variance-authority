import { describe, expect, it } from 'vitest';
import { attributeRegions } from './region.js';
import type { SemanticNode, SemanticSnapshot } from '../format/snapshot.js';

/**
 * A region made of rows the after image inserted, joined by the rows it spans.
 *
 * An inserted row has no partner in the before image, so it is marked across the
 * whole canvas: its width is the image's, not the content's. Joined by area, the
 * band lands in the only box as wide as the image — the card, never the button
 * whose padding grew — which is how `cases/storybook-case` lost `Button` on every
 * card once rows were aligned.
 */

function node(
  path: string,
  name: string,
  rect: { x: number; y: number; width: number; height: number },
  children: readonly SemanticNode[] = [],
): SemanticNode {
  return {
    path,
    tag: 'div',
    attributes: {},
    style: {},
    rect,
    children,
    provenance: { owners: [{ name, propsDigest: `v1:${name}` }] },
  };
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

/** A card holding two stacked buttons, each `height` tall, the second below the first. */
function card(height: number): SemanticSnapshot {
  return snapshotOf(
    node('0', 'Card', { x: 0, y: 0, width: 330, height: 40 + 2 * height + 20 }, [
      node('0/0', 'Button', { x: 20, y: 30, width: 290, height }),
      node('0/1', 'Button', { x: 20, y: 30 + height + 10, width: 290, height }),
    ]),
  );
}

describe('a region of inserted rows', () => {
  // Three rows inserted in the first button's top padding, marked edge to edge.
  const BAND = { x: 0, y: 34, width: 330, height: 3, pixels: 990, density: 1 };
  const INSERTED = [{ from: 34, to: 37 }];

  it('belongs to the tightest box whose rows span it', () => {
    const [attributed] = attributeRegions([BAND], card(36), {
      scale: 1,
      origin: { x: 0, y: 0 },
      before: card(30),
      beforeOrigin: { x: 0, y: 0 },
      inserted: INSERTED,
    });

    expect(attributed).toMatchObject({ path: '0/0', component: 'Button', unattributed: false });
  });

  it('is joined by area when it reaches outside the inserted rows', () => {
    const [attributed] = attributeRegions([{ ...BAND, y: 33, height: 4 }], card(36), {
      scale: 1,
      origin: { x: 0, y: 0 },
      before: card(30),
      beforeOrigin: { x: 0, y: 0 },
      inserted: INSERTED,
    });

    expect(attributed).toMatchObject({ path: '0', component: 'Card' });
  });
});
