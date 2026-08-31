import { describe, expect, it } from 'vitest';
import type { SubjectView } from '../review-types.js';
import { glanceOf } from './glance.js';

/**
 * What the top of a subject page claims, held to the record it claims it from.
 *
 * Every case here is a way of naming the wrong thing. The prose line this
 * replaces named `Card` on a subject whose only cause was `Button`, because it
 * mapped regions to names and never asked which of them moved. That is not a
 * wording problem — it is the raster tier's answer printed where the hash tier's
 * answer belongs, and a reviewer who opened `card.tsx` looking for the edit
 * would have found nothing there.
 */

function subject(over: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:cart-card--item',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 2_015,
    regions: [],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...over,
  } as SubjectView;
}

/** The subject that prompted this: one region called `Card`, one cause called `Button`. */
function cartCard(): SubjectView {
  return subject({
    regions: [
      { x: 24, y: 318, width: 158, height: 44, pixels: 2_015, component: 'Card', cause: false },
    ],
    moved: [
      { component: 'Anonymous', bands: ['geometry'], cause: false },
      { component: 'Button', bands: ['geometry', 'token'], cause: true, grew: { width: 36, height: 8 } },
      { component: 'Card', bands: ['geometry'], cause: false },
      { component: 'Trash2', bands: ['geometry'], cause: false },
    ],
    size: { width: 1_280, height: 402 },
    baseline: { width: 1_280, height: 394 },
  });
}

describe('what a reviewer is shown first', () => {
  it('blames the component the hashes name, not the one the region is named after', () => {
    const at = glanceOf(cartCard());

    expect(at.blamed.map((each) => each.component)).toEqual(['Button']);
    expect(at.blamed[0]?.bands).toEqual(['geometry', 'token']);
    expect(at.landedIn).toBe('Card');
  });

  it('marks a cause no region carries, which is the two tiers disagreeing', () => {
    // `Button` moved per its digests and the only box drawn is called `Card`. A
    // page that printed the name without the mark would send a reviewer looking
    // for a highlighted button that is not on the picture.
    expect(glanceOf(cartCard()).blamed[0]?.drawn).toBe(false);
  });

  it('leaves the container off when a region does carry the cause', () => {
    // `landedIn` exists to say *the pixels are somewhere else*. Printed when the
    // box and the cause agree, it would be the page repeating one name twice
    // under two headings.
    const at = glanceOf(
      subject({
        regions: [{ x: 0, y: 0, width: 8, height: 8, pixels: 30, component: 'Button', cause: true }],
        moved: [{ component: 'Button', bands: ['token'], cause: true }],
      }),
    );

    expect(at.blamed[0]?.drawn).toBe(true);
    expect(at.landedIn).toBeUndefined();
  });

  it('names the axis and the signed distance the canvas moved', () => {
    const { grew } = glanceOf(cartCard());

    expect(grew).toEqual({
      axis: 'taller',
      by: 8,
      from: { width: 1_280, height: 394 },
      to: { width: 1_280, height: 402 },
    });
  });

  it('refuses an axis when both moved rather than leading with the larger', () => {
    // There is no one number to print, and choosing the height would hide a
    // subject that also lost 40 pixels of width — which is the reflow, not the
    // consequence of it.
    const { grew } = glanceOf(
      subject({ size: { width: 1_240, height: 402 }, baseline: { width: 1_280, height: 394 } }),
    );

    expect(grew?.axis).toBe('resized');
    expect(grew?.by).toBe(40);
  });

  it('says nothing about growth when only one side was measured', () => {
    // Absent is not equal. A candidate with no baseline dimensions on the record
    // has not been shown to be the same size, and a cell reading zero would be
    // the page asserting it.
    expect(glanceOf(subject({ size: { width: 1_280, height: 402 } })).grew).toBeUndefined();
  });

  it('separates *every digest matched* from *no digests were compared*', () => {
    // Both come back with nothing blamed, and they are opposite findings: one is
    // a change the hashes disown, the other is a baseline that could not be
    // asked. Folded together, the second prints the first's sentence.
    expect(glanceOf(subject({ moved: [] })).measured).toBe(true);
    expect(glanceOf(subject()).measured).toBe(false);
    expect(glanceOf(subject({ moved: [] })).blamed).toEqual([]);
  });

  it('orders causes by how much of the sense each one moved', () => {
    const at = glanceOf(
      subject({
        moved: [
          { component: 'Chip', bands: ['token'], cause: true },
          { component: 'Button', bands: ['geometry', 'token', 'content'], cause: true },
          { component: 'Badge', bands: ['token'], cause: true },
        ],
      }),
    );

    expect(at.blamed.map((each) => each.component)).toEqual(['Button', 'Badge', 'Chip']);
  });

  it('carries how much the control itself grew, beside how much the canvas did', () => {
    // Two facts, and the pair is the finding: the button gained thirty-six
    // pixels of width and the page gained none, so the width was absorbed by a
    // row with room in it and the height was not. A page holding only the canvas
    // delta reports the consequence and never the edit.
    const at = glanceOf(cartCard());

    expect(at.blamed[0]?.grew).toEqual({ width: 36, height: 8 });
    expect(at.grew?.by).toBe(8);
  });

  it('carries presence, which no band can state', () => {
    // `added` is not a band and a component that did not exist before has not
    // changed its geometry. A strip that printed the bands alone would report a
    // new control as a moved one.
    const at = glanceOf(
      subject({ moved: [{ component: 'Trash2', bands: ['geometry'], cause: true, presence: 'added' }] }),
    );

    expect(at.blamed[0]?.presence).toBe('added');
  });

  it('falls back to the first region when none of them is marked a cause', () => {
    const at = glanceOf(
      subject({
        regions: [
          { x: 0, y: 0, width: 4, height: 4, pixels: 9, component: 'Header', cause: false },
          { x: 0, y: 9, width: 4, height: 4, pixels: 4, component: 'Footer', cause: false },
        ],
        moved: [],
      }),
    );

    expect(at.landedIn).toBe('Header');
    expect(at.regions).toBe(2);
  });
});
