import { describe, expect, it } from 'vitest';
import { causesBetween, hashComponents } from './component-hash.js';
import { normalize } from '../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../rules/normalize/fixture.js';
import type { SemanticSnapshot } from '../format/snapshot.js';

/**
 * Cause from collateral, decided from two sets of component hashes.
 *
 * This is the arithmetic behind cause-first ranking on the path where nobody
 * held two documents — a stored baseline is an image, so the only thing a run
 * can compare is what each side said about its own components. The failure it
 * exists to prevent is precise and was measured: area ranks the *displaced*
 * above the *displacer*, so an edit that reflows its surroundings is reported
 * under the wrapper that moved rather than the component that was edited.
 *
 * Every test here is therefore about a wrapper. A version of this that only
 * checked "the edited component is named" would pass while naming everything.
 */

/** A wrapper enclosing a button, with the button's own padding as a parameter. */
function page(padding: string, rect = { x: 8, y: 8, width: 100, height: 40 }): SemanticSnapshot {
  return normalize(
    capture({
      profile: CHROMIUM_PROFILE,
      subjectId: 'story:page',
      root: node({
        owners: [{ name: 'Shell', props: {} }],
        rect: { x: 0, y: 0, width: 200, height: 60 },
        rules: [{ selector: '.shell', declare: { display: 'block' } }],
        children: [
          node({
            tag: 'button',
            role: 'button',
            name: 'Save',
            text: 'Save',
            owners: [{ name: 'Button', props: {} }, { name: 'Shell', props: {} }],
            rect,
            rules: [{ selector: '.b', declare: { padding, color: '#000000' } }],
          }),
        ],
      }),
    }),
  );
}

const causesOf = (before: SemanticSnapshot, after: SemanticSnapshot): readonly string[] =>
  causesBetween(hashComponents(before), hashComponents(after));

describe('an edit inside a component', () => {
  it('names the component and not the wrapper it displaced', () => {
    // The whole point. `Shell` did not change; its child grew and pushed it
    // around, and naming it sends a reviewer to a file nobody edited.
    const causes = causesOf(
      page('12px 18px'),
      page('15px 24px', { x: 8, y: 8, width: 130, height: 46 }),
    );

    expect(causes).toEqual(['Button']);
  });

  it('names nothing when nothing moved', () => {
    expect(causesOf(page('12px 18px'), page('12px 18px'))).toEqual([]);
  });

  it('names nothing when only a box moved', () => {
    // Same content, different position. Under this rule that is displacement,
    // and a run that reported it as a cause would name every component on a page
    // whose header got taller.
    const causes = causesOf(
      page('12px 18px'),
      page('12px 18px', { x: 8, y: 20, width: 100, height: 40 }),
    );

    expect(causes).toEqual([]);
  });
});

describe('an element rendered through a prop', () => {
  /** `<Card title={<h3/>} />`: authored by `Page`, enclosed by `Card`. */
  const slotted = (text: string): SemanticSnapshot =>
    normalize(
      capture({
        profile: CHROMIUM_PROFILE,
        subjectId: 'story:page',
        root: node({
          owners: [{ name: 'Page', props: {} }],
          rect: { x: 0, y: 0, width: 200, height: 60 },
          rules: [{ selector: '.p', declare: { display: 'block' } }],
          children: [
            node({
              tag: 'section',
              owners: [{ name: 'Card', props: {} }, { name: 'Page', props: {} }],
              rect: { x: 0, y: 0, width: 200, height: 60 },
              children: [
                node({
                  tag: 'h3',
                  text,
                  // Enclosed by `Card`, authored by `Page` — the split ADR-0007
                  // and ADR-0018 name differently, on purpose.
                  owners: [{ name: 'Card', props: {} }, { name: 'Page', props: {} }],
                  rect: { x: 4, y: 4, width: 100, height: 20 },
                }),
              ],
            }),
          ],
        }),
      }),
    );

  it('names the enclosure, which is the namespace a hash is keyed in', () => {
    // Not a defect: ADR-0018 says a component's hash covers *its own nodes*, and
    // the `<h3>` sits inside `Card`. What matters is that the region join can
    // still match it — see `rankRegions`, which now tests both names.
    expect(causesOf(slotted('Invoice'), slotted('Receipt'))).toContain('Card');
  });
});

describe('a component that appeared or disappeared', () => {
  const withChild = (children: boolean): SemanticSnapshot =>
    normalize(
      capture({
        profile: CHROMIUM_PROFILE,
        subjectId: 'story:page',
        root: node({
          owners: [{ name: 'Shell', props: {} }],
          rect: { x: 0, y: 0, width: 200, height: 60 },
          rules: [{ selector: '.shell', declare: { display: 'block' } }],
          children: children
            ? [
                node({
                  tag: 'span',
                  text: 'badge',
                  owners: [{ name: 'Badge', props: {} }, { name: 'Shell', props: {} }],
                  rect: { x: 8, y: 8, width: 40, height: 20 },
                }),
              ]
            : [],
        }),
      }),
    );

  it('names the one that arrived, and the parent that decided to render it', () => {
    // Both, and both are right: `Badge` is new, and `Shell`'s own output changed
    // because a child boundary appeared in it. `shapeOf` records a nested
    // boundary as a placeholder, so this is the parent's own structural change.
    expect(causesOf(withChild(false), withChild(true))).toEqual(['Badge', 'Shell']);
  });

  it('names the one that left', () => {
    expect(causesOf(withChild(true), withChild(false))).toEqual(['Badge', 'Shell']);
  });
});
