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

/**
 * A stub observer, so the deferral can be watched rather than assumed.
 *
 * jsdom implements none, which is the branch that draws outright — real, and the
 * one a static render takes. The stub is what proves the other branch exists.
 */
function observed(): { readonly reach: () => void } {
  const callbacks: ((entries: readonly { isIntersecting: boolean }[]) => void)[] = [];

  class Stub {
    constructor(callback: (entries: readonly { isIntersecting: boolean }[]) => void) {
      callbacks.push(callback);
    }
    observe(): void {}
    disconnect(): void {}
  }

  (globalThis as unknown as Record<string, unknown>)['IntersectionObserver'] = Stub;

  return {
    reach: () =>
      act(() => {
        for (const callback of callbacks) callback([{ isIntersecting: true }]);
      }),
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)['IntersectionObserver'];
});

describe('every shape is drawn, and the difference is what is drawn first', () => {
  it('opens on the mask the comparison drew, not on a picture of the component', () => {
    // A crop of the candidate is a picture of the component. Reading one against
    // a remembered baseline is redoing by eye what the run did to the pixel.
    show([appearance()]);

    const images = [...host.querySelectorAll('img')];
    expect(images).toHaveLength(1);
    expect(images[0]?.src).toContain('/diff');
  });

  it('draws one crop for every shape, with no cap counting the rest away', () => {
    // Six shapes is six differences, and a strip that drew three of them and
    // said *3 further shapes* asked the reviewer to click through for the half
    // it had already decided not to show.
    show(
      Array.from({ length: 6 }, (_, index) =>
        appearance({
          subject: subject({ subject: `story:${String(index)}` }),
          shape: `v1:${String(index)}`,
        }),
      ),
    );

    expect(host.querySelectorAll('.va-sight')).toHaveLength(6);
    expect(host.textContent).not.toContain('further shape');
  });

  it('keeps the layer it moved off mounted, so going back is a repaint', () => {
    // A switch that swapped the src goes through a frame of nothing, and on a
    // difference of twenty pixels a flash is the loudest thing on screen.
    show([appearance()]);
    press('baseline');

    const images = (): readonly HTMLImageElement[] => [...host.querySelectorAll('img')];
    expect(images()).toHaveLength(2);
    expect(images().map((each) => each.style.opacity)).toEqual(['0', '1']);

    press('difference');

    expect(images()).toHaveLength(2);
    expect(images().map((each) => each.style.opacity)).toEqual(['1', '0']);
  });

  it('draws each layer at its own share of the union box', () => {
    // A baseline stretched to the candidate's width turns a width change into a
    // hairline, and at 3x on a hundred-pixel region the hairline is off screen.
    show([appearance({ subject: subject({ baseline: { width: 640, height: 9000 } }) })]);
    press('baseline');

    expect([...host.querySelectorAll('img')][1]?.style.width).toBe('50%');
  });

  it('offers only the readings the run kept', () => {
    show([appearance({ subject: subject({ has: { before: false, after: true, diff: false } }) })]);

    expect(host.querySelectorAll('.va-mode')).toHaveLength(0);
    expect(host.querySelectorAll('img')).toHaveLength(1);
  });

  it('says a reading was never kept rather than drawing a ring over nothing', () => {
    // The switch is card-level, so one render with no baseline is asked for one
    // while the others answer. An empty window under a red ring reads as a
    // difference nobody can see rather than an image nobody kept.
    show([
      appearance({ subject: subject({ subject: 'kept' }) }),
      appearance({
        subject: subject({ subject: 'lost', has: { before: false, after: true, diff: true } }),
        shape: 'v1:b',
      }),
    ]);
    press('baseline');

    expect(host.textContent).toContain('No baseline was kept for this render');
    expect(host.querySelectorAll('.va-crop-unplaced')).toHaveLength(1);
  });
});

describe('the raster is deferred by the window, not by a button', () => {
  it('asks for nothing until the crop\u2019s own window comes near the viewport', () => {
    // A route candidate here is 1280 by 9000 and costs about 46MB of bitmap, and
    // six shapes ask for six of them.
    const seen = observed();
    show([appearance()]);

    expect(host.querySelectorAll('img')).toHaveLength(0);
    expect(host.querySelectorAll('.va-crop')).toHaveLength(1);

    seen.reach();

    expect(host.querySelectorAll('img')).toHaveLength(1);
  });

  it('draws outright where nothing can ever tell it the window arrived', () => {
    // No observer, and a static render has no scroll to wait for. A deferral
    // nothing can lift is a permanently empty frame.
    show([appearance()]);

    expect(host.querySelectorAll('img')).toHaveLength(1);
  });

  it('asks for the raster outright, because the plate is nowhere near the viewport', () => {
    // A mobile route capture is 390 by 8868, and centring a region near its foot
    // puts the plate 17,000px above the window. A lazy image there is never in
    // view, so it is never fetched \u2014 and the crop draws its red ring over a
    // frame of nothing. What is watched is the window, which is 264 by 176.
    show([appearance()]);

    expect([...host.querySelectorAll('img')].map((each) => each.getAttribute('loading'))).toEqual([
      null,
    ]);
  });
});
