import { describe, expect, it } from 'vitest';
import { hashComponents, UNATTRIBUTED, type ComponentHash } from './component-hash.js';
import { CHROMIUM_PROFILE, JSDOM_PROFILE } from './profile.js';
import type { Rect } from './capture.js';
import type { SemanticNode, SemanticSnapshot } from './snapshot.js';

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

    expect(of(after, 'Button').structure).not.toBe(of(before, 'Button').structure);
    expect(of(after, 'Card').structure).toBe(of(before, 'Card').structure);
  });

  it('does not move a descendant when its ancestor changes', () => {
    const before = hashComponents(snapshotOf(CARD()));
    const after = hashComponents(snapshotOf(CARD({ label: 'Other' })));

    expect(of(after, 'Card').structure).not.toBe(of(before, 'Card').structure);
    expect(of(after, 'Button').structure).toBe(of(before, 'Button').structure);
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
    expect(of(after, 'Button').structure).not.toBe(of(before, 'Button').structure);
    expect(of(after, 'List').structure).toBe(of(before, 'List').structure);
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
