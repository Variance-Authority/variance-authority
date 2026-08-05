import { describe, expect, it } from 'vitest';
import { attributeRegions, rankRegions } from './region.js';
import type { SemanticNode, SemanticSnapshot } from '../format/snapshot.js';

/**
 * Joining a place on the canvas to a node in the tree, on hand-written inputs.
 *
 * A snapshot is a value, so "does 5482 pixels become a sentence about `Toggle`"
 * is answerable in milliseconds with no browser and no PNG. `mask.test.ts` covers
 * the phase before this one: the two are separated because they fail differently,
 * and reading one to find out about the other is how they came to share a file.
 */

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

/**
 * A wrapper that shrink-wraps its only child, with the flagship case's own rects.
 *
 * `cases/storybook-case` renders `<Tokens><Button/></Tokens>`, and both elements
 * measure `454.34,359 115.33×50` — byte-identical, because the wrapper is a block
 * whose one child decides its size. `TREE` above deliberately never has that
 * shape, which is why the join looked correct for months while reporting the
 * wrapper on the only real suite anyone has run.
 */

describe('a region whose author and enclosure differ', () => {
  const SLOTTED = snapshotOf(
    node('0', { x: 0, y: 0, width: 200, height: 60 }, {
      children: [
        node('0/0', { x: 4, y: 4, width: 100, height: 20 }, {
          // `<Card title={<h3/>} />` — `Page` wrote the JSX, `Card` contains it.
          provenance: { owners: [{ name: 'Card', propsDigest: 'v1:a' }], createdBy: 'Page' },
        }),
      ],
    }),
  );

  const REGION = { x: 10, y: 10, width: 20, height: 8, pixels: 160, density: 1 };

  it('reports the author as the component and the enclosure beside it', () => {
    const [attributed] = attributeRegions([REGION], SLOTTED, { scale: 1, origin: { x: 0, y: 0 } });

    expect(attributed!.component).toBe('Page');
    expect(attributed!.owner).toBe('Card');
  });

  it('is a cause when the cause list names the enclosure', () => {
    // Component hashes are keyed by enclosure (ADR-0018) and regions by author
    // (ADR-0007). A one-sided match finds nothing here and the ordering silently
    // falls back to area — the failure carrying hashes on the baseline was for.
    const [ranked] = rankRegions(
      attributeRegions([REGION], SLOTTED, { scale: 1, origin: { x: 0, y: 0 } }),
      ['Card'],
    );

    expect(ranked!.cause).toBe(true);
  });

  it('is a cause when the cause list names the author', () => {
    const [ranked] = rankRegions(
      attributeRegions([REGION], SLOTTED, { scale: 1, origin: { x: 0, y: 0 } }),
      ['Page'],
    );

    expect(ranked!.cause).toBe(true);
  });

  it('is not a cause when the list names neither', () => {
    // The control. Matching two namespaces must not become matching anything.
    const [ranked] = rankRegions(
      attributeRegions([REGION], SLOTTED, { scale: 1, origin: { x: 0, y: 0 } }),
      ['Sidebar'],
    );

    expect(ranked!.cause).toBe(false);
  });

  it('omits `owner` when it would only repeat the component', () => {
    const [attributed] = attributeRegions(
      [{ x: 30, y: 25, width: 20, height: 10, pixels: 200, density: 1 }],
      TREE,
      { scale: 1, origin: { x: 0, y: 0 } },
    );

    expect(attributed!.component).toBe('Toggle');
    expect(attributed!.owner).toBe('Card');
  });
});

/**
 * A wrapper that shrink-wraps its only child, with the flagship case's own rects.
 *
 * `cases/storybook-case` renders `<Tokens><Button/></Tokens>`, and both elements
 * measure `454.34,359 115.33×50` — byte-identical, because the wrapper is a block
 * whose one child decides its size. `TREE` above deliberately never has that
 * shape, which is why the join looked correct for months while reporting the
 * wrapper on the only real suite anyone has run.
 */
