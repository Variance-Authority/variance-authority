import { describe, expect, it } from 'vitest';
import { hashComponents } from '../attribute/component-hash.js';
import { componentInstances } from '../attribute/instances.js';
import { capture, node } from '../rules/normalize/fixture.js';
import { normalize } from '../rules/normalize/index.js';
import { heldDigest } from './provenance.js';
import type { Holding } from './holding.js';

/**
 * A holding reaches the snapshot and reaches no digest.
 *
 * The claim `SemanticNode.holding` makes, kept by a test rather than by a
 * sentence, because it is the claim the whole feature rests on. `wiring.ts`
 * refuses to put a hook's value in a band, and the refusal is right: a hook's
 * value is the thing that legitimately differs between two readings of one page,
 * so a band carrying it would fire on every run and be switched off within a
 * week. This field is evidence carried beside the snapshot, on `styleProvenance`'s
 * precedent — and the only thing standing between the two is that
 * `structureOf`, `styleOf` and `shapeOf` project fields by name.
 *
 * A rename in any of those three would silently start hashing state. The tests
 * below fail loudly instead, and they cost one normalize each.
 */
const holding: Holding = {
  cells: [{ index: 0, hook: 'useState', digest: heldDigest({ open: true }) }],
  contexts: [{ name: 'Theme', digest: heldDigest('dark') }],
  props: [{ name: 'label', digest: heldDigest('Save') }],
};

const other: Holding = {
  cells: [{ index: 0, hook: 'useState', digest: heldDigest({ open: false }) }],
  contexts: [{ name: 'Theme', digest: heldDigest('light') }],
  props: [{ name: 'label', digest: heldDigest('Cancel') }],
  unread: 'useSomethingNew',
};

const subject = (held?: Holding) =>
  normalize(
    capture({
      subjectId: 'story:button--default',
      root: node({
        tag: 'div',
        owners: [{ name: 'Panel' }],
        ...(held ? { holding: held } : {}),
        children: [
          node({
            tag: 'button',
            text: 'Save',
            owners: [{ name: 'Button' }, { name: 'Panel' }],
            ...(held ? { holding: held } : {}),
          }),
        ],
      }),
    }),
  );

describe('what a holding is allowed to move', () => {
  it('moves no snapshot hash when it appears', () => {
    const bare = subject();
    const carried = subject(holding);

    expect(carried.root.holding).toEqual(holding);
    expect(carried.renderHash).toBe(bare.renderHash);
    expect(carried.structureHash).toBe(bare.structureHash);
    expect(carried.styleHash).toBe(bare.styleHash);
  });

  it('moves no snapshot hash when the state it carries changes', () => {
    // The one that matters for flakes: two readings of one page whose components
    // are holding different values are still the same render, and a baseline
    // taken from either must accept the other.
    const before = subject(holding);
    const after = subject(other);

    expect(after.renderHash).toBe(before.renderHash);
    expect(after.structureHash).toBe(before.structureHash);
    expect(after.styleHash).toBe(before.styleHash);
  });

  it('moves no band-exact component hash', () => {
    const bare = hashComponents(subject());
    const carried = hashComponents(subject(other));

    expect(carried).toEqual(bare);
  });

  it('moves no component instance digest', () => {
    expect(componentInstances(subject(other))).toEqual(componentInstances(subject()));
  });
});
