import { describe, expect, it } from 'vitest';
import {
  LAYOUT_STABILIZATION,
  NO_STABILIZATION,
  RASTER_STABILIZATION,
  describeStabilization,
  stabilizationCss,
  stabilizationDigest,
  type Stabilization,
} from './stabilize.js';

/**
 * The intervention set, tested for the two things that make it worth having:
 * that a difference in what was done to the page cannot be mistaken for a
 * difference in the code, and that the cheap tier is not charged for waits it
 * has no use for.
 */

describe('what each tier actually needs', () => {
  it('asks for nothing when only structure and declared style are observed', () => {
    // A font that has not loaded cannot change which rules match or what they
    // declare. Waiting for it before a structure-and-style hash buys nothing and
    // costs the wait on every subject, on the tier that exists to be cheap.
    expect(NO_STABILIZATION.fonts).toBe(false);
    expect(NO_STABILIZATION.images).toBe(false);
    expect(stabilizationCss(NO_STABILIZATION)).toBe('');
  });

  it('waits for assets only once layout is resolved', () => {
    // Both change metrics — a font its advances, an image its intrinsic size —
    // so a tier that reports rects has to have them.
    expect(LAYOUT_STABILIZATION.fonts).toBe(true);
    expect(LAYOUT_STABILIZATION.images).toBe(true);
  });

  it('leaves the caret to the tier that can actually see it', () => {
    // A caret paints and does not lay out. Hiding it for a layout-only tier
    // would be an intervention that changes the subject and buys nothing.
    expect(LAYOUT_STABILIZATION.caret).toBe(false);
    expect(RASTER_STABILIZATION.caret).toBe(true);
  });
});

describe('holding the page still without changing it', () => {
  it('pauses animations rather than removing them', () => {
    // `animation: none` drops whatever layout the keyframes contribute, which
    // changes the page instead of stopping it. Pausing at a negative delay holds
    // the clock at zero with every declaration still in force.
    const css = stabilizationCss(LAYOUT_STABILIZATION);

    expect(css).toContain('animation-play-state:paused');
    expect(css).not.toContain('animation:none');
    expect(css).not.toContain('animation: none');
  });

  it('emits nothing for a field that is off', () => {
    const css = stabilizationCss({ ...NO_STABILIZATION, caret: true });

    expect(css).toContain('caret-color');
    expect(css).not.toContain('animation-play-state');
    expect(css).not.toContain('scrollbar');
  });
});

describe('what was done is part of what was measured', () => {
  it('gives two different sets two different identities', () => {
    // The whole point. If a baseline paused animations and a run did not, the
    // images differ for a reason that is not the code — and without this the
    // report blames whichever component sits under the pixels.
    expect(stabilizationDigest(LAYOUT_STABILIZATION)).not.toBe(
      stabilizationDigest(RASTER_STABILIZATION),
    );
  });

  it('treats not intervening as a property of the image too', () => {
    // `false` is recorded, not omitted. "We did not pause animations" is as much
    // a fact about the resulting image as "we did", and a digest that ignored it
    // would let the two compare.
    const off: Stabilization = { ...LAYOUT_STABILIZATION, animations: false };
    expect(stabilizationDigest(off)).not.toBe(stabilizationDigest(LAYOUT_STABILIZATION));
  });

  it('is stable for the same set', () => {
    expect(stabilizationDigest({ ...LAYOUT_STABILIZATION })).toBe(
      stabilizationDigest(LAYOUT_STABILIZATION),
    );
  });
});

describe('keeping the gap visible', () => {
  it('names every intervention, so a reader knows the image is not the product', () => {
    const text = describeStabilization(RASTER_STABILIZATION);

    expect(text).toContain('animations paused');
    expect(text).toContain('caret hidden');
    expect(text).toContain('waited for fonts');
  });

  it('says plainly when the subject was left alone', () => {
    expect(describeStabilization(NO_STABILIZATION)).toContain('untouched');
  });
});