const TIE = snapshotOf(
  node('0', { x: 438.34, y: 343, width: 147.33, height: 82 }, {
    children: [
      node('0/0', { x: 454.34, y: 359, width: 115.33, height: 50 }, {
        provenance: { owners: [{ name: 'Tokens', propsDigest: 'v1:a' }] },
        children: [
          node('0/0/0', { x: 454.34, y: 359, width: 115.33, height: 50 }, {
            provenance: { owners: [{ name: 'Tokens', propsDigest: 'v1:a' }], createdBy: 'Button' },
          }),
        ],
      }),
    ],
  }),
);

describe('two boxes of exactly the same size', () => {
  it('names the inner one, which is the component that was edited', () => {
    // The recorded region from the flagship run: 1356 changed pixels, one region,
    // at the scale and origin that run used. It reported `Tokens` — the wrapper
    // nothing edited — because neither box is tighter and the walk broke the tie
    // towards whichever it saw first, which is always the outer one.
    const [attributed] = attributeRegions(
      [{ x: 17, y: 17, width: 113, height: 48, pixels: 1356, density: 0.25 }],
      TIE,
      { scale: 1 },
    );

    expect(attributed!.path).toBe('0/0/0');
    expect(attributed!.component).toBe('Button');
  });

  it('still names a strictly larger wrapper when only the wrapper contains it', () => {
    // The control against "return the deepest containing node". That rule is
    // wrong on every gap and every padding change: a region in the space a
    // parent's own `gap` produced is inside the parent and inside no child.
    const [attributed] = attributeRegions(
      [{ x: 0, y: 0, width: 140, height: 80, pixels: 11200, density: 1 }],
      TIE,
      { scale: 1, origin: { x: 438.34, y: 343 } },
    );

    expect(attributed!.path).toBe('0');
  });

  it('does not attribute a region that is mostly outside the tightest box', () => {
    // The control against making the flagship case green by lowering
    // `DEFAULT_CONTAINMENT` instead. Half in, half out stays unattributed, and
    // the hint is offered as `nearest` rather than asserted as the answer.
    const [attributed] = attributeRegions(
      [{ x: 100, y: 17, width: 113, height: 48, pixels: 1356, density: 0.25 }],
      TIE,
      { scale: 1 },
    );

    expect(attributed!.unattributed).toBe(true);
    expect(attributed!.nearest?.component).toBe('Button');
  });

  it('reaches the innermost of a chain of identical boxes, not the second one', () => {
    // Transitivity, and it is not free. A design system stacks wrappers — a theme
    // provider inside a layout primitive inside a story decorator — and each one
    // shrink-wraps the next, so a real tree ties three or four deep. A rule that
    // only walked one level past the first tie would name the second wrapper,
    // which is the same defect one box further in.
    const chain = snapshotOf(
      node('0', { x: 0, y: 0, width: 100, height: 40 }, {
        children: [
          node('0/0', { x: 0, y: 0, width: 100, height: 40 }, {
            provenance: { owners: [{ name: 'Theme', propsDigest: 'v1:a' }] },
            children: [
              node('0/0/0', { x: 0, y: 0, width: 100, height: 40 }, {
                provenance: { owners: [{ name: 'Stack', propsDigest: 'v1:a' }] },
                children: [
                  node('0/0/0/0', { x: 0, y: 0, width: 100, height: 40 }, {
                    provenance: {
                      owners: [{ name: 'Stack', propsDigest: 'v1:a' }],
                      createdBy: 'Chip',
                    },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const [attributed] = attributeRegions(
      [{ x: 10, y: 10, width: 20, height: 10, pixels: 200, density: 1 }],
      chain,
      { scale: 1, origin: { x: 0, y: 0 } },
    );

    expect(attributed!.path).toBe('0/0/0/0');
    expect(attributed!.component).toBe('Chip');
  });
});

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
