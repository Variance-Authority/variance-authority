import { describe, expect, it } from 'vitest';
import {
  hashComponents,
  movedBands,
  movedBandsBetween,
  UNATTRIBUTED,
  type BandDigests,
  type ComponentHash,
} from './component-hash.js';
import { CHROMIUM_PROFILE, JSDOM_PROFILE } from '../format/profile.js';
import type { Rect } from '../format/capture.js';
import type { SemanticNode, SemanticSnapshot } from '../format/snapshot.js';

/**
 * Per-component hashing, tested on hand-written trees.
 *
 * The property under test is not "the digest is stable" — any hash function has
 * that. It is that **a component's hash moves when its own code changes and at no
 * other time**. Every test below is a way that could be false, and the two that
 * matter most are the pair asserting that a change does not leak up to an
 * ancestor or down to a descendant.
 */

interface Spec {
  readonly tag: string;
  readonly owner?: string;
  readonly text?: string;
  readonly style?: Readonly<Record<string, string>>;
  readonly rect?: Rect;
  readonly children?: readonly Spec[];
}

/** Build a tree, threading owner down so a node inherits its parent's boundary. */
function tree(spec: Spec, path = '0', inherited?: string): SemanticNode {
  const owner = spec.owner ?? inherited;

  return {
    path,
    tag: spec.tag,
    attributes: {},
    style: spec.style ?? {},
    ...(spec.text !== undefined ? { text: spec.text } : {}),
    ...(spec.rect !== undefined ? { rect: spec.rect } : {}),
    ...(owner !== undefined
      ? { provenance: { owners: [{ name: owner, propsDigest: 'v1:x' }] } }
      : {}),
    children: (spec.children ?? []).map((child, index) =>
      tree(child, `${path}/${index}`, owner),
    ),
  };
}

function snapshotOf(spec: Spec, layout = false): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: 's', kind: 'story' },
    profile: layout ? CHROMIUM_PROFILE : JSDOM_PROFILE,
    environment: { semanticDigest: 'v1:e', rasterDigest: 'v1:r', inputs: {} } as never,
    renderHash: 'v1:0',
    structureHash: 'v1:0',
    styleHash: 'v1:0',
    root: tree(spec),
    styleProvenance: [],
    diagnostics: [],
  };
}

/** Bands that moved for one component between two hashings. */
function moved(
  before: readonly ComponentHash[],
  after: readonly ComponentHash[],
  component: string,
): readonly string[] {
  return [...movedBands(of(before, component), of(after, component))];
}

function of(hashes: readonly ComponentHash[], component: string): ComponentHash {
  const found = hashes.find((hash) => hash.component === component);
  if (found === undefined) throw new Error(`no hash for ${component}; got ${hashes.map((h) => h.component).join(', ')}`);
  return found;
}

/** `Card` renders a label of its own and a `Button` that renders its own label. */
const CARD = (options: { label?: string; button?: string; buttonColor?: string } = {}): Spec => ({
  tag: 'div',
  owner: 'Card',
  children: [
    { tag: 'h2', text: options.label ?? 'Title' },
    {
      tag: 'button',
      owner: 'Button',
      style: { color: options.buttonColor ?? 'rgb(0, 0, 0)' },
      children: [{ tag: 'span', text: options.button ?? 'Go' }],
    },
  ],
});

