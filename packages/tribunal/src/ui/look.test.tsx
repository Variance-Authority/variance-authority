// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RegionRecord } from '@variance-authority/report';
import type { SubjectView } from '../review-types.js';
import { createReviewClient } from './client.js';
import type { Appearance } from './grouping.js';
import { Look, frameOf, sightings } from './look.js';

/**
 * The crop, held to the two things a picture of a difference can get wrong.
 *
 * It can be a picture of the wrong place — every failure of the geometry looks
 * like a plausible screenshot, and a reviewer who approves on the strength of one
 * has approved a region they never saw. And it can be a picture that argues
 * against the card carrying it: the card's claim is *one edit, N places*, so a
 * strip that draws N of them has spent a full-page decode each to contradict it.
 */

const CLIENT = createReviewClient({ endpoint: '/api', token: 'unused-here' });

const WINDOW = { width: 264, height: 176 };

function region(overrides: Partial<RegionRecord> = {}): RegionRecord {
  return { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, ...overrides };
}

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'route/cart@1280',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 3000,
    regions: [region({ component: 'LinkComponent', fingerprint: 'v1:a' })],
    has: { before: true, after: true, diff: true },
    size: { width: 1280, height: 9000 },
    approvable: true,
    decision: null,
    ...overrides,
  };
}

function appearance(overrides: Partial<Appearance> = {}): Appearance {
  return { subject: subject(), pixels: 3000, shape: 'v1:a', alongside: [], ...overrides };
}

describe('the crop is a picture of the place the run measured', () => {
  const box = { width: 1280, height: 9000 };

  it('magnifies a small region and centres the plate on it', () => {
    const frame = frameOf(region({ x: 600, y: 4000, width: 132, height: 44 }), box, WINDOW);

    expect(frame.scale).toBeGreaterThan(1);
    expect(frame.whole).toBe(true);
    // The region's centre lands in the middle of the window: the offset is
    // negative by exactly what it takes to put it there.
    expect(666 * frame.scale + frame.left).toBeCloseTo(WINDOW.width / 2, 6);
    expect(4022 * frame.scale + frame.top).toBeCloseTo(WINDOW.height / 2, 6);
  });

  it('refuses to leave a band of nothing at an edge', () => {
    // A region against the top of a nine-thousand-pixel capture, centred
    // honestly, would put half the window above the first row of the image — and
    // a reviewer would be reading a difference with a strip of plate over it.
    const frame = frameOf(region({ x: 2, y: 0, width: 4, height: 4 }), box, WINDOW);

    expect(frame.top).toBe(0);
    expect(frame.left).toBe(0);
  });

  it('centres the whole capture when it is smaller than the window', () => {
    const frame = frameOf(region({ x: 20, y: 10, width: 20, height: 20 }), { width: 60, height: 40 }, WINDOW);

    expect(frame.left).toBeCloseTo((WINDOW.width - 60 * frame.scale) / 2, 6);
    expect(frame.top).toBeCloseTo((WINDOW.height - 40 * frame.scale) / 2, 6);
  });

  it('says a region is only partly shown rather than cropping it in silence', () => {
    // Pushed all the way out, a two-thousand-pixel region still does not fit. The
    // crop is then a picture of a corner of the finding, and a caption that did
    // not say so would be a picture of the finding.
    const frame = frameOf(
      region({ x: 0, y: 0, width: 2000, height: 2000 }),
      { width: 4000, height: 4000 },
      WINDOW,
    );

    expect(frame.whole).toBe(false);
  });

  it('never magnifies past the point where a pixel is a tile', () => {
    const frame = frameOf(region({ x: 0, y: 0, width: 1, height: 1 }), box, WINDOW);

    expect(frame.scale).toBeLessThanOrEqual(8);
  });
});

