import { describe, expect, it } from 'vitest';
import type { SubjectView } from '../review-types.js';
import { partedBy } from './parted.js';
import type { Appearance, Origin } from './grouping.js';

/**
 * Where one change's renders stopped agreeing.
 *
 * The failures worth guarding are the two directions of one mistake: reporting
 * agreement that was not measured, and reporting a divergence the names do not
 * support. A pair that both recorded no shape have not been found to match; a
 * prefix another group also carries names nothing. Either way a reviewer is told
 * these are the same and presses approve on two outcomes.
 */

const DETAIL = 'v1:87d470ebfeb0';
const REST = 'v1:73994374c823';

function appearance(subject: string, pixels: number, shape?: string): Appearance {
  return {
    subject: { subject, decision: null } as SubjectView,
    pixels,
    alongside: [],
    ...(shape === undefined ? {} : { shape }),
  };
}

function origin(appearances: readonly Appearance[]): Origin {
  return {
    component: 'Button',
    pixels: appearances.reduce((total, each) => total + each.pixels, 0),
    appearances,
  };
}

/** Build 10's `Button`: two renders at one size, five spread over another shape. */
function button(): Origin {
  return origin([
    appearance('route/detail@1280', 6418, DETAIL),
    appearance('route/detail@390', 6418, DETAIL),
    appearance('route/sneakers@390', 3742, REST),
    appearance('story:button--primary', 3431, REST),
    appearance('story:button--small', 3455, REST),
    appearance('story:product-card--control', 3455, REST),
    appearance('story:product-card--sale', 3454, REST),
  ]);
}

describe('one change divided by what happened to each render', () => {
  it('groups the renders that moved identically and names their span', () => {
    const { shapes } = partedBy(button());

    expect(shapes.map((each) => [each.shape, each.renders.length])).toEqual([
      [DETAIL, 2],
      [REST, 5],
    ]);
    expect(shapes[0]).toMatchObject({ least: 6418, most: 6418 });
    expect(shapes[1]).toMatchObject({ least: 3431, most: 3742 });
  });

  it('orders the widest group first, whatever its size', () => {
    // Not by count. Five renders that each moved a label are the smaller finding
    // beside two that moved a whole layout, and a reviewer reading top-down
    // should meet the larger difference first.
    const { shapes } = partedBy(button());

    expect(shapes[0]?.renders).toEqual(['route/detail@1280', 'route/detail@390']);
  });

  it('names the group by the prefix its renders share and no other group carries', () => {
    const [detail, rest] = partedBy(button()).shapes;

    expect(detail?.only).toBe('route/detail');
    // `route/sneakers@390` and four stories share nothing, so the group with the
    // widest membership is the one with no name — which is the honest answer.
    expect(rest?.only).toBeUndefined();
  });

  it('withholds a name another group also extends', () => {
    // Both groups are `route/detail` renders. The prefix is true of each and
    // separates neither, and printing it beside both would read as two findings
    // about the same set.
    const { shapes } = partedBy(
      origin([
        appearance('route/detail@1280', 900, DETAIL),
        appearance('route/detail@1024', 900, DETAIL),
        appearance('route/detail@390', 400, REST),
        appearance('route/detail@360', 400, REST),
      ]),
    );

    expect(shapes.map((each) => each.only)).toEqual([undefined, undefined]);
  });

  it('cuts a shared name at a joint rather than mid-word', () => {
    const { shapes } = partedBy(
      origin([
        appearance('story:card--sale', 900, DETAIL),
        appearance('story:card--control', 900, DETAIL),
        appearance('story:button--primary', 400, REST),
      ]),
    );

    expect(shapes[0]?.only).toBe('story:card');
  });

  it('leaves a single render unnamed, because the subject is already the name', () => {
    const { shapes } = partedBy(
      origin([
        appearance('route/home@1280', 900, DETAIL),
        appearance('route/cart@390', 400, REST),
      ]),
    );

    expect(shapes.map((each) => each.only)).toEqual([undefined, undefined]);
  });

  it('keeps renders that recorded no shape out of every group', () => {
    // Two renders that both measured nothing have not been found to agree. A
    // group holding them would report the identical difference twice about a
    // pair nothing compared.
    const { shapes, unshaped } = partedBy(
      origin([
        appearance('route/detail@1280', 6418, DETAIL),
        appearance('story:button--ghost', 0),
        appearance('story:button--link', 0),
      ]),
    );

    expect(shapes).toHaveLength(1);
    expect(unshaped).toEqual(['story:button--ghost', 'story:button--link']);
  });

  it('answers no shapes at all rather than one empty group', () => {
    const { shapes, unshaped } = partedBy(origin([appearance('story:button--link', 0)]));

    expect(shapes).toEqual([]);
    expect(unshaped).toEqual(['story:button--link']);
  });

  it('reports agreement as one shape, not as an absence of division', () => {
    // The case the section exists to make legible. Two renders under one shape
    // is *the same difference twice*, and a panel that drew nothing here would
    // be indistinguishable from one that had not loaded.
    const { shapes } = partedBy(
      origin([
        appearance('story:product-card--control-dark', 487, 'v1:dfcc50ec'),
        appearance('story:product-card--sale-dark', 487, 'v1:dfcc50ec'),
      ]),
    );

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.renders).toEqual([
      'story:product-card--control-dark',
      'story:product-card--sale-dark',
    ]);
  });
});
