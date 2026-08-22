import { describe, expect, it } from 'vitest';
import { normalize } from '../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../rules/normalize/fixture.js';
import { deriveVariation } from './derive.js';
import type { RawCapture } from '../format/capture.js';

const snap = (raw: RawCapture) => normalize(raw);

/** A parent and the variation that names it, as two subjects of one run. */
const pair = (base: RawCapture, variant: RawCapture) => deriveVariation(snap(base), snap(variant));

describe('a variation compares two subjects on purpose', () => {
  it('compares two different subject ids rather than refusing them', () => {
    // The whole point. `diffSnapshots` throws here, correctly, because it makes a
    // verdict; this makes an explanation of a difference somebody declared.
    const result = pair(
      capture({ root: node({ tag: 'p', text: 'buy' }), subjectId: 'story:checkout--default' }),
      capture({ root: node({ tag: 'p', text: 'buy now' }), subjectId: 'story:checkout--new-flow' }),
    );

    expect(result.parent).toBe('story:checkout--default');
    expect(result.subject).toBe('story:checkout--new-flow');
    expect(result.identical).toBe(false);
    expect(result.bands).toContain('content');
  });

  it('reports a flag that changed nothing as identical', () => {
    const same = (id: string) => capture({ root: node({ tag: 'p', text: 'hi' }), subjectId: id });
    const result = pair(same('story:a--off'), same('story:a--on'));

    // Two subject ids, one render hash: the id is not in `renderHash`, which is
    // what lets a variation be settled without walking either tree.
    expect(result.identical).toBe(true);
    expect(result.deltas).toHaveLength(0);
    expect(result.bands).toEqual([]);
  });
});

describe('the identity of the difference', () => {
  const base = (text: string, extra?: string) =>
    capture({
      root: node({ tag: 'div', children: [node({ tag: 'p', text }), ...(extra === undefined ? [] : [node({ tag: 'b', text: extra })])] }),
      subjectId: 'story:panel--default',
    });
  const variant = (text: string, extra?: string) =>
    capture({
      root: node({ tag: 'div', children: [node({ tag: 'p', text }), ...(extra === undefined ? [] : [node({ tag: 'b', text: extra })])] }),
      subjectId: 'story:panel--flagged',
    });

  it('does not move when parent and variation move together', () => {
    // The finding this exists for: a token changes, both subjects re-render, both
    // go red, and what the flag *adds* is unchanged. A reviewer who has already
    // approved this difference has nothing new to look at.
    const before = deriveVariation(snap(base('one')), snap(variant('one', 'more')));
    const after = deriveVariation(snap(base('two')), snap(variant('two', 'more')));

    expect(after.digest).toBe(before.digest);
  });

  it('moves when the variation gains something its parent does not have', () => {
    const before = deriveVariation(snap(base('one')), snap(variant('one', 'more')));
    const after = deriveVariation(snap(base('one')), snap(variant('one', 'more and more')));

    expect(after.digest).not.toBe(before.digest);
  });
});

describe('what neither side could see', () => {
  it('names a band the other side is blind to rather than reporting agreement', () => {
    // A pair whose sides were read by different profiles has to report geometry
    // as unobserved: one of them has no boxes at all, and "no geometry deltas"
    // would be a sentence about the instrument.
    const result = pair(
      capture({ root: node({ tag: 'p', text: 'hi' }), subjectId: 'story:a--base', profile: CHROMIUM_PROFILE }),
      capture({ root: node({ tag: 'p', text: 'hi' }), subjectId: 'story:a--variant' }),
    );

    expect(result.unobserved).toContain('geometry');
  });

  it('reports the render inputs that differ instead of refusing the pair', () => {
    const result = pair(
      capture({ root: node({ tag: 'p', text: 'hi' }), subjectId: 'story:a--light' }),
      capture({
        root: node({ tag: 'p', text: 'hi' }),
        subjectId: 'story:a--dark',
        fonts: ['Inter/400/normal/cafef00d'],
      }),
    );

    expect(result.environmentDeltas.length).toBeGreaterThan(0);
  });
});