describe('one crop per shape, which is the card’s own argument', () => {
  it('draws one of eleven places when all eleven carry the same difference', () => {
    const eleven = Array.from({ length: 11 }, (_, index) =>
      appearance({ subject: subject({ subject: `story:${String(index)}` }) }),
    );

    expect(sightings(eleven).map((each) => each.appearance.subject.subject)).toEqual(['story:0']);
    expect(sightings(eleven)[0]?.shared).toBe(11);
  });

  it('keeps two differences nothing characterised apart', () => {
    // Absent is not equal. Two runs that recorded no shape have not been shown to
    // match, and folding them would hide one behind a picture of the other.
    const unshaped = [
      appearance({
        subject: subject({ subject: 'a', regions: [region({ component: 'Nav' })] }),
        shape: undefined,
      }),
      appearance({
        subject: subject({ subject: 'b', regions: [region({ component: 'Nav' })] }),
        shape: undefined,
      }),
    ];

    expect(sightings(unshaped)).toHaveLength(2);
    expect(sightings(unshaped).every((each) => each.shared === 1)).toBe(true);
  });

  it('takes the first place in report order, never the biggest', () => {
    // The same rule the leading cause is picked by. Largest-first draws the
    // container that reflowed, at whatever size it happened to reflow to.
    const found = sightings([
      appearance({ subject: subject({ subject: 'small' }), pixels: 40 }),
      appearance({ subject: subject({ subject: 'huge' }), pixels: 90_000 }),
    ]);

    expect(found.map((each) => each.appearance.subject.subject)).toEqual(['small']);
  });

  it('passes over an appearance the report blamed nothing in', () => {
    expect(sightings([appearance({ subject: subject({ regions: [] }) })])).toEqual([]);
  });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function show(appearances: readonly Appearance[]): void {
  act(() => {
    root.render(
      <Look client={CLIENT} build="6" component="LinkComponent" appearances={appearances} />,
    );
  });
}

function press(label: string): void {
  const button = [...host.querySelectorAll('button')].find((each) =>
    each.textContent?.includes(label),
  );
  if (button === undefined) throw new Error(`no button says ${label}`);
  act(() => button.click());
}

describe('the strip is revealed, and both readings stay mounted', () => {
  it('draws no raster until somebody asks to look', () => {
    // A route candidate here is 1280 by 9000 and costs about 46MB of bitmap. Four
    // cards of three crops, two layers each, is a page that stalls before its
    // first row can be read — and the crop magnifies the whole raster, so a 264px
    // window reduces none of it.
    show([appearance()]);

    expect(host.querySelectorAll('img')).toHaveLength(0);
    expect(host.textContent).toContain('Look at the change');
  });

  it('flips between the two readings without unmounting either', () => {
    // A flip that swapped the src goes through a frame of nothing, and on a
    // difference of twenty pixels a flash is the loudest thing on screen.
    show([appearance()]);
    press('Look at the change');

    const images = (): readonly HTMLImageElement[] => [...host.querySelectorAll('img')];
    expect(images()).toHaveLength(2);
    expect(images().map((each) => each.style.opacity)).toEqual(['', '1']);

    press('show the baseline');

    expect(images()).toHaveLength(2);
    expect(images()[1]?.style.opacity).toBe('0');
  });

  it('draws each layer at its own share of the union box', () => {
    // A baseline stretched to the candidate's width turns a width change into a
    // hairline, and at 3x on a hundred-pixel region the hairline is off screen.
    show([
      appearance({
        subject: subject({ baseline: { width: 640, height: 9000 } }),
      }),
    ]);
    press('Look at the change');

    expect([...host.querySelectorAll('img')][0]?.style.width).toBe('50%');
  });

  it('counts the shapes it did not draw rather than dropping them', () => {
    show(
      Array.from({ length: 6 }, (_, index) =>
        appearance({
          subject: subject({ subject: `story:${String(index)}` }),
          shape: `v1:${String(index)}`,
        }),
      ),
    );
    press('Look at the change');

    expect(host.querySelectorAll('.va-sight')).toHaveLength(3);
    expect(host.textContent).toContain('3 further shapes');
  });

  it('offers no flip when the run kept no baseline to flip to', () => {
    show([
      appearance({
        subject: subject({ has: { before: false, after: true, diff: false } }),
      }),
    ]);
    press('Look at the change');

    expect(host.textContent).not.toContain('show the baseline');
    expect(host.querySelectorAll('img')).toHaveLength(1);
  });
});