describe('boundary scoping', () => {
  it('does not move an ancestor when a descendant component changes', () => {
    // The central property. A whole-subtree hash would move `Card` here, and
    // then every ancestor up to the page root moves on every leaf edit — a
    // record that reports "the page changed" on every commit and locates nothing.
    const before = hashComponents(snapshotOf(CARD()));
    const after = hashComponents(snapshotOf(CARD({ button: 'Stop' })));

    // Asserted through `movedBands` rather than through one digest, because the
    // property is *this component moved and that one did not* and naming a
    // digest makes it also a claim about which one. These edits are text, so
    // they moved out of `structure` and into `text` on 2026-08-06 and the test
    // went red while the property it exists to protect had never been truer.
    expect(moved(before, after, 'Button')).toEqual(['content']);
    expect(moved(before, after, 'Card')).toEqual([]);
  });

  it('does not move a descendant when its ancestor changes', () => {
    const before = hashComponents(snapshotOf(CARD()));
    const after = hashComponents(snapshotOf(CARD({ label: 'Other' })));

    expect(moved(before, after, 'Card')).toEqual(['content']);
    expect(moved(before, after, 'Button')).toEqual([]);
  });

  it('treats composition as the parent’s own change', () => {
    // Removing a `<Button>` from `Card`'s JSX is `Card`'s edit. The placeholder
    // is what makes this visible without hashing the child's contents.
    const before = hashComponents(snapshotOf(CARD()));
    const after = hashComponents(
      snapshotOf({ tag: 'div', owner: 'Card', children: [{ tag: 'h2', text: 'Title' }] }),
    );

    expect(of(after, 'Card').structure).not.toBe(of(before, 'Card').structure);
    expect(after.map((hash) => hash.component)).not.toContain('Button');
  });

  it('counts instances and moves when they reorder', () => {
    const two = (first: string, second: string): Spec => ({
      tag: 'div',
      owner: 'List',
      children: [
        { tag: 'button', owner: 'Button', children: [{ tag: 'span', text: first }] },
        { tag: 'button', owner: 'Button', children: [{ tag: 'span', text: second }] },
      ],
    });

    const before = hashComponents(snapshotOf(two('A', 'B')));
    const after = hashComponents(snapshotOf(two('B', 'A')));

    expect(of(before, 'Button').instances).toBe(2);
    // A reorder is a change, and it belongs to `Button`'s instance list. `List`
    // holds two identical placeholders, so its own structure is untouched —
    // which is correct: `List` renders two buttons either way, and what moved
    // is which content sits in which one.
    expect(moved(before, after, 'Button')).toEqual(['content']);
    expect(moved(before, after, 'List')).toEqual([]);
  });
});

describe('bands', () => {
  it('separates a repaint from a restructure', () => {
    const before = hashComponents(snapshotOf(CARD()));
    const after = hashComponents(snapshotOf(CARD({ buttonColor: 'rgb(255, 0, 0)' })));

    expect(of(after, 'Button').style).not.toBe(of(before, 'Button').style);
    expect(of(after, 'Button').structure).toBe(of(before, 'Button').structure);
  });

  it('reports geometry only where layout was observed', () => {
    const moved = (y: number): Spec => ({
      tag: 'div',
      owner: 'Stack',
      rect: { x: 0, y, width: 10, height: 10 },
    });

    const chromium = [hashComponents(snapshotOf(moved(0), true)), hashComponents(snapshotOf(moved(8), true))];
    expect(of(chromium[1]!, 'Stack').geometry).not.toBe(of(chromium[0]!, 'Stack').geometry);
    // A pure reflow moves nothing but geometry.
    expect(of(chromium[1]!, 'Stack').style).toBe(of(chromium[0]!, 'Stack').style);
    expect(of(chromium[1]!, 'Stack').structure).toBe(of(chromium[0]!, 'Stack').structure);
  });

  it('omits geometry under a profile without layout, rather than emptying it', () => {
    // Absent and empty must not collide. An empty digest would compare equal
    // between "nothing moved" and "movement was unobservable" — the false
    // `unchanged` this system must never produce (ADR-0002).
    const [stack] = hashComponents(snapshotOf({ tag: 'div', owner: 'Stack' }, false));
    expect(stack!.geometry).toBeUndefined();
    expect('geometry' in stack!).toBe(false);
  });
});

describe('what must not enter a hash', () => {
  it('ignores node paths, so an unrelated sibling insertion moves nothing', () => {
    // A path is an address. Inserting a sibling renumbers everything after it,
    // and a hash that included one would report a change in every component
    // below the insertion point — none of which anybody edited.
    const button: Spec = { tag: 'button', owner: 'Button', children: [{ tag: 'span', text: 'Go' }] };

    const before = hashComponents(snapshotOf({ tag: 'div', owner: 'Page', children: [button] }));
    const after = hashComponents(
      snapshotOf({
        tag: 'div',
        owner: 'Page',
        children: [{ tag: 'hr', owner: 'Rule' }, button],
      }),
    );

    expect(of(after, 'Button').structure).toBe(of(before, 'Button').structure);
  });

  it('produces byte-identical output for an unchanged subject', () => {
    expect(hashComponents(snapshotOf(CARD()))).toEqual(hashComponents(snapshotOf(CARD())));
  });

  it('orders output by component name', () => {
    const names = hashComponents(snapshotOf(CARD())).map((hash) => hash.component);
    expect(names).toEqual([...names].sort());
  });
});

describe('a broken provenance chain', () => {
  it('is named rather than dropped', () => {
    // Provenance is supposed to make every node nameable, so an unowned node
    // means the chain broke — a defect in this tool. Silently omitting those
    // nodes would hide a change in them entirely.
    const hashes = hashComponents(snapshotOf({ tag: 'div', children: [{ tag: 'p', text: 'x' }] }));

    expect(hashes.map((hash) => hash.component)).toEqual([UNATTRIBUTED]);
    expect(of(hashes, UNATTRIBUTED).instances).toBe(1);
  });
});

describe('every component that moved, and in which band', () => {
  /**
   * Built from digest literals rather than from trees, on purpose.
   *
   * The property here is the mapping — which pairs of digests produce which
   * bands, and which of those the comparison calls a cause — and driving it
   * through `hashComponents` would make every assertion also a claim about what
   * a particular tag digests to. The trees above already test that.
   */
  function hash(component: string, digests: Partial<BandDigests> = {}): ComponentHash {
    return {
      component,
      instances: 1,
      structure: 'v1:s',
      semantics: 'v1:a',
      text: 'v1:t',
      style: 'v1:y',
      geometry: 'v1:g',
      ...digests,
    };
  }

  it('names the bands per component and says nothing about the ones that held', () => {
    const moved = movedBandsBetween(
      [hash('Button'), hash('Card'), hash('Nav')],
      [hash('Button', { style: 'v1:other' }), hash('Card', { text: 'v1:other' }), hash('Nav')],
    );

    expect(moved).toEqual([
      { component: 'Button', bands: ['token'], cause: true },
      { component: 'Card', bands: ['content'], cause: true },
    ]);
  });

  it('reports a pushed component, and does not call it a cause', () => {
    // The whole reason this is not `causesBetween` with extra fields. A box that
    // moved because a neighbour grew belongs on the page — a reviewer reading
    // *why did this card reflow* needs to see it — and it must not be ranked as
    // an edit, because nobody edited it.
    expect(movedBandsBetween([hash('Card')], [hash('Card', { geometry: 'v1:elsewhere' })])).toEqual([
      { component: 'Card', bands: ['geometry'], cause: false },
    ]);
  });

  it('keeps `cause` when the band mapping has folded the two apart', () => {
    // `structure` and `geometry` both land in the `geometry` band, so after the
    // mapping an edited tree and a shoved rect are the same word. A surface
    // deriving cause from bands would report every restructure as collateral.
    const edited = movedBandsBetween([hash('Card')], [hash('Card', { structure: 'v1:other' })]);

    expect(edited).toEqual([{ component: 'Card', bands: ['geometry'], cause: true }]);
  });

  it('says which side a component was on when it is on one side only', () => {
    // `bands` cannot carry this: there is no second digest to compare against,
    // and reporting `[]` would read as *nothing moved* about a component that
    // either arrived or left.
    expect(movedBandsBetween([hash('Old')], [hash('New')])).toEqual([
      { component: 'New', bands: ['geometry'], cause: true, presence: 'added' },
      { component: 'Old', bands: ['geometry'], cause: true, presence: 'removed' },
    ]);
  });

  it('leaves the unattributed bucket out of both sides', () => {
    // It is not a component. Its digests move whenever any unowned node anywhere
    // in the subject moves, so it would be reported as a cause on every run.
    const moved = movedBandsBetween(
      [hash(UNATTRIBUTED)],
      [hash(UNATTRIBUTED, { text: 'v1:other' })],
    );

    expect(moved).toEqual([]);
  });

  it('orders by component name, so two runs of one build agree', () => {
    const names = movedBandsBetween(
      [hash('Nav'), hash('Button'), hash('Card')],
      [hash('Nav', { style: 'v1:o' }), hash('Button', { style: 'v1:o' }), hash('Card', { style: 'v1:o' })],
    ).map((entry) => entry.component);

    expect(names).toEqual(['Button', 'Card', 'Nav']);
  });

  it('carries a geometry-blind profile without inventing a still box', () => {
    // No `geometry` digest on either side is *unobserved*, not *unchanged*, and
    // the band must not appear. It appearing would put a reflow claim on a jsdom
    // run that measured no boxes at all.
    const flat = (component: string, style: string): ComponentHash => {
      const { geometry: _unused, ...rest } = hash(component, { style });
      return rest;
    };

    expect(movedBandsBetween([flat('Button', 'v1:y')], [flat('Button', 'v1:o')])).toEqual([
      { component: 'Button', bands: ['token'], cause: true },
    ]);
  });
});
